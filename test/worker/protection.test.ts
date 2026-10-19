import { describe, expect, it } from "vitest";
import { LIMITS } from "../../src/shared/report";
import { handleApi, type Deps } from "../../src/worker/app";
import { createPasses, createTurnstileVerifier, ipKey, PASS_HEADER, PASS_LIFETIME_MS, type Protection } from "../../src/worker/protection";
import { UsageGuard, usageClient } from "../../src/worker/usage-guard";
import { memoryStorage } from "../support/env";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { JOB, RESUME, SCRIPT } from "../support/fixtures";
import { openProtection } from "../support/protection";

const SECRET = "test-secret";

function request(path: string, body: unknown, headers: Record<string, string> = {}, ip = "203.0.113.7") {
  return new Request(`https://coach.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const analysisBody = { resume: RESUME, jobDescription: JOB, consent: true };

function setup(overrides: Partial<Protection> = {}, limits = { perHour: 5, perDay: 100 }) {
  const { map, storage } = memoryStorage();
  const guard = new UsageGuard({ storage });
  const gemini = fakeGemini(SCRIPT);
  const passes = createPasses(SECRET);
  const protection = openProtection({
    passes,
    usage: usageClient({ idFromName: (n) => n, get: () => guard }, limits, (ip) => ipKey(SECRET, ip)),
    ...overrides,
  }).protection;
  const deps: Deps = { gemini: gemini.client, log: captureLogger().logger, protection };
  return { deps, gemini, storage: map, passes };
}

async function withPass(passes: Protection["passes"]) {
  return { [PASS_HEADER]: await passes.issue() };
}

describe("Turnstile pass", () => {
  it("refuses Analyses and chat without a valid pass", async () => {
    const { deps, gemini } = setup();
    for (const headers of [{}, { [PASS_HEADER]: "123.forged" }, { [PASS_HEADER]: "garbage" }] as Record<string, string>[]) {
      for (const path of ["/api/analyse", "/api/chat"]) {
        const res = await handleApi(request(path, analysisBody, headers), deps);
        expect(res.status).toBe(401);
        expect(await res.json()).toMatchObject({ code: "verification_required" });
      }
    }
    expect(gemini.calls).toHaveLength(0);
  });

  it("issues a pass for a valid Turnstile token, which then unlocks Analyses", async () => {
    const tokens: string[] = [];
    const { deps } = setup({ verifyHuman: async (t) => (tokens.push(t), t === "good") });
    expect((await handleApi(request("/api/verify", { token: "bad" }), deps)).status).toBe(403);
    const res = await handleApi(request("/api/verify", { token: "good" }), deps);
    const { pass } = (await res.json()) as { pass: string };
    const analysis = await handleApi(request("/api/analyse", analysisBody, { [PASS_HEADER]: pass }), deps);
    expect(analysis.status).toBe(200);
    expect(tokens).toEqual(["bad", "good"]);
  });

  it("expires passes after four hours", async () => {
    let now = 1_000_000;
    const passes = createPasses(SECRET, () => now);
    const pass = await passes.issue();
    expect(await passes.check(pass)).toBe(true);
    now += PASS_LIFETIME_MS + 1;
    expect(await passes.check(pass)).toBe(false);
    expect(await createPasses("other-secret", () => 0).check(pass)).toBe(false);
  });
});

describe("Turnstile verifier", () => {
  it("posts the secret, token and IP to siteverify", async () => {
    const seen: FormData[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      seen.push(init.body as FormData);
      return Response.json({ success: true });
    }) as unknown as typeof fetch;
    expect(await createTurnstileVerifier("ts-secret", fetcher)("tok", "198.51.100.1")).toBe(true);
    expect(Object.fromEntries(seen[0]!.entries())).toEqual({ secret: "ts-secret", response: "tok", remoteip: "198.51.100.1" });
    const failing = (async () => Response.json({ success: false })) as unknown as typeof fetch;
    expect(await createTurnstileVerifier("s", failing)("tok", "")).toBe(false);
    expect(await createTurnstileVerifier("s", fetcher)("", "")).toBe(false);
  });
});

describe("rate limits and the daily cap", () => {
  it("returns rate_limited when the short-burst limiter refuses", async () => {
    const keys: string[] = [];
    const { deps, passes } = setup({
      burst: { analyse: { limit: async ({ key }) => (keys.push(key), { success: false }) }, chat: { limit: async () => ({ success: true }) } },
    });
    const res = await handleApi(request("/api/analyse", analysisBody, await withPass(passes)), deps);
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "rate_limited" });
    expect(keys).toEqual(["203.0.113.7"]);
  });

  it("allows 5 Analyses per IP per hour, then refuses that IP only", async () => {
    const { deps, passes } = setup();
    const headers = await withPass(passes);
    for (let i = 0; i < 5; i++) expect((await handleApi(request("/api/analyse", analysisBody, headers), deps)).status).toBe(200);
    const sixth = await handleApi(request("/api/analyse", analysisBody, headers), deps);
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toMatchObject({ code: "rate_limited", message: expect.stringMatching(/last hour/) });
    expect((await handleApi(request("/api/analyse", analysisBody, headers, "198.51.100.9"), deps)).status).toBe(200);
  });

  it("returns busy with the booking message once the daily cap is reached", async () => {
    const { deps, passes } = setup({}, { perHour: 100, perDay: 2 });
    const headers = await withPass(passes);
    await handleApi(request("/api/analyse", analysisBody, headers, "a"), deps);
    await handleApi(request("/api/analyse", analysisBody, headers, "b"), deps);
    const res = await handleApi(request("/api/analyse", analysisBody, headers, "c"), deps);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "busy", message: "We're busy today — book a session with Al instead." });
  });

  it("stores only a content-free daily count", async () => {
    const { deps, passes, storage } = setup();
    const marker = "STORE-MARKER-55aa";
    await handleApi(request("/api/analyse", { ...analysisBody, resume: `${RESUME} ${marker}` }, await withPass(passes)), deps);
    expect([...storage.keys()]).toEqual(["daily"]);
    expect(storage.get("daily")).toEqual({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), count: 1 });
    expect(JSON.stringify([...storage.entries()])).not.toContain(marker);
    expect(JSON.stringify([...storage.entries()])).not.toContain("203.0.113.7");
  });

  it("does not count invalid requests against the limits", async () => {
    const { deps, passes, storage } = setup();
    const headers = await withPass(passes);
    await handleApi(request("/api/analyse", { resume: RESUME }, headers), deps);
    await handleApi(request("/api/analyse", { ...analysisBody, consent: false }, headers), deps);
    expect(storage.get("daily")).toBeUndefined();
  });

  it("resets the daily count on a new day and forgets hourly hits after an hour", async () => {
    let now = Date.UTC(2026, 9, 19, 23, 30);
    const { storage } = memoryStorage();
    const guard = new UsageGuard({ storage }, undefined, () => now);
    expect(await guard.reserve("k", 1, 1)).toBe("ok");
    expect(await guard.reserve("k", 1, 1)).toBe("rate_limited");
    now += 61 * 60 * 1000;
    expect(await guard.reserve("k", 1, 1)).toBe("ok");
  });
});

describe("input size limits", () => {
  it("rejects an oversized Resume, Job Description, message or body", async () => {
    const { deps, passes, gemini } = setup();
    const headers = await withPass(passes);
    const cases: [string, unknown][] = [
      ["/api/analyse", { ...analysisBody, resume: "x".repeat(LIMITS.resumeChars + 1) }],
      ["/api/analyse", { ...analysisBody, jobDescription: "x".repeat(LIMITS.jobDescriptionChars + 1) }],
      ["/api/analyse", JSON.stringify({ ...analysisBody, padding: "x".repeat(LIMITS.bodyBytes) })],
      ["/api/chat", { resume: RESUME, jobDescription: JOB, report: {}, history: [], message: "x".repeat(LIMITS.messageChars + 1) }],
    ];
    for (const [path, body] of cases) {
      const res = await handleApi(request(path, body, headers), deps);
      expect(res.status).toBe(413);
      expect(await res.json()).toMatchObject({ code: "too_large" });
    }
    expect(gemini.calls).toHaveLength(0);
  });
});
