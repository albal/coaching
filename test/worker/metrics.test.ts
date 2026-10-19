import { describe, expect, it } from "vitest";
import { handleApi, type Deps } from "../../src/worker/app";
import { UsageGuard, usageClient } from "../../src/worker/usage-guard";
import { memoryStorage } from "../support/env";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { JOB, RESUME, SCRIPT } from "../support/fixtures";
import { openProtection } from "../support/protection";
import { analyse } from "../support/worker";

function setup(token = "metrics-token") {
  const { map, storage } = memoryStorage();
  const guard = new UsageGuard({ storage });
  const usage = usageClient({ idFromName: (n) => n, get: () => guard }, { perHour: 100, perDay: 100 }, async (ip) => `h-${ip.length}`);
  const deps: Deps = {
    gemini: fakeGemini(SCRIPT).client,
    log: captureLogger().logger,
    protection: openProtection({ usage }).protection,
    metrics: usage,
    metricsToken: token,
  };
  return { deps, storage: map };
}

const event = (name: unknown) =>
  new Request("https://coach.test/api/event", { method: "POST", body: JSON.stringify({ name }) });
const read = (auth?: string) =>
  new Request("https://coach.test/api/metrics", { headers: auth ? { authorization: auth } : {} });

describe("usage metrics", () => {
  it("counts finished Analyses, downloads and booking-link clicks per day", async () => {
    const { deps } = setup();
    await analyse(deps, { resume: RESUME, jobDescription: JOB });
    expect((await handleApi(event("download"), deps)).status).toBe(204);
    await handleApi(event("download"), deps);
    await handleApi(event("booking_click"), deps);
    const res = await handleApi(read("Bearer metrics-token"), deps);
    const body = (await res.json()) as { days: Record<string, unknown>; totals: unknown };
    expect(body.totals).toEqual({ analysis_completed: 1, download: 2, booking_click: 1, out_of_credit: 0 });
    expect(Object.values(body.days)).toEqual([{ analysis_completed: 1, download: 2, booking_click: 1 }]);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses unknown events, and won't let the page claim an Analysis", async () => {
    const { deps, storage } = setup();
    for (const name of ["analysis_completed", "resume_text", 42, undefined]) {
      expect((await handleApi(event(name), deps)).status).toBe(400);
    }
    expect(storage.get("metrics")).toBeUndefined();
  });

  it("requires the metrics token, and is off without one", async () => {
    const { deps } = setup();
    expect((await handleApi(read(), deps)).status).toBe(401);
    expect((await handleApi(read("Bearer wrong-token!"), deps)).status).toBe(401);
    const off = setup("");
    expect((await handleApi(read("Bearer "), off.deps)).status).toBe(404);
  });

  it("stores no user content", async () => {
    const { deps, storage } = setup();
    const marker = "METRIC-MARKER-0d1e";
    await analyse(deps, { resume: `${RESUME} ${marker}`, jobDescription: `${JOB} ${marker}` });
    await handleApi(event("download"), deps);
    expect([...storage.keys()].sort()).toEqual(["daily", "metrics"]);
    expect(JSON.stringify([...storage.entries()])).not.toContain(marker);
  });

  it("keeps 90 days of metrics", async () => {
    let now = Date.UTC(2026, 0, 1);
    const { map, storage } = memoryStorage();
    const guard = new UsageGuard({ storage }, undefined, () => now);
    await guard.count("download");
    now += 91 * 24 * 60 * 60 * 1000;
    await guard.count("download");
    expect(Object.keys(map.get("metrics") as object)).toEqual(["2026-04-02"]);
  });
});
