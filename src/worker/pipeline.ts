import { z } from "zod";
import { constrainFitBand, sectionSchemas, type AnalysisEvent, type SectionName } from "../shared/report";
import { UpstreamError, type GeminiClient } from "./gemini";
import type { Logger } from "./log";
import { COACH_SYSTEM, assessPrompt, extractPrompt, type AnalysisInput } from "./prompts";

export class PipelineError extends Error {
  constructor(readonly code: "model_invalid" | "upstream") {
    super(code);
  }
}

export function jsonSchemaFor(section: SectionName): object {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(sectionSchemas[section]) as Record<string, unknown>;
  return schema;
}

// Runs one structured step, validating against its schema and retrying once.
async function runStep<S extends SectionName>(
  gemini: GeminiClient,
  log: Logger,
  section: S,
  prompt: string,
): Promise<z.infer<(typeof sectionSchemas)[S]>> {
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
      throw new PipelineError("upstream");
    }
    try {
      const parsed = sectionSchemas[section].safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data as z.infer<(typeof sectionSchemas)[S]>;
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
}
