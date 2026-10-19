import { handleApi } from "./app";
import { demoGemini } from "./demo";
import { createGeminiClient } from "./gemini";
import { consoleLogger } from "./log";

// Stateless: no binding here stores user content (ADR-0001).
export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  BOOKING_URL?: string;
  // Local development and end-to-end tests only: canned replies, no network.
  DEMO_GEMINI?: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!new URL(req.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const gemini =
      env.DEMO_GEMINI === "1" ? demoGemini : createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
    return handleApi(req, { gemini, log: consoleLogger, config: { bookingUrl: env.BOOKING_URL ?? "" } });
  },
};
