import { describe, expect, it } from "vitest";
import {
  addAnalysis,
  canAddAnalysis,
  completeAnalysis,
  createSession,
  failAnalysis,
  getAnalysis,
  recordSection,
  setResume,
  type Session,
} from "../../src/web/session";
import { ASSESS, JOB, RESUME } from "../support/fixtures";

function ok(r: { ok: true; session: Session } | { ok: false; reason: string }): Session {
  if (!r.ok) throw new Error(r.reason);
  return r.session;
}

describe("Session model", () => {
  it("starts empty", () => {
    expect(createSession()).toEqual({ resume: null, analyses: [] });
  });

  it("accepts a Resume once", () => {
    const s = ok(setResume(createSession(), RESUME));
    expect(s.resume).toBe(RESUME);
    expect(setResume(s, "another")).toEqual({ ok: false, reason: "resume_already_set" });
    expect(setResume(createSession(), "  ")).toEqual({ ok: false, reason: "empty" });
  });

  it("needs a Resume before an Analysis", () => {
    expect(addAnalysis(createSession(), "a", JOB)).toEqual({ ok: false, reason: "no_resume" });
  });

  it("records streamed sections and completion on the Analysis", () => {
    let s = ok(addAnalysis(ok(setResume(createSession(), RESUME)), "a", JOB));
    expect(getAnalysis(s, "a")).toMatchObject({ status: "running", report: {}, downloaded: false });
    s = completeAnalysis(recordSection(s, "a", "assess", ASSESS), "a");
    expect(getAnalysis(s, "a")).toMatchObject({ status: "complete", report: { assess: ASSESS } });
  });

  it("allows a retry to replace a failed Analysis", () => {
    let s = ok(addAnalysis(ok(setResume(createSession(), RESUME)), "a", JOB));
    expect(canAddAnalysis(s)).toBe(false);
    s = failAnalysis(s, "a", "boom");
    expect(canAddAnalysis(s)).toBe(true);
    s = ok(addAnalysis(s, "b", JOB));
    expect(s.analyses.map((a) => a.id)).toEqual(["b"]);
  });
});
