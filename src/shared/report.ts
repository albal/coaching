import { z } from "zod";

// The Report contract shared by the Worker (which validates model output
// against it) and the browser (which renders and exports it).

export const FIT_BANDS = ["strong_fit", "stretch", "long_shot"] as const;
export type FitBand = (typeof FIT_BANDS)[number];

export const FIT_BAND_LABELS: Record<FitBand, string> = {
  strong_fit: "Strong fit",
  stretch: "Stretch",
  long_shot: "Long shot",
};

export const extractSchema = z.object({
  candidate: z.object({
    headline: z.string(),
    skills: z.array(z.string()),
    roles: z.array(
      z.object({
        title: z.string(),
        organisation: z.string(),
        summary: z.string(),
      }),
    ),
  }),
  job: z.object({
    title: z.string(),
    seniority: z.string(),
    // DevOps or adjacent (SRE, Platform, Cloud, DevSecOps, MLOps, Infrastructure).
    isDevOpsRelated: z.boolean(),
    requirements: z.array(
      z.object({
        text: z.string(),
        mustHave: z.boolean(),
      }),
    ),
  }),
});

export const DEVOPS_AREAS = [
  "Cloud",
  "IaC",
  "Containers & Orchestration",
  "CI/CD",
  "Observability",
  "Security/DevSecOps",
  "Scripting/Programming",
  "Networking",
  "Linux",
  "Reliability/SRE",
  "Leadership",
] as const;
export type DevOpsArea = (typeof DEVOPS_AREAS)[number];

export const EVIDENCE = ["strong", "partial", "missing"] as const;
export type Evidence = (typeof EVIDENCE)[number];

export const requirementSchema = z.object({
  text: z.string(),
  mustHave: z.boolean(),
  area: z.enum(DEVOPS_AREAS),
  evidence: z.enum(EVIDENCE),
  // The Resume line relied on; empty when evidence is missing.
  quote: z.string(),
  // How a related skill transfers, e.g. "GitLab CI transfers to GitHub Actions"; empty if none.
  transfer: z.string(),
});
export type Requirement = z.infer<typeof requirementSchema>;

export const assessSchema = z
  .object({
    fitBand: z.enum(FIT_BANDS),
    reason: z.string(),
    requirements: z.array(requirementSchema).min(1),
    seniority: z.object({
      target: z.string(),
      verdict: z.enum(["below", "meets", "above"]),
      notes: z.string(),
    }),
    hiddenStrengths: z.array(z.string()),
    redFlags: z.array(z.string()),
  })
  .refine((a) => a.requirements.every((r) => r.evidence === "missing" || r.quote.trim().length > 0), {
    message: "Strong and Partial evidence must quote the Resume",
  });

// A Gap is a requirement with only partial or no evidence.
export function gapsOf(requirements: Requirement[]): Requirement[] {
  return requirements.filter((r) => r.evidence !== "strong");
}

// The Fit Band definitions pin the band to the number of Must-have Gaps:
// none means Strong fit, more than two means Long shot. Between one and two
// the model judges whether each is closable in about three months.
export function constrainFitBand(band: FitBand, requirements: Requirement[]): FitBand {
  const mustHaveGaps = gapsOf(requirements).filter((r) => r.mustHave).length;
  if (mustHaveGaps === 0) return "strong_fit";
  if (mustHaveGaps > 2) return "long_shot";
  return band === "strong_fit" ? "stretch" : band;
}

const LEVELS = ["low", "medium", "high"] as const;

export const planSchema = z.object({
  // Ranked: index 0 is the Gap to work on first.
  gaps: z.array(
    z.object({
      requirement: z.string(),
      mustHave: z.boolean(),
      impact: z.enum(LEVELS),
      effort: z.enum(LEVELS),
      whatToLearn: z.string(),
      timeEstimate: z.string(),
      resourceType: z.string(),
      // Empty unless a certification genuinely helps for this Job Description.
      certification: z.string(),
    }),
  ),
  projects: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      provesGaps: z.array(z.string()),
    }),
  ),
  // Empty unless the candidate gave hours per week or a timeline.
  weeklyPlan: z.array(
    z.object({
      week: z.number().int().min(1),
      focus: z.string(),
      tasks: z.array(z.string()),
    }),
  ),
  recommendation: z.object({
    decision: z.enum(["apply_now", "prepare_first"]),
    reason: z.string(),
  }),
});

