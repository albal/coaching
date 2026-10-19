import { handleApi } from "./app";
import { createGeminiClient } from "./gemini";
import { consoleLogger } from "./log";

// Stateless: no binding here stores user content (ADR-0001).
export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!new URL(req.url).pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const gemini = createGeminiClient({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
    return handleApi(req, { gemini, log: consoleLogger });
  },
};
