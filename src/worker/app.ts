import { chatHistorySchema, MAX_CHAT_TURNS, userTurns, type ChatEvent } from "../shared/chat";
import { contextSchema, LIMITS, OUT_OF_CREDIT_MESSAGE, type AnalysisEvent, type ErrorCode } from "../shared/report";
import { UpstreamError, type GeminiClient } from "./gemini";
import { json, ndjsonStream, SECURITY_HEADERS } from "./http";
import type { Logger } from "./log";
import { PipelineError, runAnalysis } from "./pipeline";
import { PASS_HEADER, type Protection } from "./protection";
import { chatSystem } from "./prompts";
import { METRICS, type DailyMetrics, type Metric } from "./usage-guard";

export interface PublicConfig {
  bookingUrl: string;
  turnstileSiteKey: string;
  // False while the prepaid Gemini credit has run out.
  available: boolean;
}

// The app-wide lock set when the prepaid Gemini balance runs out.
export interface CreditLock {
  isLocked(): Promise<boolean>;
  lock(): Promise<void>;
  unlock(): Promise<void>;
}

export interface Metrics {
  count(metric: Metric): Promise<void>;
  metrics(): Promise<DailyMetrics>;
}

export interface Deps {
  gemini: GeminiClient;
  log: Logger;
  protection: Protection;
  config?: Partial<PublicConfig>;
  // Content-free usage counts; optional because nothing depends on them.
  metrics?: Metrics;
  // Bearer token for reading metrics and clearing the credit lock; both
  // endpoints are off without one.
  metricsToken?: string;
  credit?: CreditLock;
}

async function creditLocked(deps: Deps): Promise<boolean> {
  try {
    return (await deps.credit?.isLocked()) ?? false;
  } catch {
    return false;
  }
}

async function lockCredit(deps: Deps): Promise<void> {
  deps.log.event({ event: "out_of_credit" });
  try {
    await deps.credit?.lock();
  } catch {
    deps.log.event({ event: "credit_lock_failed" });
  }
}

const outOfCredit = () => fail(503, "out_of_credit", OUT_OF_CREDIT_MESSAGE);

// Metrics must never break a request.
async function count(deps: Deps, metric: Metric): Promise<void> {
  try {
    await deps.metrics?.count(metric);
  } catch {
    deps.log.event({ event: "metric_failed", code: metric });
  }
}

const ERROR_MESSAGES = {
  model_invalid: "The coach gave an answer we couldn't read. Please try again.",
  upstream: "The coach is unavailable right now. Please try again in a moment.",
  out_of_credit: OUT_OF_CREDIT_MESSAGE,
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
  // While locked, refuse at once: no Gemini call, no limits consumed.
  if (await creditLocked(deps)) return outOfCredit();
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
      await count(deps, "analysis_completed");
    } catch (err) {
      const code = err instanceof PipelineError ? err.code : "upstream";
      if (code === "out_of_credit") await lockCredit(deps);
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
    } catch (err) {
      const code = err instanceof UpstreamError && err.outOfCredit ? "out_of_credit" : "upstream";
      if (code === "out_of_credit") await lockCredit(deps);
      emit({ type: "error", code, message: ERROR_MESSAGES[code] });
      deps.log.event({ event: "chat_failed", code });
    }
  });
}

// Events the page reports. Analyses are counted by the Worker itself.
const PAGE_EVENTS: Metric[] = ["download", "booking_click"];

async function event(req: Request, deps: Deps): Promise<Response> {
  const { success } = await deps.protection.burst.chat.limit({ key: clientIp(req) });
  if (!success) return tooFast();
  const body = await readBody(req);
  const name = body && body !== "too_large" ? body.name : null;
  if (!PAGE_EVENTS.includes(name as Metric)) return badRequest("Unknown event.");
  await count(deps, name as Metric);
  return new Response(null, { status: 204, headers: SECURITY_HEADERS });
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Operator endpoints: off without a token, and Bearer-authenticated.
function operatorAuth(req: Request, deps: Deps): Response | null {
  if (!deps.metricsToken) return fail(404, "bad_request", "Not found.");
  if (!sameToken(req.headers.get("authorization") ?? "", `Bearer ${deps.metricsToken}`)) return fail(401, "bad_request", "Unauthorised.");
  return null;
}

// After topping up the Gemini balance, Al clears the lock at once rather
// than waiting for it to expire.
async function unlock(req: Request, deps: Deps): Promise<Response> {
  const denied = operatorAuth(req, deps);
  if (denied) return denied;
  await deps.credit?.unlock();
  deps.log.event({ event: "credit_unlocked" });
  return json({ locked: false });
}

async function readMetrics(req: Request, deps: Deps): Promise<Response> {
  const denied = operatorAuth(req, deps);
  if (denied) return denied;
  if (!deps.metrics) return fail(404, "bad_request", "Not found.");
  const days = await deps.metrics.metrics();
  const totals = Object.fromEntries(METRICS.map((m) => [m, Object.values(days).reduce((n, d) => n + (d[m] ?? 0), 0)]));
  return json({ days, totals });
}

const ROUTES: Record<string, (req: Request, deps: Deps) => Promise<Response>> = {
  "/api/event": event,
  "/api/admin/unlock": unlock,
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
      available: !(await creditLocked(deps)),
    } satisfies PublicConfig);
  }
  if (pathname === "/api/metrics") {
    if (req.method !== "GET") return fail(405, "bad_request", "Use GET.");
    return readMetrics(req, deps);
  }
  const route = ROUTES[pathname];
  if (!route) return fail(404, "bad_request", "Not found.");
  if (req.method !== "POST") return fail(405, "bad_request", "Use POST.");
  return route(req, deps);
}
