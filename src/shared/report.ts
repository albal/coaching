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

export const sectionSchemas = {
  extract: extractSchema,
  assess: assessSchema,
} as const;

export type SectionName = keyof typeof sectionSchemas;
export type Sections = { [K in SectionName]: z.infer<(typeof sectionSchemas)[K]> };
export type Report = Partial<Sections>;

export type AnalysisEvent =
  | { type: "section"; section: SectionName; data: unknown }
  | { type: "error"; code: ErrorCode; message: string }
  | { type: "done" };

export type ErrorCode = "bad_request" | "model_invalid" | "upstream";
