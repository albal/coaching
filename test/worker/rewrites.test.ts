import { describe, expect, it } from "vitest";
import { openProtection } from "../support/protection";
import { inventsNumbers } from "../../src/shared/report";
import { COACH_SYSTEM } from "../../src/worker/prompts";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { JOB, RESUME, REWRITES, SCRIPT } from "../support/fixtures";
import { analyse } from "../support/worker";

function run(rewrites: unknown) {
  const gemini = fakeGemini({ ...SCRIPT, rewrites });
  return { gemini, result: analyse({ gemini: gemini.client, log: captureLogger().logger, protection: openProtection().protection }, { resume: RESUME, jobDescription: JOB }) };
}

const bullet = REWRITES.bullets[0]!;
const rewriteCalls = (g: ReturnType<typeof fakeGemini>) => g.calls.filter((c) => c.section === "rewrites");

describe("Resume rewrites section", () => {
  it("streams rewrites, honest keywords and a tailored summary", async () => {
    const { result } = run(REWRITES);
    const { events } = await result;
    expect(events).toContainEqual({ type: "section", section: "rewrites", data: REWRITES });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  it("states the never-invent rule in the system prompt and the rewrites prompt", async () => {
    const { gemini, result } = run(REWRITES);
    await result;
    expect(COACH_SYSTEM).toMatch(/never invent experience, employers, certifications or numbers/i);
    expect(rewriteCalls(gemini)[0]!.prompt).toMatch(/never invent/i);
  });

  it("rejects a rewrite that invents a number, then retries", async () => {
    const invented = { ...REWRITES, bullets: [{ ...bullet, rewritten: "Cut deploy time from 40 to 6 minutes, saving 12 hours a week.", placeholders: [] }] };
    const { gemini, result } = run([invented, REWRITES]);
    expect((await result).events.at(-1)).toEqual({ type: "done" });
    expect(rewriteCalls(gemini)).toHaveLength(2);
  });

  it("rejects a rewrite whose original line is not in the Resume", async () => {
    const madeUp = { ...REWRITES, bullets: [{ ...bullet, original: "Led a team of 10 SREs at Google." }] };
    const { gemini, result } = run(madeUp);
    expect((await result).events.at(-1)).toMatchObject({ type: "error", code: "model_invalid" });
    expect(rewriteCalls(gemini)).toHaveLength(2);
  });

  it("rejects listed placeholders that do not appear in the rewrite", async () => {
    const missing = { ...REWRITES, bullets: [{ ...bullet, placeholders: ["[X%]"] }] };
    const { result } = run(missing);
    expect((await result).events.at(-1)).toMatchObject({ type: "error", code: "model_invalid" });
  });
});

describe("inventsNumbers", () => {
  it("allows numbers from the original and numbers inside placeholders", () => {
    expect(inventsNumbers("Cut time from 40 to 6 minutes", "Reduced time 40 → 6 minutes for [20+] teams")).toBe(false);
  });
  it("flags numbers that are not in the original", () => {
    expect(inventsNumbers("Ran EKS", "Ran EKS for 40 services")).toBe(true);
  });
});
