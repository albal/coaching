import { describe, expect, it } from "vitest";
import worker from "../../src/worker/index";
import { PASS_HEADER } from "../../src/worker/protection";
import { fakeEnv } from "../support/env";

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://coach.test${path}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("Worker entry", () => {
  it("serves non-API paths from static assets", async () => {
    const res = await worker.fetch(new Request("https://coach.test/"), fakeEnv().env);
    expect(await res.text()).toBe("page");
  });

  it("fails closed when Turnstile or the pass secret isn't configured", async () => {
    for (const env of [fakeEnv({ PASS_SECRET: "s" }).env, fakeEnv({ TURNSTILE_SECRET_KEY: "t" }).env]) {
      const res = await worker.fetch(post("/api/analyse", {}), env);
      expect(res.status).toBe(503);
    }
  });
});

describe("demo mode", () => {
  it("produces a full valid Report without any network call", async () => {
    const { env } = fakeEnv({ DEMO_GEMINI: "1" });
    const original = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new Error("network used"))) as typeof fetch;
    try {
      const verified = await worker.fetch(post("/api/verify", { token: "" }), env);
      const { pass } = (await verified.json()) as { pass: string };
      const res = await worker.fetch(post("/api/analyse", { resume: "Demo resume", jobDescription: "Demo job", consent: true }, { [PASS_HEADER]: pass }), env);
      const lines = (await res.text()).trim().split("\n").map((l) => JSON.parse(l));
      expect(lines.at(-1)).toEqual({ type: "done" });
      expect(lines.filter((l) => l.type === "section")).toHaveLength(5);
    } finally {
      globalThis.fetch = original;
    }
  });
});
