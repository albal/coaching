import { describe, expect, it } from "vitest";
import { fileNameFor, reportToMarkdown, sessionToMarkdown } from "../../src/web/export";
import {
  addAnalysis,
  completeAnalysis,
  createSession,
  endSession,
  failAnalysis,
  getAnalysis,
  hasUndownloadedReports,
  markDownloaded,
  recordSection,
  setResume,
  type Session,
} from "../../src/web/session";
import { SCRIPT, JOB, RESUME } from "../support/fixtures";

const BOOKING = "https://cal.com/al/coaching";

function ok(r: { ok: true; session: Session } | { ok: false; reason: string }): Session {
  if (!r.ok) throw new Error(r.reason);
  return r.session;
}

function completed(s: Session, id: string): Session {
  s = ok(addAnalysis(s, id, JOB));
  for (const [section, data] of Object.entries(SCRIPT)) s = recordSection(s, id, section as keyof typeof SCRIPT, data);
  return completeAnalysis(s, id);
}

describe("Markdown export", () => {
  const session = completed(ok(setResume(createSession(), RESUME)), "a");
  const analysis = getAnalysis(session, "a")!;
  const md = reportToMarkdown(analysis, { bookingUrl: BOOKING });

  it("contains every Report section", () => {
    for (const heading of ["# Report: Senior Platform Engineer", "## Fit Band: Stretch", "## Gaps", "## Plan", "## Resume suggestions", "## Interview prep"]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain(SCRIPT.assess.reason);
    expect(md).toContain("> Cut deploy time from 40 to 6 minutes with GitLab CI.");
    expect(md).toContain(SCRIPT.plan.recommendation.reason);
    expect(md).toContain(SCRIPT.rewrites.bullets[0]!.rewritten);
    expect(md).toContain("AI-generated, check before use");
    expect(md).toContain("### System design");
    expect(md).toContain(SCRIPT.interview.questions[0]!.question);
  });

  it("ends with the booking link", () => {
    expect(md).toContain(`[Book a session with Al](${BOOKING})`);
    expect(reportToMarkdown(analysis, { bookingUrl: "" })).not.toContain("Book a session");
  });

  it("can include the Coaching Chat transcript", () => {
    const withChat = { ...analysis, chat: [{ role: "user" as const, text: "How do I learn ArgoCD?" }, { role: "model" as const, text: "Start with the getting-started guide." }] };
    expect(reportToMarkdown(withChat, { bookingUrl: BOOKING })).not.toContain("How do I learn ArgoCD?");
    const md = reportToMarkdown(withChat, { bookingUrl: BOOKING, includeChat: true });
    expect(md).toContain("## Coaching Chat");
    expect(md).toContain("**You:** How do I learn ArgoCD?");
    expect(md).toContain("**Coach:** Start with the getting-started guide.");
  });

  it("names the file after the job title", () => {
    expect(fileNameFor("Senior Platform Engineer (Remote)")).toBe("devops-coach-senior-platform-engineer-remote.md");
    expect(fileNameFor("!!!")).toBe("devops-coach-report.md");
  });
});

describe("Download all Reports", () => {
  it("exports every finished Analysis and skips unfinished ones", () => {
    let s = completed(ok(setResume(createSession(), RESUME)), "a");
    s = { ...s, analyses: [...s.analyses, { ...getAnalysis(s, "a")!, id: "b", status: "running" }] };
    const md = sessionToMarkdown(s, { bookingUrl: BOOKING });
    expect(md.match(/^# Report:/gm)).toHaveLength(1);
  });
});

describe("download tracking and ending the Session", () => {
  it("knows when a finished Report hasn't been downloaded", () => {
    let s = ok(addAnalysis(ok(setResume(createSession(), RESUME)), "a", JOB));
    expect(hasUndownloadedReports(s)).toBe(false); // still running
    s = completeAnalysis(s, "a");
    expect(hasUndownloadedReports(s)).toBe(true);
    s = markDownloaded(s, ["a"]);
    expect(hasUndownloadedReports(s)).toBe(false);
  });

  it("clears everything when the Session ends", () => {
    const s = completed(ok(setResume(createSession(), RESUME)), "a");
    expect(endSession(s)).toEqual(createSession());
  });
});

describe("Reports cut short", () => {
  it("can still be downloaded once Fit and Gaps have arrived", () => {
    let s = ok(addAnalysis(ok(setResume(createSession(), RESUME)), "a", JOB));
    s = recordSection(s, "a", "extract", SCRIPT.extract);
    s = recordSection(s, "a", "assess", SCRIPT.assess);
    s = failAnalysis(s, "a", "out of credit", "out_of_credit");
    expect(hasUndownloadedReports(s)).toBe(true);
    const md = sessionToMarkdown(s, { bookingUrl: BOOKING });
    expect(md).toContain("## Fit Band: Stretch");
    expect(md).not.toContain("## Plan");
  });

  it("are not downloadable if they failed before the Fit Band", () => {
    const s = failAnalysis(ok(addAnalysis(ok(setResume(createSession(), RESUME)), "a", JOB)), "a", "boom");
    expect(hasUndownloadedReports(s)).toBe(false);
    expect(sessionToMarkdown(s, { bookingUrl: BOOKING })).toBe("");
  });
});
