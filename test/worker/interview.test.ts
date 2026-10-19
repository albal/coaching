import { describe, expect, it } from "vitest";
import { openProtection } from "../support/protection";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { INTERVIEW, JOB, RESUME, SCRIPT } from "../support/fixtures";
import { analyse } from "../support/worker";

function run(interview: unknown) {
  const gemini = fakeGemini({ ...SCRIPT, interview });
  return { gemini, result: analyse({ gemini: gemini.client, log: captureLogger().logger, protection: openProtection().protection }, { resume: RESUME, jobDescription: JOB }) };
}

describe("Interview prep section", () => {
  it("streams 10–20 typed questions with what they test and linked Resume stories", async () => {
    const { gemini, result } = run(INTERVIEW);
    const { events } = await result;
    expect(events).toContainEqual({ type: "section", section: "interview", data: INTERVIEW });
    const prompt = gemini.calls.find((c) => c.section === "interview")!.prompt;
    expect(prompt).toMatch(/technical[\s\S]*scenario[\s\S]*system design[\s\S]*behavioural/i);
    expect(prompt).toContain("<resume>");
  });

  it("starts only after Assess, alongside Plan and Resume rewrites", async () => {
    const { gemini, result } = run(INTERVIEW);
    await result;
    const order = gemini.calls.map((c) => c.section);
    expect(order.slice(0, 2)).toEqual(["extract", "assess"]);
    expect(order.slice(2).sort()).toEqual(["interview", "plan", "rewrites"]);
  });

  it("rejects fewer than 10 or more than 20 questions", async () => {
    for (const n of [9, 21]) {
      const { result } = run({ questions: Array.from({ length: n }, () => INTERVIEW.questions[0]) });
      expect((await result).events.at(-1)).toMatchObject({ type: "error", code: "model_invalid" });
    }
  });
});
