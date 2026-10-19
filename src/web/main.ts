import { FIT_BAND_LABELS, type AnalysisEvent, type Sections } from "../shared/report";
import { streamAnalysis } from "./api";
import {
  addAnalysis,
  completeAnalysis,
  createSession,
  failAnalysis,
  getAnalysis,
  recordSection,
  setResume,
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
  const assess = analysis.report.assess as Sections["assess"] | undefined;
  $("fit").hidden = !assess;
  if (assess) {
    const band = $("fit-band");
    band.textContent = FIT_BAND_LABELS[assess.fitBand];
    band.dataset.band = assess.fitBand;
    $("fit-reason").textContent = assess.reason;
  }
  statusEl.textContent =
    analysis.status === "running" ? (analysis.report.extract ? "Assessing your fit…" : "Reading your Resume and the Job Description…") : "";
  $("report-error").hidden = analysis.status !== "failed";
  $("report-error-text").textContent = analysis.error ?? "";
  analyseButton.disabled = analysis.status === "running";
}

async function run(jobDescription: string) {
  const id = crypto.randomUUID();
  const added = addAnalysis(session, id, jobDescription);
  if (!added.ok) {
    showFormError(added.reason === "limit" ? "You've reached the limit of Analyses for this Session." : "Please add a Job Description.");
    return;
  }
  session = added.session;
  render(id);
  let finished = false;
  await streamAnalysis({ resume: session.resume!, jobDescription }, (e: AnalysisEvent) => {
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
