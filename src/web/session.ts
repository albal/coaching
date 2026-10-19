import { MAX_CHAT_TURNS, userTurns, type ChatTurn } from "../shared/chat";
import type { AnalysisContext, Report, SectionName } from "../shared/report";

export type { ChatTurn };

// The browser Session model: the only store of user content (ADR-0001).
// Pure functions over immutable state; no DOM, no storage.

export const MAX_ANALYSES = 3;

export type AnalysisStatus = "running" | "complete" | "failed";

export interface Analysis {
  id: string;
  jobDescription: string;
  context: AnalysisContext;
  report: Report;
  status: AnalysisStatus;
  error?: string;
  errorCode?: string;
  downloaded: boolean;
  chat: ChatTurn[];
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

export function addAnalysis(s: Session, id: string, jobDescription: string, context: AnalysisContext = {}): Result {
  if (s.resume === null) return { ok: false, reason: "no_resume" };
  if (!jobDescription.trim()) return { ok: false, reason: "empty" };
  if (!canAddAnalysis(s)) return { ok: false, reason: "limit" };
  const analysis: Analysis = { id, jobDescription, context, report: {}, status: "running", downloaded: false, chat: [] };
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

export function failAnalysis(s: Session, id: string, message: string, code?: string): Session {
  return update(s, id, (a) => ({ ...a, status: "failed", error: message, ...(code && { errorCode: code }) }));
}

export function getAnalysis(s: Session, id: string): Analysis | undefined {
  return s.analyses.find((a) => a.id === id);
}

export function markDownloaded(s: Session, ids: string[]): Session {
  return { ...s, analyses: s.analyses.map((a) => (ids.includes(a.id) ? { ...a, downloaded: true } : a)) };
}

// Drives the leave-page warning: a finished Report the user hasn't saved.
export function hasUndownloadedReports(s: Session): boolean {
  return s.analyses.some((a) => a.status === "complete" && !a.downloaded);
}

// Ending a Session deletes everything: the result is a brand new Session.
// Changing the Resume does the same, since it would make every Report stale
// (the UI offers a download first).
export function endSession(_s: Session): Session {
  return createSession();
}

export function canChat(s: Session, id: string): boolean {
  const a = getAnalysis(s, id);
  return a?.status === "complete" && userTurns(a.chat) < MAX_CHAT_TURNS;
}

export function chatQuestionsLeft(s: Session, id: string): number {
  const a = getAnalysis(s, id);
  return a ? Math.max(0, MAX_CHAT_TURNS - userTurns(a.chat)) : 0;
}

// Records one finished exchange, so history always ends on the coach's reply.
export function recordExchange(s: Session, id: string, question: string, reply: string): Result {
  if (!canChat(s, id)) return { ok: false, reason: "chat_limit" };
  return {
    ok: true,
    session: update(s, id, (a) => ({
      ...a,
      chat: [...a.chat, { role: "user", text: question }, { role: "model", text: reply }],
    })),
  };
}
