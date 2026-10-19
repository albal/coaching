import { contextSchema, type AnalysisEvent } from "../shared/report";
import type { GeminiClient } from "./gemini";
import { json, ndjsonStream } from "./http";
import type { Logger } from "./log";
import { PipelineError, runAnalysis } from "./pipeline";

export interface Deps {
  gemini: GeminiClient;
  log: Logger;
}

const ERROR_MESSAGES = {
  model_invalid: "The coach gave an answer we couldn't read. Please try again.",
  upstream: "The coach is unavailable right now. Please try again in a moment.",
} as const;

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

async function analyse(req: Request, deps: Deps): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ type: "error", code: "bad_request", message: "Request body must be JSON." }, 400);
  }
  const { resume, jobDescription } = body;
  if (!isText(resume) || !isText(jobDescription)) {
    return json({ type: "error", code: "bad_request", message: "A Resume and a Job Description are required." }, 400);
  }
  const context = contextSchema.optional().safeParse(body.context);
  if (!context.success) {
    return json({ type: "error", code: "bad_request", message: "The optional context isn't valid." }, 400);
  }

  deps.log.event({ event: "analysis_started" });
  return ndjsonStream(async (emit: (e: AnalysisEvent) => void) => {
    try {
      await runAnalysis(deps.gemini, deps.log, { resume, jobDescription, context: context.data }, emit);
      emit({ type: "done" });
      deps.log.event({ event: "analysis_completed" });
    } catch (err) {
      const code = err instanceof PipelineError ? err.code : "upstream";
      emit({ type: "error", code, message: ERROR_MESSAGES[code] });
      deps.log.event({ event: "analysis_failed", code });
    }
  });
}

export async function handleApi(req: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/analyse") {
    if (req.method !== "POST") return json({ type: "error", code: "bad_request", message: "Use POST." }, 405);
    return analyse(req, deps);
  }
  return json({ type: "error", code: "bad_request", message: "Not found." }, 404);
}
