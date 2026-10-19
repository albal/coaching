import type { AnalysisContext, AnalysisEvent } from "../shared/report";
import { streamAnalysis, streamChat, verify } from "./api";
import { mountTurnstile, takeToken } from "./turnstile";
import { h } from "./dom";
import { fileNameFor, reportToMarkdown, reportsOf, sessionToMarkdown, titleOf } from "./export";
import { EXTRACT_MESSAGES, extractText } from "./extract";
import { printView, tabsFor } from "./render";
import { FIT_BAND_LABELS } from "../shared/report";
import {
  addAnalysis,
  completeAnalysis,
  createSession,
  endSession,
  failAnalysis,
  getAnalysis,
  canAddAnalysis,
  canChat,
  chatQuestionsLeft,
  recordExchange,
  hasUndownloadedReports,
  MAX_ANALYSES,
  markDownloaded,
  recordSection,
  setResume,
  type Analysis,
  type Session,
} from "./session";

// All Session state lives in this variable and nowhere else (ADR-0001).
let session: Session = createSession();
let currentId: string | null = null;
let activeTab = "fit";
let bookingUrl = "";
let turnstileSiteKey = "";
// The pass from the Turnstile check: in memory only, gone with the tab.
let pass: string | null = null;
// The question and reply in flight; recorded on the Session only once complete.
let pendingChat: { id: string; question: string; reply: string } | null = null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>("analysis-form");
const resumeInput = $<HTMLTextAreaElement>("resume");
const jdInput = $<HTMLTextAreaElement>("job-description");
const formError = $("form-error");
const analyseButton = $<HTMLButtonElement>("analyse");
const reportEl = $("report");
const statusEl = $("report-status");

function showFormError(message: string | null) {
  formError.hidden = !message;
  formError.textContent = message ?? "";
}

function renderBooking() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-booking]")) el.hidden = !bookingUrl;
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-booking-link]")) a.href = bookingUrl || "#";
}

function renderSwitcher() {
  const nav = $("analyses");
  const live = session.analyses.filter((a) => a.status !== "failed");
  nav.hidden = live.length < 2;
  nav.replaceChildren(
    ...live.map((a, i) => {
      const band = a.report.assess ? ` · ${FIT_BAND_LABELS[a.report.assess.fitBand]}` : "";
      const label = `${i + 1}. ${a.report.extract ? titleOf(a) : "Analysing…"}${band}`;
      const button = h("button", { type: "button", "aria-current": a.id === currentId ? "true" : "false" }, label);
      button.addEventListener("click", () => {
        currentId = a.id;
        render();
      });
      return button;
    }),
  );
}

function renderForm() {
  const hasResume = session.resume !== null;
  const live = session.analyses.filter((a) => a.status !== "failed").length;
  const running = session.analyses.some((a) => a.status === "running");
  $("change-resume").hidden = !hasResume;
  analyseButton.textContent = live > 0 ? "Analyse another Job Description" : "Analyse";
  analyseButton.disabled = running || (hasResume && !canAddAnalysis(session));
  const left = $("analyses-left");
  left.hidden = !hasResume;
  left.textContent = canAddAnalysis(session)
    ? `You can analyse ${MAX_ANALYSES - live} more Job Description${MAX_ANALYSES - live === 1 ? "" : "s"} against this Resume.`
    : `You've analysed ${MAX_ANALYSES} Job Descriptions, the most for one Session. Download your Reports, then change your Resume or end the Session to start again.`;
}

function render() {
  const analysis = currentId ? getAnalysis(session, currentId) : undefined;
  $("end-session").hidden = session.resume === null;
  renderForm();
  renderSwitcher();
  reportEl.hidden = !analysis;
  if (!analysis) return;
  $("off-domain").hidden = analysis.report.extract?.job.isDevOpsRelated !== false;
  $("report-title").textContent = analysis.report.extract ? `Your Report: ${titleOf(analysis)}` : "Your Report";
  renderTabs(analysis);
  statusEl.textContent =
    analysis.status !== "running"
      ? ""
      : !analysis.report.extract
        ? "Reading your Resume and the Job Description…"
        : !analysis.report.assess
          ? "Assessing your fit…"
          : "Building your plan, Resume suggestions and interview prep…";
  $("report-error").hidden = analysis.status !== "failed";
  $("report-error-text").textContent = analysis.error ?? "";
  $("report-error").querySelector<HTMLElement>("[data-busy-booking]")!.hidden = analysis.errorCode !== "busy" || !bookingUrl;
  $("retry").hidden = analysis.errorCode === "busy";
  $("report-actions").hidden = analysis.status !== "complete";
  $("download-all").hidden = reportsOf(session).length < 2;
  renderChat(analysis);
}

