import type { Env } from "../../src/worker/index";
import { UsageGuard } from "../../src/worker/usage-guard";

// An in-memory Durable Object storage, so tests can inspect what's kept.
export function memoryStorage() {
  const map = new Map<string, unknown>();
  return {
    map,
    storage: {
      get: async <T>(k: string) => map.get(k) as T | undefined,
      put: async (k: string, v: unknown) => void map.set(k, structuredClone(v)),
      delete: async (k: string) => map.delete(k),
    },
  };
}

export function fakeEnv(overrides: Partial<Env> = {}) {
  const { map, storage } = memoryStorage();
  const guard = new UsageGuard({ storage });
  const env: Env = {
    ASSETS: { fetch: async () => new Response("page") },
    GEMINI_API_KEY: "",
    GEMINI_MODEL: "m",
    ANALYSE_BURST: { limit: async () => ({ success: true }) },
    CHAT_BURST: { limit: async () => ({ success: true }) },
    USAGE_GUARD: { idFromName: (n) => n, get: () => guard },
    ...overrides,
  };
  return { env, storage: map };
}
