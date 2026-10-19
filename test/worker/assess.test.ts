import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { constrainFitBand, type Requirement } from "../../src/shared/report";
import { COACH_SYSTEM } from "../../src/worker/prompts";
import { captureLogger, fakeGemini } from "../support/fake-gemini";
import { ASSESS, EXTRACT, JOB, RESUME } from "../support/fixtures";
import { analyse } from "../support/worker";

function run(assess: unknown) {
  const gemini = fakeGemini({ extract: EXTRACT, assess });
  return { gemini, result: analyse({ gemini: gemini.client, log: captureLogger().logger }, { resume: RESUME, jobDescription: JOB }) };
}

const req = (mustHave: boolean, evidence: Requirement["evidence"]): Requirement => ({
  text: "x",
  mustHave,
  area: "Cloud",
  evidence,
  quote: evidence === "missing" ? "" : "line",
  transfer: "",
});

describe("Assess section", () => {
  it("streams the requirements map, seniority, hidden strengths and red flags after extract", async () => {
    const { events } = await run(ASSESS).result;
    expect(events.map((e) => (e.type === "section" ? e.section : e.type))).toEqual(["extract", "assess", "done"]);
    expect(events[1]).toEqual({ type: "section", section: "assess", data: ASSESS });
  });

  it("includes the Fit Band definitions word for word from GLOSSARY.md in the system prompt", async () => {
    const glossary = readFileSync(new URL("../../GLOSSARY.md", import.meta.url), "utf8");
    const definitions = glossary.split("\n").filter((l) => /^- \*\*(Strong fit|Stretch|Long shot)\*\*:/.test(l));
    expect(definitions).toHaveLength(3);
    for (const line of definitions) expect(COACH_SYSTEM).toContain(line);
    const { gemini, result } = run(ASSESS);
    await result;
    expect(gemini.calls.find((c) => c.section === "assess")?.system).toBe(COACH_SYSTEM);
  });

  it("retries when strong or partial evidence has no Resume quote", async () => {
    const unquoted = { ...ASSESS, requirements: [{ ...ASSESS.requirements[0]!, quote: "" }] };
    const { gemini, result } = run([unquoted, ASSESS]);
    const { events } = await result;
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(gemini.calls.filter((c) => c.section === "assess")).toHaveLength(2);
  });

  it("corrects a Fit Band that contradicts the Must-have Gaps", async () => {
    const tooKind = { ...ASSESS, fitBand: "strong_fit" };
    const { events } = await run(tooKind).result;
    expect(events[1]).toMatchObject({ data: { fitBand: "stretch" } });
  });
});

describe("constrainFitBand", () => {
  it("is Strong fit when no Must-have has a Gap, whatever the model said", () => {
    expect(constrainFitBand("long_shot", [req(true, "strong"), req(false, "missing")])).toBe("strong_fit");
  });
  it("leaves one or two Must-have Gaps to the model's judgement, but never Strong fit", () => {
    expect(constrainFitBand("stretch", [req(true, "partial")])).toBe("stretch");
    expect(constrainFitBand("long_shot", [req(true, "missing"), req(true, "partial")])).toBe("long_shot");
    expect(constrainFitBand("strong_fit", [req(true, "missing")])).toBe("stretch");
  });
  it("is Long shot with more than two Must-have Gaps", () => {
    expect(constrainFitBand("stretch", [req(true, "missing"), req(true, "missing"), req(true, "partial")])).toBe("long_shot");
  });
});
