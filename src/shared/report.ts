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

export const assessSchema = z.object({
  fitBand: z.enum(FIT_BANDS),
  reason: z.string(),
});

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
