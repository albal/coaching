import type { SectionName, Sections } from "../shared/report";
import type { GeminiClient } from "./gemini";
import { jsonSchemaFor } from "./pipeline";

// Canned replies for local development and the end-to-end privacy tests.
// Enabled only by DEMO_GEMINI=1 (never set in wrangler.jsonc); it makes no
// network calls.

const REPLIES: Sections = {
  extract: {
    candidate: {
      headline: "DevOps Engineer",
      skills: ["AWS", "Kubernetes", "Terraform", "GitLab CI", "Prometheus"],
      roles: [{ title: "DevOps Engineer", organisation: "Acme Ltd", summary: "Runs EKS and CI/CD for 40 services" }],
    },
    job: {
      title: "Senior Platform Engineer",
      seniority: "Senior",
      requirements: [
        { text: "Kubernetes in production", mustHave: true },
        { text: "Terraform", mustHave: true },
        { text: "GitHub Actions", mustHave: true },
        { text: "ArgoCD", mustHave: false },
      ],
    },
  },
  assess: {
    fitBand: "stretch",
    reason: "Strong Kubernetes and Terraform; GitHub Actions is the one Must-have Gap, and your GitLab CI work transfers.",
    requirements: [
      { text: "Kubernetes in production", mustHave: true, area: "Containers & Orchestration", evidence: "strong", quote: "Demo: ran Helm charts on EKS for 40 services.", transfer: "" },
      { text: "Terraform", mustHave: true, area: "IaC", evidence: "strong", quote: "Demo: Terraform for all AWS infrastructure.", transfer: "" },
      { text: "GitHub Actions", mustHave: true, area: "CI/CD", evidence: "partial", quote: "Demo: cut deploy time from 40 to 6 minutes with GitLab CI.", transfer: "GitLab CI pipelines map closely onto GitHub Actions workflows." },
      { text: "ArgoCD", mustHave: false, area: "CI/CD", evidence: "missing", quote: "", transfer: "" },
    ],
    seniority: { target: "Senior", verdict: "meets", notes: "Owning delivery for 40 services is senior-level scope." },
    hiddenStrengths: ["The deploy-time reduction is a strong, measurable CI/CD story."],
    redFlags: ["The skills list names tools without outcomes."],
  },
  plan: {
    gaps: [
      { requirement: "GitHub Actions", mustHave: true, impact: "high", effort: "low", whatToLearn: "Port one of your GitLab pipelines to GitHub Actions, including caching and environments.", timeEstimate: "1 week", resourceType: "Official GitHub Actions docs and a public demo repo", certification: "" },
      { requirement: "ArgoCD", mustHave: false, impact: "medium", effort: "medium", whatToLearn: "GitOps deployments with ArgoCD on a local cluster.", timeEstimate: "2 weeks", resourceType: "ArgoCD getting-started guide and a kind cluster", certification: "" },
    ],
    projects: [{ title: "GitOps platform on EKS", description: "Deploy a 3-tier app with Terraform, GitHub Actions and ArgoCD, with Prometheus dashboards, in a public repo.", provesGaps: ["GitHub Actions", "ArgoCD"] }],
    weeklyPlan: [],
    recommendation: { decision: "apply_now", reason: "Only one Must-have Gap, and it is small; build the Actions demo while you apply." },
  },
  rewrites: {
    bullets: [],
    missingKeywords: [{ keyword: "GitOps", evidence: "Demo: ran Helm charts on EKS for 40 services." }],
    summary: "DevOps engineer running Kubernetes and Terraform at scale, with a track record of faster, safer delivery.",
  },
  interview: {
    questions: (["technical", "scenario", "system_design", "behavioural"] as const).flatMap((type) =>
      [1, 2, 3].map((n) => ({
        type,
        question: `Demo ${type.replace("_", " ")} question ${n}`,
        testing: "How deeply you understand running Kubernetes in production.",
        resumeStories: ["Running Helm charts on EKS for 40 services"],
      })),
    ),
  },
};

export const demoGemini: GeminiClient = {
  async generateJson({ prompt, schema }) {
    const section = (Object.keys(REPLIES) as SectionName[]).find(
      (s) => JSON.stringify(jsonSchemaFor(s)) === JSON.stringify(schema),
    );
    await new Promise((r) => setTimeout(r, 300));
    let reply: unknown = section ? REPLIES[section] : {};
    if (section === "rewrites") {
      // Rewrites must start from a real Resume line, so use the first one given.
      const line = prompt.match(/<resume>\n([\s\S]*?)\n<\/resume>/)?.[1]?.split("\n").find((l) => l.trim()) ?? "";
      const bullet = { original: line, rewritten: `${line} (reworded for impact, for [N] teams)`, placeholders: ["[N]"] };
      reply = { ...REPLIES.rewrites, bullets: line ? [bullet] : [] };
    }
    return { text: JSON.stringify(reply), usage: { tokensIn: 0, tokensOut: 0 } };
  },
  async *streamText() {
    for (const word of "This is a demo Coaching Chat reply. Connect a paid Gemini key to get real coaching.".split(" ")) {
      await new Promise((r) => setTimeout(r, 30));
      yield `${word} `;
    }
  },
};