function renderChat(analysis: Analysis) {
  const section = $("chat");
  section.hidden = analysis.status !== "complete";
  if (section.hidden) return;
  const turns = [...analysis.chat];
  const pending = pendingChat?.id === analysis.id ? pendingChat : null;
  if (pending) turns.push({ role: "user", text: pending.question }, { role: "model", text: pending.reply || "…" });
  $("chat-log").replaceChildren(
    ...turns.map((t) => h("li", { class: `chat-turn chat-${t.role}` }, h("p", { class: "chat-who" }, t.role === "user" ? "You" : "Coach"), h("p", null, t.text))),
  );
  const left = chatQuestionsLeft(session, analysis.id);
  $("chat-left").textContent = left
    ? `${left} question${left === 1 ? "" : "s"} left in this Coaching Chat.`
    : "You've reached the limit for this Coaching Chat. Download your Report to keep it, or book a session for more help.";
  $<HTMLButtonElement>("chat-send").disabled = !!pendingChat || !canChat(session, analysis.id);
  $<HTMLTextAreaElement>("chat-input").disabled = !canChat(session, analysis.id);
}

async function ask(question: string) {
  const analysis = current();
  if (!analysis || pendingChat || !canChat(session, analysis.id)) return;
  const id = analysis.id;
  const chatError = $("chat-error");
  chatError.hidden = true;
  pendingChat = { id, question, reply: "" };
  $<HTMLTextAreaElement>("chat-input").value = "";
  render();
  let failed: string | null = null;
  const currentPass = await ensurePass();
  if (!currentPass) failed = NEEDS_CHECK;
  else
    await streamChat(
      { resume: session.resume!, jobDescription: analysis.jobDescription, report: analysis.report, history: analysis.chat, message: question },
      currentPass,
      (e) => {
        if (!pendingChat || pendingChat.id !== id) return;
        if (e.type === "delta") pendingChat.reply += e.text;
        else if (e.type === "error") {
          if (e.code === "verification_required") pass = null;
          failed = e.code === "verification_required" ? NEEDS_CHECK : e.message;
        }
        render();
      },
    );
  const reply = pendingChat?.id === id ? pendingChat.reply.trim() : "";
  pendingChat = null;
  if (!getAnalysis(session, id)) return; // the Session ended mid-reply
  if (failed || !reply) {
    // Nothing is recorded, so the question can simply be asked again.
    $<HTMLTextAreaElement>("chat-input").value = question;
    chatError.textContent = failed ?? "The coach didn't reply. Please try again.";
    chatError.hidden = false;
  } else {
    const recorded = recordExchange(session, id, question, reply);
    if (recorded.ok) session = recorded.session;
  }
  render();
}

