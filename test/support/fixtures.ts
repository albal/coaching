import type { Sections } from "../../src/shared/report";

export const RESUME = `Jane Doe — DevOps Engineer
Acme Ltd, 2021–2026: Ran Helm charts on EKS for 40 services. Cut deploy time from 40 to 6 minutes with GitLab CI.
Skills: AWS, Kubernetes, Terraform, Prometheus, Python`;

export const JOB = `Senior Platform Engineer at Example Corp
Must have: Kubernetes in production, Terraform, GitHub Actions.
Nice to have: ArgoCD, Go.`;

export const EXTRACT: Sections["extract"] = {
  candidate: {
    headline: "DevOps Engineer",
    skills: ["AWS", "Kubernetes", "Terraform"],
    roles: [{ title: "DevOps Engineer", organisation: "Acme Ltd", summary: "Ran EKS" }],
  },
  job: {
    title: "Senior Platform Engineer",
    seniority: "Senior",
    requirements: [
      { text: "Kubernetes in production", mustHave: true },
      { text: "ArgoCD", mustHave: false },
    ],
  },
};

export const ASSESS: Sections["assess"] = {
  fitBand: "stretch",
  reason: "Strong Kubernetes, but no GitHub Actions.",
  requirements: [
    { text: "Kubernetes in production", mustHave: true, area: "Containers & Orchestration", evidence: "strong", quote: "Ran Helm charts on EKS for 40 services.", transfer: "" },
    { text: "GitHub Actions", mustHave: true, area: "CI/CD", evidence: "partial", quote: "Cut deploy time from 40 to 6 minutes with GitLab CI.", transfer: "GitLab CI transfers to GitHub Actions" },
    { text: "ArgoCD", mustHave: false, area: "CI/CD", evidence: "missing", quote: "", transfer: "" },
  ],
  seniority: { target: "Senior", verdict: "meets", notes: "Owns delivery for 40 services." },
  hiddenStrengths: ["Deploy-time reduction is a strong CI/CD story"],
  redFlags: ["Skills list has no outcomes"],
};

export const PLAN: Sections["plan"] = {
  gaps: [
    { requirement: "GitHub Actions", mustHave: true, impact: "high", effort: "low", whatToLearn: "Port a GitLab pipeline to Actions", timeEstimate: "1 week", resourceType: "Official docs and a hands-on repo", certification: "" },
    { requirement: "ArgoCD", mustHave: false, impact: "medium", effort: "medium", whatToLearn: "GitOps with ArgoCD", timeEstimate: "2 weeks", resourceType: "Official getting-started guide", certification: "" },
  ],
  projects: [{ title: "GitOps on EKS", description: "Deploy a 3-tier app with Terraform, ArgoCD and Actions", provesGaps: ["GitHub Actions", "ArgoCD"] }],
  weeklyPlan: [{ week: 1, focus: "GitHub Actions", tasks: ["Port the pipeline"] }],
  recommendation: { decision: "apply_now", reason: "Only one small Must-have Gap." },
};

export const REWRITES: Sections["rewrites"] = {
  bullets: [
    {
      original: "Cut deploy time from 40 to 6 minutes with GitLab CI.",
      rewritten: "Rebuilt the GitLab CI pipeline, cutting deploy time from 40 to 6 minutes and saving [N hours] of engineer time each week.",
      placeholders: ["[N hours]"],
    },
  ],
  missingKeywords: [{ keyword: "GitOps", evidence: "Ran Helm charts on EKS for 40 services." }],
  summary: "DevOps engineer who runs Kubernetes at scale and speeds up delivery.",
};

const TYPES = ["technical", "scenario", "system_design", "behavioural"] as const;
export const INTERVIEW: Sections["interview"] = {
  questions: Array.from({ length: 12 }, (_, n) => ({
    type: TYPES[n % 4]!,
    question: `Question ${n + 1}`,
    testing: "Depth with Kubernetes",
    resumeStories: ["Ran Helm charts on EKS for 40 services."],
  })),
};

// A reply for every section; override per test.
export const SCRIPT = { extract: EXTRACT, assess: ASSESS, plan: PLAN, rewrites: REWRITES, interview: INTERVIEW };
