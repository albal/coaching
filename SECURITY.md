# Security Policy

DevOps Career Coach handles people's Resumes, so privacy is the core feature. The site stores nothing: all user content lives only in the browser tab ([ADR-0001](docs/adr/0001-browser-is-the-only-store.md)). A bug that breaks that promise is a security bug.

## Supported versions

Only the live site at <https://coach.tsew.com/>, built from the latest commit on `main`, is supported. There are no releases or older versions to patch.

## Reporting a vulnerability

**Please don't open a public issue.**

Report it privately through GitHub: go to the [Security tab](https://github.com/albal/coaching/security) and choose **Report a vulnerability**.

Include:
- what you found and where (URL, endpoint or file)
- steps to reproduce, or a proof of concept
- what an attacker could do with it

Never include a real person's Resume or other personal data in a report. Use made-up content.

## What happens next

- I'll acknowledge your report within **3 working days**.
- I'll confirm whether it's a vulnerability and share a plan within **10 working days**.
- Fixes deploy straight to the live site once merged to `main`.
- I'll credit you in the advisory when it's published, unless you'd rather stay anonymous.

This is a one-person project with no bug bounty, so there is no payment for reports. Thank you for helping keep candidates' data safe.

## In scope

- Anything that lets user content (Resume, Job Descriptions, Reports, Coaching Chat) be stored, logged, cached or sent anywhere other than the browser tab and the Gemini request
- Cross-site scripting, or injection through uploaded files or model output
- Bypassing Turnstile, the per-IP rate limits or the out-of-credit lock
- Ways to drain or abuse the prepaid Gemini key
- Unauthenticated access to `/api/metrics` or `/api/admin/*`
- Leaked secrets in the repository or the deployed bundle
- Weaknesses in the CI workflow that could let someone change what gets deployed

## Out of scope

- Prompt injection that only changes the output in your own session
- The model giving poor or inaccurate coaching
- Volumetric denial of service, or load testing against the live site
- Missing headers or best-practice findings with no clear exploit
- Vulnerabilities in Cloudflare, Google Gemini or Turnstile themselves; report those to the vendor
- Social engineering, or attacks that need a compromised device or browser

## Safe harbour

If you act in good faith, follow this policy and stay within scope, I won't take legal action against you. Please:
- test only with your own made-up data
- keep request volumes low, so you don't run up the Gemini bill or degrade the site for others
- give me a reasonable time to fix the issue before you disclose it publicly