function renderTabs(analysis: Analysis) {
  const tabs = tabsFor(analysis);
  const tablist = $("tabs");
  const panel = $("tab-panel");
  tablist.hidden = panel.hidden = tabs.length === 0;
  if (!tabs.some((t) => t.id === activeTab)) activeTab = tabs[0]?.id ?? "fit";
  tablist.replaceChildren(
    ...tabs.map((t) => {
      const selected = t.id === activeTab;
      const button = h(
        "button",
        { type: "button", role: "tab", id: `tab-${t.id}`, "aria-selected": String(selected), tabindex: selected ? "0" : "-1" },
        t.label,
      );
      button.addEventListener("click", () => {
        activeTab = t.id;
        renderTabs(analysis);
        document.getElementById(`tab-${t.id}`)?.focus();
      });
      button.addEventListener("keydown", (ev) => {
        if (ev.key !== "ArrowRight" && ev.key !== "ArrowLeft") return;
        const next = tabs[(tabs.indexOf(t) + (ev.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
        if (next) document.getElementById(`tab-${next.id}`)?.click();
      });
      return button;
    }),
  );
  const active = tabs.find((t) => t.id === activeTab);
  panel.setAttribute("aria-labelledby", `tab-${activeTab}`);
  panel.replaceChildren(active ? active.render() : "");
}

function readContext(): AnalysisContext {
  const seniority = $<HTMLInputElement>("ctx-seniority").value.trim();
  const hours = Number.parseInt($<HTMLInputElement>("ctx-hours").value, 10);
  const timeline = $<HTMLInputElement>("ctx-timeline").value.trim();
  return {
    ...(seniority && { seniority }),
    ...(hours >= 1 && hours <= 80 && { hoursPerWeek: hours }),
    ...(timeline && { timeline }),
  };
}

// Gets (or reuses) the pass that unlocks the coach for this Session.
async function ensurePass(): Promise<string | null> {
  if (pass) return pass;
  const token = turnstileSiteKey ? takeToken() : "";
  if (turnstileSiteKey && !token) return null;
  pass = await verify(token);
  return pass;
}

const NEEDS_CHECK = "Please complete the quick check below, then try again.";

async function run(jobDescription: string) {
  const currentPass = await ensurePass();
  if (!currentPass) {
    showFormError(NEEDS_CHECK);
    return;
  }
  const id = crypto.randomUUID();
  const context = readContext();
  const added = addAnalysis(session, id, jobDescription, context);
  if (!added.ok) {
    showFormError(added.reason === "limit" ? "You've reached the limit of Analyses for this Session." : "Please add a Job Description.");
    return;
  }
  session = added.session;
  currentId = id;
  activeTab = "fit";
  render();
  let finished = false;
  await streamAnalysis({ resume: session.resume!, jobDescription, context, consent: true }, currentPass, (e: AnalysisEvent) => {
    if (!getAnalysis(session, id)) return; // the Session ended mid-stream
    if (e.type === "section") session = recordSection(session, id, e.section, e.data);
    else if (e.type === "done") (session = completeAnalysis(session, id)), (finished = true);
    else if (e.type === "error") {
      if (e.code === "verification_required") pass = null;
      const message = e.code === "verification_required" ? NEEDS_CHECK : e.message;
      session = failAnalysis(session, id, message, e.code);
      finished = true;
    }
    render();
  });
  if (!finished && getAnalysis(session, id)) {
    session = failAnalysis(session, id, "The connection dropped before your Report finished. Please try again.");
    render();
  }
}

// Downloads are built in memory and handed straight to the browser.
function saveFile(name: string, markdown: string) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const includeChat = () => $<HTMLInputElement>("include-chat").checked;

function current(): Analysis | undefined {
  const analysis = currentId ? getAnalysis(session, currentId) : undefined;
  return analysis?.status === "complete" ? analysis : undefined;
}

function downloadCurrent() {
  const analysis = current();
  if (!analysis) return;
  saveFile(fileNameFor(titleOf(analysis)), reportToMarkdown(analysis, { bookingUrl, includeChat: includeChat() }));
  session = markDownloaded(session, [analysis.id]);
}

function downloadAll() {
  const reports = reportsOf(session);
  if (!reports.length) return;
  saveFile("devops-coach-all-reports.md", sessionToMarkdown(session, { bookingUrl, includeChat: includeChat() }));
  session = markDownloaded(session, reports.map((a) => a.id));
}

function printCurrent() {
  const analysis = current();
  if (!analysis) return;
  $("print-view").replaceChildren(printView(analysis, bookingUrl, includeChat()));
  session = markDownloaded(session, [analysis.id]);
  window.print();
}

function resetForm() {
  form.reset();
  resumeInput.readOnly = false;
  for (const id of ["resume-file-status", "jd-file-status"]) $(id).textContent = "";
  $("print-view").replaceChildren();
  showFormError(null);
}

function changeResume(download: boolean) {
  if (download) downloadAll();
  session = endSession(session);
  currentId = null;
  pendingChat = null;
  pass = null;
  resumeInput.readOnly = false;
  $("change-resume-panel").hidden = true;
  render();
  resumeInput.focus();
  resumeInput.select();
}

function end() {
  if (hasUndownloadedReports(session) && !confirm("You have Reports you haven't downloaded. End the Session and delete them?")) return;
  session = endSession(session);
  currentId = null;
  pendingChat = null;
  pass = null;
  resetForm();
  render();
  $("app").hidden = true;
  $("ended").hidden = false;
  $("ended").querySelector("h1")?.focus();
}

form.addEventListener("submit", (ev) => {
  ev.preventDefault();
  showFormError(null);
  const resume = resumeInput.value;
  const jobDescription = jdInput.value;
  if (!resume.trim() || !jobDescription.trim()) {
    showFormError("Please paste both your Resume and the Job Description.");
    return;
  }
  if (!$<HTMLInputElement>("consent").checked) {
    showFormError("Please tick the box to confirm you understand your text will be sent to Google Gemini.");
    $("consent").focus();
    return;
  }
  if (session.resume === null) {
    const set = setResume(session, resume);
    if (!set.ok) return showFormError("Please paste your Resume.");
    session = set.session;
    resumeInput.readOnly = true;
  } else if (!canAddAnalysis(session)) {
    return showFormError("You've reached the limit of Analyses for this Session.");
  }
  void run(jobDescription);
});

$("retry").addEventListener("click", () => void run(jdInput.value));
$("chat-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const question = $<HTMLTextAreaElement>("chat-input").value.trim();
  if (question) void ask(question);
});
$("chat-input").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && !ev.shiftKey) {
    ev.preventDefault();
    $<HTMLFormElement>("chat-form").requestSubmit();
  }
});
$("download").addEventListener("click", downloadCurrent);
$("download-all").addEventListener("click", downloadAll);
$("print").addEventListener("click", printCurrent);
$("end-session").addEventListener("click", end);
$("change-resume").addEventListener("click", () => {
  if (hasUndownloadedReports(session)) {
    $("change-resume-panel").hidden = false;
    $("change-download").focus();
  } else changeResume(false);
});
$("change-download").addEventListener("click", () => changeResume(true));
$("change-discard").addEventListener("click", () => changeResume(false));
$("change-cancel").addEventListener("click", () => {
  $("change-resume-panel").hidden = true;
  $("change-resume").focus();
});
$("restart").addEventListener("click", () => {
  $("ended").hidden = true;
  $("app").hidden = false;
  resumeInput.focus();
});

