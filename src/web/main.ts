import type { AnalysisContext, AnalysisEvent } from "../shared/report";
import { streamAnalysis } from "./api";
import { h } from "./dom";
import { tabsFor } from "./render";
import {
  addAnalysis,
  completeAnalysis,
  createSession,
  failAnalysis,
  getAnalysis,
  recordSection,
  setResume,
  type Analysis,
  type Session,
} from "./session";

// All Session state lives in this variable and nowhere else (ADR-0001).
let session: Session = createSession();

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

function render(id: string) {
  const analysis = getAnalysis(session, id);
  if (!analysis) return;
  reportEl.hidden = false;
  renderTabs(analysis);
  statusEl.textContent =
    analysis.status !== "running"
      ? ""
      : !analysis.report.extract
        ? "Reading your Resume and the Job Description…"
        : !analysis.report.assess
          ? "Assessing your fit…"
          : "Building your plan…";
  $("report-error").hidden = analysis.status !== "failed";
  $("report-error-text").textContent = analysis.error ?? "";
  analyseButton.disabled = analysis.status === "running";
}

let activeTab = "fit";

function renderTabs(analysis: Analysis) {
  const tabs = tabsFor(analysis);
  const tablist = $("tabs");
  const panel = $("tab-panel");
  tablist.hidden = panel.hidden = tabs.length === 0;
  if (!tabs.some((t) => t.id === activeTab)) activeTab = tabs[0]?.id ?? "fit";
  tablist.replaceChildren(
    ...tabs.map((t) => {
      const selected = t.id === activeTab;
      const button = h("button", { type: "button", role: "tab", id: `tab-${t.id}`, "aria-selected": String(selected), tabindex: selected ? "0" : "-1" }, t.label);
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
  render(id);
  let finished = false;
  await streamAnalysis({ resume: session.resume!, jobDescription, context }, (e: AnalysisEvent) => {
    if (e.type === "section") session = recordSection(session, id, e.section, e.data);
    else if (e.type === "done") (session = completeAnalysis(session, id)), (finished = true);
    else if (e.type === "error") (session = failAnalysis(session, id, e.message)), (finished = true);
    render(id);
  });
  if (!finished) {
    session = failAnalysis(session, id, "The connection dropped before your Report finished. Please try again.");
    render(id);
  }
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
