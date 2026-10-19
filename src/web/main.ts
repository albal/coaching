import type { AnalysisContext, AnalysisEvent } from "../shared/report";
import { streamAnalysis } from "./api";
import { h } from "./dom";
import { fileNameFor, reportToMarkdown, reportsOf, sessionToMarkdown, titleOf } from "./export";
import { EXTRACT_MESSAGES, extractText } from "./extract";
import { printView, tabsFor } from "./render";
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
  type Analysis,
  type Session,
} from "./session";

// All Session state lives in this variable and nowhere else (ADR-0001).
let session: Session = createSession();
let currentId: string | null = null;
let activeTab = "fit";
let bookingUrl = "";

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

function render() {
  const analysis = currentId ? getAnalysis(session, currentId) : undefined;
  $("end-session").hidden = session.resume === null;
  reportEl.hidden = !analysis;
  if (!analysis) return;
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
  $("report-actions").hidden = analysis.status !== "complete";
  $("download-all").hidden = reportsOf(session).length < 2;
  analyseButton.disabled = analysis.status === "running";
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

async function run(jobDescription: string) {
  const id = crypto.randomUUID();
  const context = readContext();
  const added = addAnalysis(session, id, jobDescription, context);
  if (!added.ok) {
    showFormError(added.reason === "limit" ? "You've reached the limit of Analyses for this Session." : "Please add a Job Description.");
    return;
  }
  session = added.session;
  currentId = id;
  render();
  let finished = false;
  await streamAnalysis({ resume: session.resume!, jobDescription, context }, (e: AnalysisEvent) => {
    if (!getAnalysis(session, id)) return; // the Session ended mid-stream
    if (e.type === "section") session = recordSection(session, id, e.section, e.data);
    else if (e.type === "done") (session = completeAnalysis(session, id)), (finished = true);
    else if (e.type === "error") (session = failAnalysis(session, id, e.message)), (finished = true);
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

function current(): Analysis | undefined {
  const analysis = currentId ? getAnalysis(session, currentId) : undefined;
  return analysis?.status === "complete" ? analysis : undefined;
}

function downloadCurrent() {
  const analysis = current();
  if (!analysis) return;
  saveFile(fileNameFor(titleOf(analysis)), reportToMarkdown(analysis, { bookingUrl }));
  session = markDownloaded(session, [analysis.id]);
}

function downloadAll() {
  const reports = reportsOf(session);
  if (!reports.length) return;
  saveFile("devops-coach-all-reports.md", sessionToMarkdown(session, { bookingUrl }));
  session = markDownloaded(session, reports.map((a) => a.id));
}

function printCurrent() {
  const analysis = current();
  if (!analysis) return;
  $("print-view").replaceChildren(printView(analysis, bookingUrl));
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

function end() {
  if (hasUndownloadedReports(session) && !confirm("You have Reports you haven't downloaded. End the Session and delete them?")) return;
  session = endSession(session);
  currentId = null;
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
  if (session.resume === null) {
    const set = setResume(session, resume);
    if (!set.ok) return showFormError("Please paste your Resume.");
    session = set.session;
    resumeInput.readOnly = true;
  }
  void run(jobDescription);
});

$("retry").addEventListener("click", () => void run(jdInput.value));
$("download").addEventListener("click", downloadCurrent);
$("download-all").addEventListener("click", downloadAll);
$("print").addEventListener("click", printCurrent);
$("end-session").addEventListener("click", end);
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
  .then((r) => r.json() as Promise<{ bookingUrl?: string }>)
  .then((c) => {
    bookingUrl = c.bookingUrl ?? "";
    renderBooking();
  })
  .catch(() => {});