// Warn before a refresh or close would lose Reports that haven't been saved.
window.addEventListener("beforeunload", (ev) => {
  if (hasUndownloadedReports(session)) ev.preventDefault();
});

function wireUpload(inputId: string, target: HTMLTextAreaElement, statusId: string, noun: string) {
  const input = $<HTMLInputElement>(inputId);
  const status = $(statusId);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (target.readOnly) {
      status.textContent = "Your Resume is fixed for this Session.";
      return;
    }
    status.textContent = `Reading ${file.name}…`;
    status.classList.remove("error");
    const result = await extractText(file);
    if (result.ok) {
      target.value = result.text;
      status.textContent = `Read ${file.name}. Check the text above and fix anything that came out wrong.`;
      target.focus();
    } else {
      const message = EXTRACT_MESSAGES[result.reason];
      status.textContent = noun === "Resume" ? message : message.replace("your Resume", "the Job Description");
      status.classList.add("error");
    }
  });
}

wireUpload("resume-file", resumeInput, "resume-file-status", "Resume");
wireUpload("jd-file", jdInput, "jd-file-status", "Job Description");

void fetch("/api/config")
  .then((r) => r.json() as Promise<{ bookingUrl?: string; turnstileSiteKey?: string }>)
  .then((c) => {
    bookingUrl = c.bookingUrl ?? "";
    turnstileSiteKey = c.turnstileSiteKey ?? "";
    renderBooking();
    mountTurnstile($("turnstile"), turnstileSiteKey);
  })
  .catch(() => {});
