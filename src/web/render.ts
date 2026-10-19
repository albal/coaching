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

const LEVEL_LABELS = { low: "Low", medium: "Medium", high: "High" } as const;

function planTab(plan: Sections["plan"]): HTMLElement {
  const rec = plan.recommendation;
  return h(
    "div",
    null,
    h(
      "div",
      { class: `callout callout-${rec.decision}` },
      h("strong", null, rec.decision === "apply_now" ? "Apply now. " : "Prepare first. "),
      rec.reason,
    ),
    h("h3", null, "Close these Gaps, in this order"),
    plan.gaps.length
      ? h(
          "ol",
          { class: "plan-gaps" },
          plan.gaps.map((g) =>
            h(
              "li",
              null,
              h("p", { class: "req-head" }, h("strong", null, g.requirement), " ", h("span", { class: "badge" }, g.mustHave ? "Must-have" : "Nice-to-have")),
              h("p", { class: "muted" }, `Impact on getting hired: ${LEVEL_LABELS[g.impact]} · Effort: ${LEVEL_LABELS[g.effort]} · About ${g.timeEstimate}`),
              h("p", null, g.whatToLearn),
              h("p", null, h("em", null, "Resources: "), g.resourceType),
              g.certification ? h("p", null, h("em", null, "Certification: "), g.certification) : null,
            ),
          ),
        )
      : h("p", null, "No Gaps to close."),
    h("h3", null, "Portfolio projects"),
    plan.projects.length
      ? h(
          "ul",
          null,
          plan.projects.map((p) =>
            h("li", null, h("strong", null, p.title), h("p", null, p.description), p.provesGaps.length ? h("p", { class: "muted" }, `Proves: ${p.provesGaps.join(", ")}`) : null),
          ),
        )
      : h("p", { class: "muted" }, "No projects suggested."),
    plan.weeklyPlan.length
      ? [
          h("h3", null, "Week by week"),
          h(
            "ol",
            { class: "weeks" },
            plan.weeklyPlan.map((w) => h("li", null, h("strong", null, `Week ${w.week}: ${w.focus}`), list(w.tasks, ""))),
          ),
        ]
      : null,
  );
}

function rewritesTab(r: Sections["rewrites"]): HTMLElement {
  return h(
    "div",
    null,
    h("p", { class: "callout" }, h("strong", null, "AI-generated, check before use. "), "Every suggestion rewrites something already in your Resume. Fill in any [placeholders] with your real figures, or remove them."),
    h("h3", null, "Tailored summary"),
    h("p", null, r.summary),
    h("h3", null, "Stronger bullets"),
    r.bullets.length
      ? h(
          "ul",
          { class: "rewrites" },
          r.bullets.map((b) =>
            h(
              "li",
              null,
              h("p", { class: "muted" }, h("span", { class: "label" }, "Before: "), b.original),
              h("p", null, h("span", { class: "label" }, "After: "), b.rewritten),
              b.placeholders.length ? h("p", { class: "muted" }, `Fill in: ${b.placeholders.join(", ")}`) : null,
            ),
          ),
        )
      : h("p", { class: "muted" }, "No rewrites suggested."),
    h("h3", null, "Keywords you can honestly add"),
    r.missingKeywords.length
      ? h("ul", null, r.missingKeywords.map((k) => h("li", null, h("strong", null, k.keyword), h("blockquote", null, k.evidence))))
      : h("p", { class: "muted" }, "None: your Resume already uses the key terms you can claim."),
  );
}

export function tabsFor(analysis: Analysis): Tab[] {
  const tabs: Tab[] = [];
  const { assess, plan, rewrites } = analysis.report;
  if (assess) {
    tabs.push({ id: "fit", label: "Fit", render: () => fitTab(assess) });
    tabs.push({ id: "gaps", label: "Gaps", render: () => gapsTab(assess) });
  }
  if (plan) tabs.push({ id: "plan", label: "Plan", render: () => planTab(plan) });
  if (rewrites) tabs.push({ id: "resume", label: "Resume", render: () => rewritesTab(rewrites) });
  return tabs;
}
