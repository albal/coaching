import { chatHistorySchema, MAX_CHAT_TURNS, userTurns, type ChatEvent } from "../shared/chat";
import { contextSchema, LIMITS, type AnalysisEvent, type ErrorCode } from "../shared/report";
import type { GeminiClient } from "./gemini";
import { json, ndjsonStream } from "./http";
import type { Logger } from "./log";
import { PipelineError, runAnalysis } from "./pipeline";
import { PASS_HEADER, type Protection } from "./protection";
import { chatSystem } from "./prompts";

export interface PublicConfig {
  bookingUrl: string;
  turnstileSiteKey: string;
}

export interface Deps {
  gemini: GeminiClient;
  log: Logger;
  protection: Protection;
  config?: Partial<PublicConfig>;
}

const ERROR_MESSAGES = {
  model_invalid: "The coach gave an answer we couldn't read. Please try again.",
  upstream: "The coach is unavailable right now. Please try again in a moment.",
} as const;

function isText(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

const fail = (status: number, code: ErrorCode, message: string) => json({ type: "error", code, message }, status);
const badRequest = (message: string) => fail(400, "bad_request", message);
const tooLarge = (message: string) => fail(413, "too_large", message);
const tooFast = () => fail(429, "rate_limited", "You're going a bit fast. Please wait a minute and try again.");

const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "";

async function readBody(req: Request): Promise<Record<string, unknown> | "too_large" | null> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > LIMITS.bodyBytes) return "too_large";
  const text = await req.text().catch(() => null);
  if (text === null) return null;
  if (new TextEncoder().encode(text).byteLength > LIMITS.bodyBytes) return "too_large";
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Every model-calling endpoint needs the pass issued after Turnstile, and
// passes the short-burst limiter.
async function guard(req: Request, deps: Deps, limiter: "analyse" | "chat"): Promise<Response | null> {
  if (!(await deps.protection.passes.check(req.headers.get(PASS_HEADER)))) {
    return fail(401, "verification_required", "Please complete the quick check to continue.");
  }
  const { success } = await deps.protection.burst[limiter].limit({ key: clientIp(req) });
  if (!success) {
    deps.log.event({ event: "rate_limited", step: limiter });
    return tooFast();
  }
  return null;
}

async function verify(req: Request, deps: Deps): Promise<Response> {
  const body = await readBody(req);
  if (!body || body === "too_large") return badRequest("Request body must be JSON.");
  const ok = typeof body.token === "string" && (await deps.protection.verifyHuman(body.token, clientIp(req)));
  deps.log.event({ event: ok ? "verify_passed" : "verify_failed" });
  if (!ok) return fail(403, "verification_failed", "The quick check didn't work. Please try it again.");
  return json({ pass: await deps.protection.passes.issue() });
}

async function analyse(req: Request, deps: Deps): Promise<Response> {
  const blocked = await guard(req, deps, "analyse");
  if (blocked) return blocked;
  const body = await readBody(req);
  if (body === "too_large") return tooLarge("That's too much text. Please shorten your Resume or Job Description.");
  if (!body) return badRequest("Request body must be JSON.");
  const { resume, jobDescription } = body;
  if (!isText(resume) || !isText(jobDescription)) {
    return badRequest("A Resume and a Job Description are required.");
  }
  if (resume.length > LIMITS.resumeChars) return tooLarge(`Your Resume is over ${LIMITS.resumeChars.toLocaleString("en-GB")} characters. Please shorten it.`);
  if (jobDescription.length > LIMITS.jobDescriptionChars) {
    return tooLarge(`The Job Description is over ${LIMITS.jobDescriptionChars.toLocaleString("en-GB")} characters. Please shorten it.`);
  }
  if (body.consent !== true) {
    return fail(400, "consent_required", "Please confirm you understand your text will be sent to Google Gemini.");
  }
  const context = contextSchema.optional().safeParse(body.context);
  if (!context.success) {
    return badRequest("The optional context isn't valid.");
  }

  const reservation = await deps.protection.usage.reserveAnalysis(clientIp(req));
  if (reservation !== "ok") {
    deps.log.event({ event: "analysis_refused", code: reservation });
    return reservation === "busy"
      ? fail(503, "busy", "We're busy today — book a session with Al instead.")
      : fail(429, "rate_limited", "You've run several Analyses in the last hour. Please try again later.");
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
  const blocked = await guard(req, deps, "chat");
  if (blocked) return blocked;
  const body = await readBody(req);
  if (body === "too_large") return tooLarge("This Coaching Chat is too long to continue. Download your Report to keep it.");
  if (!body) return badRequest("Request body must be JSON.");
  const { resume, jobDescription, report, message } = body;
  if (!isText(resume) || !isText(jobDescription) || !isText(message) || !report || typeof report !== "object") {
    return badRequest("A Resume, Job Description, Report and message are required.");
  }
  if (resume.length > LIMITS.resumeChars || jobDescription.length > LIMITS.jobDescriptionChars) {
    return tooLarge("That's too much text.");
  }
  if (message.length > LIMITS.messageChars) return tooLarge(`Please keep questions under ${LIMITS.messageChars.toLocaleString("en-GB")} characters.`);
  const history = chatHistorySchema.safeParse(body.history ?? []);
  if (!history.success) return badRequest("The chat history isn't valid.");
  if (userTurns(history.data) >= MAX_CHAT_TURNS) {
    return fail(400, "chat_limit", `This Coaching Chat has reached its limit of ${MAX_CHAT_TURNS} questions.`);
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

const ROUTES: Record<string, (req: Request, deps: Deps) => Promise<Response>> = {
  "/api/verify": verify,
  "/api/analyse": analyse,
  "/api/chat": chat,
};

export async function handleApi(req: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(req.url);
  if (pathname === "/api/config") {
    // Non-secret settings the page needs at runtime.
    return json({
      bookingUrl: deps.config?.bookingUrl ?? "",
      turnstileSiteKey: deps.config?.turnstileSiteKey ?? "",
    } satisfies PublicConfig);
  }
  const route = ROUTES[pathname];
  if (!route) return fail(404, "bad_request", "Not found.");
  if (req.method !== "POST") return fail(405, "bad_request", "Use POST.");
  return route(req, deps);
}
