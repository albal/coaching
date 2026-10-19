import { describe, expect, it } from "vitest";
import { openProtection } from "../support/protection";
import { handleApi } from "../../src/worker/app";
import type { GeminiClient } from "../../src/worker/gemini";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { JOB, PLAN, RESUME, SCRIPT } from "../support/fixtures";
import { analyse, post } from "../support/worker";

function setup(script: Parameters<typeof fakeGemini>[0] = SCRIPT) {
  const gemini = fakeGemini(script);
  return { gemini, deps: { gemini: gemini.client, log: captureLogger().logger, protection: openProtection().protection } };
}

describe("Plan section", () => {
  it("streams the plan as its own section after Assess", async () => {
    const { deps } = setup();
    const { events } = await analyse(deps, { resume: RESUME, jobDescription: JOB });
    const sections = events.flatMap((e) => (e.type === "section" ? [e.section] : []));
    expect(sections.indexOf("plan")).toBeGreaterThan(sections.indexOf("assess"));
    expect(events).toContainEqual({ type: "section", section: "plan", data: PLAN });
  });

  it("does not start the Plan step until Assess has finished", async () => {
    const { gemini, deps } = setup();
    const order: string[] = [];
    const tracking: GeminiClient = {
      ...gemini.client,
      async generateJson(req) {
        const n = gemini.calls.length;
        const pending = gemini.client.generateJson(req);
        const section = gemini.calls[n]!.section;
        order.push(`start:${section}`);
        const out = await pending;
        order.push(`end:${section}`);
        return out;
      },
    };
    await analyse({ ...deps, gemini: tracking }, { resume: RESUME, jobDescription: JOB });
    expect(order.indexOf("end:assess")).toBeLessThan(order.indexOf("start:plan"));
  });

  it("passes the optional context and the Report so far to the Plan step", async () => {
    const { gemini, deps } = setup();
    await analyse(deps, { resume: RESUME, jobDescription: JOB, context: { seniority: "Senior", hoursPerWeek: 6, timeline: "3 weeks" } });
    const prompt = gemini.calls.find((c) => c.section === "plan")!.prompt;
    expect(prompt).toMatch(/<candidate_context>[\s\S]*Target seniority: Senior[\s\S]*Hours per week available for study: 6[\s\S]*Target timeline: 3 weeks[\s\S]*<\/candidate_context>/);
    expect(prompt).toContain('"fitBand":"stretch"');
  });

  it("tells the model when no hours or timeline were given", async () => {
    const { gemini, deps } = setup();
    await analyse(deps, { resume: RESUME, jobDescription: JOB });
    expect(gemini.calls.find((c) => c.section === "plan")!.prompt).toContain("gave no hours per week or timeline");
  });

  it("rejects invalid context", async () => {
    const { deps } = setup();
    for (const context of [{ hoursPerWeek: 0 }, { hoursPerWeek: "six" }, { timeline: "x".repeat(101) }]) {
      const res = await handleApi(post("/api/analyse", { resume: RESUME, jobDescription: JOB, context, consent: true }), deps);
      expect(res.status).toBe(400);
    }
  });

  it("still delivers the other sections when the plan fails, then reports an error", async () => {
    const { deps } = setup({ ...SCRIPT, plan: { raw: "nope" } });
    const { events } = await analyse(deps, { resume: RESUME, jobDescription: JOB });
    expect(events.filter((e) => e.type === "section").map((e) => (e as { section: string }).section)).toEqual(expect.arrayContaining(["extract", "assess", "rewrites", "interview"]));
    expect(events.some((e) => e.type === "section" && e.section === "plan")).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "model_invalid" });
  });
});
