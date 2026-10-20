# DevOps Career Coach

A free web app that coaches DevOps, SRE and Platform engineers toward a specific role. You give it your Resume and a Job Description. For each pair it runs an Analysis that produces a Report:

- a **Fit Band**: Strong fit, Stretch or Long shot (never a number)
- the **Gaps** between your Resume and the role, sorted into Must-haves and nice-to-haves
- a plan to close those Gaps
- honest resume rewrites that never invent experience
- interview prep built on stories from your own Resume

Each Analysis comes with a Coaching Chat for up to 5 follow-up questions.

**Privacy is the core feature.** The site stores nothing. Your Resume, Job Descriptions, Reports and chat exist only in the browser tab, and closing the tab deletes them. Files are turned into text in the browser, so raw files never leave your device. Download each Report as Markdown or print it to PDF before you leave. See [ADR-0001](docs/adr/0001-browser-is-the-only-store.md).

Text is processed by Google Gemini on the paid tier only, where Google doesn't train on prompts ([ADR-0002](docs/adr/0002-gemini-paid-tier-only.md)).

## Documentation

- [`PRD.md`](PRD.md): product requirements
- [`ARCHITECTURE.md`](ARCHITECTURE.md): how the code fits together
- [`GLOSSARY.md`](GLOSSARY.md): vocabulary (Resume, Analysis, Report, Fit Band, Gap…)
- [`docs/adr/`](docs/adr/): key decisions
- [`docs/launch-checklist.md`](docs/launch-checklist.md): work through it before launch and after key rotation

## Getting started

You need Node.js 24.

```sh
npm install
npm run dev:demo   # canned Gemini replies: no API key or network needed
```

To run against real Gemini, copy `.dev.vars.example` to `.dev.vars` and fill it in, then run `npm run dev`.

| Command | What it does |
|---|---|
| `npm run dev` | Build the web app and start `wrangler dev` |
| `npm run dev:demo` | Same, with canned Gemini replies |
| `npm test` | Worker HTTP tests (fake Gemini client) and browser Session tests |
| `npm run test:e2e` | Playwright privacy suite against `wrangler dev --env e2e` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Vite build into `dist/` |
| `npm run deploy` | Build and `wrangler deploy` |

## Configuration

Worker secrets (set with `wrangler secret put`, or in `.dev.vars` locally):

| Secret | Purpose |
|---|---|
| `GEMINI_API_KEY` | Key from a prepaid, billing-enabled Google Cloud project. Never a free-tier key. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile secret |
| `PASS_SECRET` | Signs Turnstile passes and keys the hashed-IP counters |
| `METRICS_TOKEN` | Optional. Enables `GET /api/metrics` and `POST /api/admin/unlock` |

Without `TURNSTILE_SECRET_KEY` and `PASS_SECRET` the API fails closed, except in demo mode.

The non-secret settings are in `wrangler.jsonc`: `GEMINI_MODEL`, `BOOKING_URL`, `TURNSTILE_SITE_KEY`, `ANALYSES_PER_IP_PER_HOUR` and `DAILY_ANALYSIS_CAP`.

## Deployment

CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests, build and the Playwright privacy suite on every push and pull request. Pushes to `main` deploy to Cloudflare Workers when the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets are set.

## Licence

[MIT](LICENSE) © 2026 Al West
