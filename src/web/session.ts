import type { Report, SectionName } from "../shared/report";

// The browser Session model: the only store of user content (ADR-0001).
// Pure functions over immutable state; no DOM, no storage.

export const MAX_ANALYSES = 1;

export type AnalysisStatus = "running" | "complete" | "failed";

export interface Analysis {
  id: string;
  jobDescription: string;
  report: Report;
  status: AnalysisStatus;
  error?: string;
  downloaded: boolean;
}

export interface Session {
  resume: string | null;
  analyses: Analysis[];
}

export type Result = { ok: true; session: Session } | { ok: false; reason: string };

export function createSession(): Session {
  return { resume: null, analyses: [] };
}

export function setResume(s: Session, text: string): Result {
  if (s.resume !== null) return { ok: false, reason: "resume_already_set" };
  if (!text.trim()) return { ok: false, reason: "empty" };
  return { ok: true, session: { ...s, resume: text } };
}

function liveAnalyses(s: Session): Analysis[] {
  return s.analyses.filter((a) => a.status !== "failed");
}

export function canAddAnalysis(s: Session): boolean {
  return s.resume !== null && liveAnalyses(s).length < MAX_ANALYSES;
}

export function addAnalysis(s: Session, id: string, jobDescription: string): Result {
  if (s.resume === null) return { ok: false, reason: "no_resume" };
  if (!jobDescription.trim()) return { ok: false, reason: "empty" };
  if (!canAddAnalysis(s)) return { ok: false, reason: "limit" };
  const analysis: Analysis = { id, jobDescription, report: {}, status: "running", downloaded: false };
  // A failed Analysis is replaced, not kept alongside its retry.
  return { ok: true, session: { ...s, analyses: [...liveAnalyses(s), analysis] } };
}

function update(s: Session, id: string, fn: (a: Analysis) => Analysis): Session {
  return { ...s, analyses: s.analyses.map((a) => (a.id === id ? fn(a) : a)) };
}

export function recordSection(s: Session, id: string, section: SectionName, data: unknown): Session {
  return update(s, id, (a) => ({ ...a, report: { ...a.report, [section]: data } }));
}

export function completeAnalysis(s: Session, id: string): Session {
  return update(s, id, (a) => ({ ...a, status: "complete" }));
}

export function failAnalysis(s: Session, id: string, message: string): Session {
  return update(s, id, (a) => ({ ...a, status: "failed", error: message }));
}

export function getAnalysis(s: Session, id: string): Analysis | undefined {
  return s.analyses.find((a) => a.id === id);
}
