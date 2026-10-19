import { z } from "zod";
import { AFTER_ASSESS, constrainFitBand, sectionSchemas, type AnalysisEvent, type SectionName } from "../shared/report";
import { UpstreamError, type GeminiClient } from "./gemini";
import type { Logger } from "./log";
import { COACH_SYSTEM, assessPrompt, extractPrompt, interviewPrompt, planPrompt, rewritesPrompt, type AnalysisInput } from "./prompts";

const normalise = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

// A rewrite must start from a line that really is in the Resume.
function quotes(resume: string, line: string): boolean {
  return normalise(resume).includes(normalise(line));
}

export class PipelineError extends Error {
  constructor(readonly code: "model_invalid" | "upstream" | "out_of_credit") {
    super(code);
  }
}

export function jsonSchemaFor(section: SectionName): object {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(sectionSchemas[section]) as Record<string, unknown>;
  return schema;
}

type Data<S extends SectionName> = z.infer<(typeof sectionSchemas)[S]>;

// Runs one structured step, validating against its schema (and an optional
// extra check) and retrying once.
async function runStep<S extends SectionName>(
  gemini: GeminiClient,
  log: Logger,
  section: S,
  prompt: string,
  check: (data: Data<S>) => boolean = () => true,
): Promise<Data<S>> {
  const schema = jsonSchemaFor(section);
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    let text: string;
    try {
      const res = await gemini.generateJson({ system: COACH_SYSTEM, prompt, schema });
      text = res.text;
      log.event({ event: "model_call", step: section, ms: Date.now() - started, ...res.usage });
    } catch (err) {
      const status = err instanceof UpstreamError ? err.status : undefined;
      log.event({ event: "model_error", step: section, status });
      throw new PipelineError(err instanceof UpstreamError && err.outOfCredit ? "out_of_credit" : "upstream");
    }
    try {
      const parsed = sectionSchemas[section].safeParse(JSON.parse(text));
      if (parsed.success && check(parsed.data as Data<S>)) return parsed.data as Data<S>;
    } catch {
      // fall through to retry
    }
    log.event({ event: "model_invalid", step: section, code: `attempt_${attempt}` });
  }
  throw new PipelineError("model_invalid");
}

export async function runAnalysis(
  gemini: GeminiClient,
  log: Logger,
  input: AnalysisInput,
  emit: (e: AnalysisEvent) => void,
): Promise<void> {
  const extract = await runStep(gemini, log, "extract", extractPrompt(input));
  emit({ type: "section", section: "extract", data: extract });
  const assessed = await runStep(gemini, log, "assess", assessPrompt(input, extract));
  const assess = { ...assessed, fitBand: constrainFitBand(assessed.fitBand, assessed.requirements) };
  emit({ type: "section", section: "assess", data: assess });

  // Later steps run in parallel; each section streams as soon as it's ready.
  // If any fails, the others still arrive before the error is raised.
  const report = { extract, assess };
  const prompts: Record<(typeof AFTER_ASSESS)[number], string> = {
    plan: planPrompt(input, report),
    rewrites: rewritesPrompt(input, report),
    interview: interviewPrompt(input, report),
  };
  const checks: { [S in (typeof AFTER_ASSESS)[number]]?: (data: Data<S>) => boolean } = {
    rewrites: (data) => data.bullets.every((b) => quotes(input.resume, b.original)),
  };
  const results = await Promise.allSettled(
    AFTER_ASSESS.map(async (section) => {
      const data = await runStep(gemini, log, section, prompts[section], checks[section] as never);
      emit({ type: "section", section, data });
    }),
  );
  const failure = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failure) throw failure.reason;
}