// Numbers in a rewrite must come from the original bullet; anything else goes
// in a [placeholder] for the candidate to fill in.
function numbersOutsidePlaceholders(text: string): string[] {
  return text.replace(/\[[^\]]*\]/g, "").match(/\d+(?:[.,]\d+)?/g) ?? [];
}

export function inventsNumbers(original: string, rewritten: string): boolean {
  const known = new Set(original.match(/\d+(?:[.,]\d+)?/g) ?? []);
  return numbersOutsidePlaceholders(rewritten).some((n) => !known.has(n));
}

export const rewritesSchema = z
  .object({
    bullets: z.array(
      z.object({
        original: z.string(),
        rewritten: z.string(),
        // Each placeholder as it appears in the rewrite, e.g. "[X%]".
        placeholders: z.array(z.string()),
      }),
    ),
    missingKeywords: z.array(
      z.object({
        keyword: z.string(),
        // The Resume line that makes claiming this keyword honest.
        evidence: z.string(),
      }),
    ),
    summary: z.string(),
  })
  .refine((r) => r.bullets.every((b) => !inventsNumbers(b.original, b.rewritten)), {
    message: "Rewrites must not invent numbers",
  })
  .refine((r) => r.bullets.every((b) => b.placeholders.every((p) => b.rewritten.includes(p))), {
    message: "Placeholders must appear in the rewrite",
  });

export const QUESTION_TYPES = ["technical", "scenario", "system_design", "behavioural"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  technical: "Technical",
  scenario: "Scenario",
  system_design: "System design",
  behavioural: "Behavioural",
};

export const interviewSchema = z.object({
  questions: z
    .array(
      z.object({
        type: z.enum(QUESTION_TYPES),
        question: z.string(),
        // What the interviewer is testing with this question.
        testing: z.string(),
        // Experience from the candidate's own Resume to use in the answer.
        resumeStories: z.array(z.string()),
      }),
    )
    .min(10)
    .max(20),
});

export const sectionSchemas = {
  extract: extractSchema,
  assess: assessSchema,
  plan: planSchema,
  rewrites: rewritesSchema,
  interview: interviewSchema,
} as const;

// Steps that run in parallel once Assess is done.
export const AFTER_ASSESS = ["plan", "rewrites", "interview"] as const satisfies readonly SectionName[];

export const contextSchema = z.object({
  seniority: z.string().trim().max(100).optional(),
  hoursPerWeek: z.number().int().min(1).max(80).optional(),
  timeline: z.string().trim().max(100).optional(),
});
export type AnalysisContext = z.infer<typeof contextSchema>;

export type SectionName = keyof typeof sectionSchemas;
export type Sections = { [K in SectionName]: z.infer<(typeof sectionSchemas)[K]> };
export type Report = Partial<Sections>;

export type AnalysisEvent =
  | { type: "section"; section: SectionName; data: unknown }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "done" };

export type ErrorCode =
  | "bad_request"
  | "consent_required"
  | "verification_required"
  | "verification_failed"
  | "rate_limited"
  | "busy"
  | "too_large"
  | "chat_limit"
  | "model_invalid"
  | "out_of_credit"
  | "upstream";

export const OUT_OF_CREDIT_MESSAGE =
  "The coach has run out of credit for now, so new Analyses and Coaching Chat questions are paused. Please check back later.";

// Input size limits, enforced by the Worker and mirrored in the page.
export const LIMITS = {
  resumeChars: 30_000,
  jobDescriptionChars: 20_000,
  messageChars: 2_000,
  bodyBytes: 400_000,
} as const;
