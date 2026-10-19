import { describe, expect, it } from "vitest";
import worker, { type Env } from "../../src/worker/index";

describe("Worker entry", () => {
  it("serves non-API paths from static assets", async () => {
    const env = {
      ASSETS: { fetch: async () => new Response("page") },
      GEMINI_API_KEY: "k",
      GEMINI_MODEL: "m",
    } as Env;
    const res = await worker.fetch(new Request("https://coach.test/"), env);
    expect(await res.text()).toBe("page");
  });
});

describe("demo mode", () => {
  it("produces a full valid Report without any network call", async () => {
    const env = { ASSETS: { fetch: async () => new Response("") }, GEMINI_API_KEY: "", GEMINI_MODEL: "m", DEMO_GEMINI: "1" } as Env;
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network used"))) as typeof fetch;
    try {
      const res = await worker.fetch(
        new Request("https://coach.test/api/analyse", { method: "POST", body: JSON.stringify({ resume: "Demo resume", jobDescription: "Demo job" }) }),
        env,
      );
      const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.at(-1)).toEqual({ type: "done" });
      expect(lines.filter((l) => l.type === "section")).toHaveLength(5);
    } finally {
      globalThis.fetch = original;
    }
  });
});
