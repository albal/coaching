import { describe, expect, it } from "vitest";
import {
  addAnalysis,
  canAddAnalysis,
  completeAnalysis,
  createSession,
  endSession,
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
    s = failAnalysis(s, "a", "boom");
    s = ok(addAnalysis(s, "b", JOB));
    expect(s.analyses.map((a) => a.id)).toEqual(["b"]);
  });
});

describe("multiple Analyses", () => {
  const withResume = () => ok(setResume(createSession(), RESUME));

  it("allows up to three Analyses against one Resume and refuses a fourth", () => {
    let s = withResume();
    for (const id of ["a", "b", "c"]) s = completeAnalysis(ok(addAnalysis(s, id, JOB)), id);
    expect(s.analyses.map((a) => a.id)).toEqual(["a", "b", "c"]);
    expect(canAddAnalysis(s)).toBe(false);
    expect(addAnalysis(s, "d", JOB)).toEqual({ ok: false, reason: "limit" });
  });

  it("does not count failed Analyses towards the limit", () => {
    let s = withResume();
    s = ok(addAnalysis(s, "a", JOB));
    s = ok(addAnalysis(s, "b", JOB));
    s = failAnalysis(ok(addAnalysis(s, "c", JOB)), "c", "boom");
    expect(canAddAnalysis(s)).toBe(true);
  });

  it("starts a new Session with no Analyses when the Resume is replaced", () => {
    let s = completeAnalysis(ok(addAnalysis(withResume(), "a", JOB)), "a");
    s = endSession(s);
    expect(s.analyses).toEqual([]);
    s = ok(setResume(s, "A different Resume"));
    expect(s).toEqual({ resume: "A different Resume", analyses: [] });
  });
});
