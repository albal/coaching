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
