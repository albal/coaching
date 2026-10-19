import { DEVOPS_AREAS, FIT_BAND_LABELS, gapsOf, type Requirement, type Sections } from "../shared/report";
import { h, list } from "./dom";
import type { Analysis } from "./session";

export interface Tab {
  id: string;
  label: string;
  render: () => HTMLElement;
}

const EVIDENCE_LABELS = { strong: "Strong", partial: "Partial", missing: "Missing" } as const;
const SENIORITY_LABELS = { below: "Below the level", meets: "Meets the level", above: "Above the level" } as const;

function requirementItem(r: Requirement): HTMLElement {
  return h(
    "li",
    { class: `req req-${r.evidence}` },
    h(
      "p",
      { class: "req-head" },
      h("span", { class: `badge badge-${r.evidence}` }, EVIDENCE_LABELS[r.evidence]),
      " ",
      h("span", { class: "badge" }, r.mustHave ? "Must-have" : "Nice-to-have"),
      " ",
      h("strong", null, r.text),
    ),
    r.quote ? h("blockquote", null, r.quote) : null,
    r.transfer ? h("p", { class: "muted" }, `Transfers: ${r.transfer}`) : null,
  );
}

function fitTab(assess: Sections["assess"]): HTMLElement {
  return h(
    "div",
    null,
    h(
      "div",
      { class: "fit" },
      h("p", { class: "fit-label" }, "Fit Band"),
      h("p", { class: "fit-band", "data-band": assess.fitBand }, FIT_BAND_LABELS[assess.fitBand]),
      h("p", null, assess.reason),
    ),
    h("h3", null, "Seniority"),
    h("p", null, h("strong", null, `${SENIORITY_LABELS[assess.seniority.verdict]} (${assess.seniority.target}). `), assess.seniority.notes),
    h("h3", null, "Hidden strengths"),
    list(assess.hiddenStrengths, "None spotted."),
    h("h3", null, "Red flags a recruiter might notice"),
    list(assess.redFlags, "None spotted."),
  );
}

function gapsTab(assess: Sections["assess"]): HTMLElement {
  const gaps = gapsOf(assess.requirements);
  const byArea = DEVOPS_AREAS.map((area) => ({ area, reqs: assess.requirements.filter((r) => r.area === area) })).filter(
    (g) => g.reqs.length,
  );
  return h(
    "div",
    null,
    h("h3", null, `Your Gaps (${gaps.length})`),
    gaps.length
      ? h("ul", { class: "reqs" }, gaps.sort((a, b) => Number(b.mustHave) - Number(a.mustHave)).map(requirementItem))
      : h("p", null, "No Gaps: every requirement has strong evidence."),
    h("h3", null, "All requirements by area"),
    byArea.map((g) => h("section", { class: "area" }, h("h4", null, g.area), h("ul", { class: "reqs" }, g.reqs.map(requirementItem)))),
  );
}

export function tabsFor(analysis: Analysis): Tab[] {
  const tabs: Tab[] = [];
  const { assess } = analysis.report;
  if (assess) {
    tabs.push({ id: "fit", label: "Fit", render: () => fitTab(assess) });
    tabs.push({ id: "gaps", label: "Gaps", render: () => gapsTab(assess) });
  }
  return tabs;
}
