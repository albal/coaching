import { chatHistorySchema, MAX_CHAT_TURNS, userTurns, type ChatEvent } from "../shared/chat";
import { contextSchema, type AnalysisEvent } from "../shared/report";
import type { GeminiClient } from "./gemini";
import { json, ndjsonStream } from "./http";
import type { Logger } from "./log";
import { PipelineError, runAnalysis } from "./pipeline";
import { chatSystem } from "./prompts";

export interface PublicConfig {
  bookingUrl: string;
}

export interface Deps {
  gemini: GeminiClient;
  log: Logger;
  config?: PublicConfig;
}

const ERROR_MESSAGES = {
  model_invalid: "The coach gave an answer we couldn't read. Please try again.",
  upstream: "The coach is unavailable right now. Please try again in a moment.",
} as const;

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const badRequest = (message: string, code = "bad_request") => json({ type: "error", code, message }, 400);

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function analyse(req: Request, deps: Deps): Promise<Response> {
  const body = await readBody(req);
  if (!body) return badRequest("Request body must be JSON.");
  const { resume, jobDescription } = body;
  if (!isText(resume) || !isText(jobDescription)) {
    return badRequest("A Resume and a Job Description are required.");
  }
  if (body.consent !== true) {
    return badRequest("Please confirm you understand your text will be sent to Google Gemini.", "consent_required");
  }
  const context = contextSchema.optional().safeParse(body.context);
  if (!context.success) {
    return badRequest("The optional context isn't valid.");
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

async function chat(req: Request, deps: Deps): Promise<Response> {
  const body = await readBody(req);
  if (!body) return badRequest("Request body must be JSON.");
  const { resume, jobDescription, report, message } = body;
  if (!isText(resume) || !isText(jobDescription) || !isText(message) || !report || typeof report !== "object") {
    return badRequest("A Resume, Job Description, Report and message are required.");
  }
  const history = chatHistorySchema.safeParse(body.history ?? []);
  if (!history.success) return badRequest("The chat history isn't valid.");
  if (userTurns(history.data) >= MAX_CHAT_TURNS) {
    return badRequest(`This Coaching Chat has reached its limit of ${MAX_CHAT_TURNS} questions.`, "chat_limit");
  }

  deps.log.event({ event: "chat_started" });
  const turns = [...history.data, { role: "user" as const, text: message }];
  return ndjsonStream(async (emit: (e: ChatEvent) => void) => {
    const started = Date.now();
    try {
      for await (const text of deps.gemini.streamText({ system: chatSystem({ resume, jobDescription }, report), turns })) {
        emit({ type: "delta", text });
      }
      emit({ type: "done" });
      deps.log.event({ event: "chat_completed", ms: Date.now() - started });
    } catch {
      emit({ type: "error", code: "upstream", message: ERROR_MESSAGES.upstream });
      deps.log.event({ event: "chat_failed" });
    }
  });
}

export async function handleApi(req: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/config") {
    // Non-secret settings the page needs at runtime.
    return json({ bookingUrl: deps.config?.bookingUrl ?? "" } satisfies PublicConfig);
  }
  if (pathname === "/api/analyse") {
    if (req.method !== "POST") return json({ type: "error", code: "bad_request", message: "Use POST." }, 405);
    return analyse(req, deps);
  }
  if (pathname === "/api/chat") {
    if (req.method !== "POST") return json({ type: "error", code: "bad_request", message: "Use POST." }, 405);
    return chat(req, deps);
  }
  return json({ type: "error", code: "bad_request", message: "Not found." }, 404);
}
