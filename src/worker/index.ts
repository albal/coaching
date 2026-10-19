import { handleApi } from "./app";
import { demoGemini } from "./demo";
import { createGeminiClient } from "./gemini";
import { json } from "./http";
import { consoleLogger } from "./log";
import { createPasses, createTurnstileVerifier, ipKey, type Protection, type RateLimiter } from "./protection";
import { usageClient, type DurableObjectNamespaceLike } from "./usage-guard";

export { UsageGuard } from "./usage-guard";

// Stateless: no binding here stores user content (ADR-0001). The only
// state is the content-free usage counter and rate-limit counters.
export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  BOOKING_URL?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  // Signs Turnstile passes and keys hashed IP counters.
  PASS_SECRET?: string;
  // Bearer token for GET /api/metrics and POST /api/admin/unlock; both are off without it.
  METRICS_TOKEN?: string;
  ANALYSES_PER_IP_PER_HOUR?: string;
  DAILY_ANALYSIS_CAP?: string;
  ANALYSE_BURST: RateLimiter;
  CHAT_BURST: RateLimiter;
  USAGE_GUARD: DurableObjectNamespaceLike;
  // Local development and end-to-end tests only: canned replies, no network,
  // and no Turnstile unless keys are given.
  DEMO_GEMINI?: string;
}

const DEMO_PASS_SECRET = "demo-mode-only";

function servicesFor(env: Env): { protection: Protection; usage: ReturnType<typeof usageClient> } | null {
  const demo = env.DEMO_GEMINI === "1";
  const passSecret = env.PASS_SECRET || (demo ? DEMO_PASS_SECRET : "");
  if (!passSecret || (!env.TURNSTILE_SECRET_KEY && !demo)) return null; // fail closed
  const limits = {
    perHour: Number(env.ANALYSES_PER_IP_PER_HOUR ?? 5),
    perDay: Number(env.DAILY_ANALYSIS_CAP ?? 300),
  };
  const usage = usageClient(env.USAGE_GUARD, limits, (ip) => ipKey(passSecret, ip));
  return {
    usage,
    protection: {
      verifyHuman: env.TURNSTILE_SECRET_KEY ? createTurnstileVerifier(env.TURNSTILE_SECRET_KEY) : async () => true,
      passes: createPasses(passSecret),
      burst: { analyse: env.ANALYSE_BURST, chat: env.CHAT_BURST },
      usage,
    },
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!new URL(req.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const services = servicesFor(env);
    if (!services) {
      consoleLogger.event({ event: "misconfigured", code: "protection" });
      return json({ type: "error", code: "upstream", message: "The coach isn't available right now." }, 503);
    }
    const gemini =
      env.DEMO_GEMINI === "1" ? demoGemini : createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
    return handleApi(req, {
      gemini,
      log: consoleLogger,
      protection: services.protection,
      metrics: services.usage,
      credit: services.usage,
      metricsToken: env.METRICS_TOKEN,
      config: { bookingUrl: env.BOOKING_URL ?? "", turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? "" },
    });
  },
};
