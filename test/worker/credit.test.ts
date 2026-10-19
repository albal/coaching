import { describe, expect, it } from "vitest";
import { OUT_OF_CREDIT_MESSAGE } from "../../src/shared/report";
import { handleApi, type Deps } from "../../src/worker/app";
import { createGeminiClient, type GeminiClient } from "../../src/worker/gemini";
import { CREDIT_LOCK_MS, UsageGuard, usageClient } from "../../src/worker/usage-guard";
import { memoryStorage } from "../support/env";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { JOB, RESUME, SCRIPT } from "../support/fixtures";
import { openProtection } from "../support/protection";
import { analyse, events, post } from "../support/worker";

const TOKEN = "operator-token";

// Gemini answering with the given status and body for every call.
function failingGemini(status: number, body: unknown): GeminiClient {
  return createGeminiClient({
    apiKey: "k",
    model: "m",
    fetch: (async () => Response.json(body, { status })) as unknown as typeof fetch,
  });
}

function setup(gemini: GeminiClient = fakeGemini(SCRIPT).client, now = () => Date.now()) {
  const { map, storage } = memoryStorage();
  const guard = new UsageGuard({ storage }, undefined, now);
  const usage = usageClient({ idFromName: (n) => n, get: () => guard }, { perHour: 100, perDay: 100 }, async () => "h");
  const log = captureLogger();
  const deps: Deps = { gemini, log: log.logger, protection: openProtection({ usage }).protection, metrics: usage, credit: usage, metricsToken: TOKEN };
  return { deps, storage: map, log };
}

const config = async (deps: Deps) => (await (await handleApi(new Request("https://coach.test/api/config"), deps)).json()) as { available: boolean };
const chatBody = { resume: RESUME, jobDescription: JOB, report: {}, history: [], message: "Hi" };

describe("detecting an empty prepaid balance", () => {
  it.each([
    [402, { error: { status: "PAYMENT_REQUIRED", message: "Payment required" } }],
    [429, { error: { status: "RESOURCE_EXHAUSTED", message: "Your prepayment credits are depleted." } }],
    [403, { error: { status: "PERMISSION_DENIED", message: "Billing account has no remaining balance." } }],
  ])("treats %i with a credit or billing error as out of credit and locks the app", async (status, body) => {
    const { deps, storage } = setup(failingGemini(status, body));
    const { events: evs } = await analyse(deps, { resume: RESUME, jobDescription: JOB });
    expect(evs.at(-1)).toEqual({ type: "error", code: "out_of_credit", message: OUT_OF_CREDIT_MESSAGE });
    expect(await config(deps)).toMatchObject({ available: false });
    expect(typeof storage.get("creditLockedAt")).toBe("number");
  });

  it("does not lock for an ordinary rate limit or server error", async () => {
    for (const [status, body] of [
      [429, { error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for requests per minute." } }],
      [500, { error: { status: "INTERNAL", message: "Internal error" } }],
    ] as const) {
      const { deps } = setup(failingGemini(status, body));
      const { events: evs } = await analyse(deps, { resume: RESUME, jobDescription: JOB });
      expect(evs.at(-1)).toMatchObject({ code: "upstream" });
      expect(await config(deps)).toMatchObject({ available: true });
    }
  });

  it("locks when the credit runs out during a Coaching Chat", async () => {
    const { deps } = setup(failingGemini(402, {}));
    const res = await handleApi(post("/api/chat", chatBody), deps);
    expect(await events(res)).toEqual([{ type: "error", code: "out_of_credit", message: OUT_OF_CREDIT_MESSAGE }]);
    expect(await config(deps)).toMatchObject({ available: false });
  });
});

describe("while locked", () => {
  it("refuses Analyses and chat at once, without calling Gemini or using up limits", async () => {
    const gemini = fakeGemini(SCRIPT);
    const { deps, storage } = setup(gemini.client);
    await deps.credit!.lock();
    for (const [path, body] of [["/api/analyse", { resume: RESUME, jobDescription: JOB, consent: true }], ["/api/chat", chatBody]] as const) {
      const res = await handleApi(post(path, body), deps);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ type: "error", code: "out_of_credit", message: OUT_OF_CREDIT_MESSAGE });
    }
    expect(gemini.calls).toHaveLength(0);
    expect(gemini.chatCalls).toHaveLength(0);
    expect(storage.get("daily")).toBeUndefined();
  });

  it("expires on its own, so the next request tries Gemini again", async () => {
    let now = Date.UTC(2026, 9, 19, 12);
    const { deps } = setup(fakeGemini(SCRIPT).client, () => now);
    await deps.credit!.lock();
    expect(await config(deps)).toMatchObject({ available: false });
    now += CREDIT_LOCK_MS + 1;
    expect(await config(deps)).toMatchObject({ available: true });
    expect((await analyse(deps, { resume: RESUME, jobDescription: JOB })).events.at(-1)).toEqual({ type: "done" });
  });

  it("can be cleared at once by Al with the operator token", async () => {
    const { deps } = setup();
    await deps.credit!.lock();
    const unlock = (auth?: string) =>
      handleApi(new Request("https://coach.test/api/admin/unlock", { method: "POST", headers: auth ? { authorization: auth } : {} }), deps);
    expect((await unlock()).status).toBe(401);
    expect((await unlock("Bearer nope")).status).toBe(401);
    expect(await config(deps)).toMatchObject({ available: false });
    expect((await unlock(`Bearer ${TOKEN}`)).status).toBe(200);
    expect(await config(deps)).toMatchObject({ available: true });
  });

  it("counts and logs the event without content", async () => {
    const marker = "CREDIT-MARKER-77ab";
    const { deps, storage, log } = setup(failingGemini(402, { error: { message: `echo ${marker}` } }));
    await analyse(deps, { resume: `${RESUME} ${marker}`, jobDescription: JOB });
    await analyse(deps, { resume: RESUME, jobDescription: JOB });
    const metrics = storage.get("metrics") as Record<string, Record<string, number>>;
    expect(Object.values(metrics)[0]).toMatchObject({ out_of_credit: 1 });
    expect(log.events.map((e) => e.event)).toContain("out_of_credit");
    expect(JSON.stringify(log.events) + JSON.stringify([...storage.entries()])).not.toContain(marker);
  });
});
