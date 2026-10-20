# Architecture

DevOps Career Coach is a single Cloudflare Worker. It serves a static single-page web app and a small JSON/NDJSON API in front of Google Gemini. Vocabulary follows [`GLOSSARY.md`](GLOSSARY.md).

The main constraint behind the design is that **the server keeps no user content** ([ADR-0001](docs/adr/0001-browser-is-the-only-store.md)). The browser holds the whole Session and sends whatever context each request needs. The Worker calls Gemini, streams the answer back and forgets it.

```
Browser (src/web)                                Cloudflare Worker (src/worker)
┌───────────────────────────────┐   HTTPS       ┌──────────────────────────────────┐
│ File → text (pdf.js, mammoth) │  pass header  │ index.ts   wiring, fail closed   │
│ Session in JS memory only     │ ────────────► │ app.ts     routes, validation    │
│ Report tabs, Coaching Chat    │  NDJSON       │ protection Turnstile, passes,    │
│ Markdown export, print to PDF │ ◄──────────── │            burst limits          │
└───────────────────────────────┘               │ pipeline   Analysis steps        │
                                                │ gemini     REST client ──────────┼──► Gemini API
                                                │ usage-guard Durable Object:      │    (paid tier)
                                                │   content-free counters only     │
                                                └──────────────────────────────────┘
```

## Layout

| Path | Contents |
|---|---|
| `src/shared/` | Types and zod schemas used on both sides: Report sections (`report.ts`) and the Coaching Chat contract (`chat.ts`) |
| `src/web/` | The browser app, built by Vite into `dist/` |
| `src/worker/` | The Worker and its Durable Object |
| `public/_headers` | Security headers for static assets: `no-store`, HSTS, strict CSP |
| `test/worker/` | HTTP-seam tests that run the Worker against a fake Gemini client |
| `test/web/` | Session model, file extraction and export tests |
| `e2e/` | Playwright privacy acceptance suite (`privacy.spec.ts`, `credit.spec.ts`) |

## Browser

- **`main.ts`** handles the UI: forms, Report tabs, Coaching Chat, downloads, the `beforeunload` warning and End Session.
- **`session.ts`** is a pure Session model: one Resume, up to 3 Analyses, and a Coaching Chat for each Analysis capped at `MAX_CHAT_TURNS`. It lives only in memory. `localStorage`, `sessionStorage`, IndexedDB and cookies are deliberately not used, so a refresh loses the Session.
- **`extract.ts`** turns PDF (pdf.js), DOCX (mammoth), TXT and MD into text in the browser, with a 5 MB file limit. Scanned PDFs with no text are detected and the user is asked to paste instead.
- **`api.ts`** calls the Worker and reads its NDJSON streams.
- **`render.ts`** and **`export.ts`** build the Report tabs, the print view and the Markdown download.
- **`turnstile.ts`** mounts the Turnstile widget and waits for a token.

## Worker

### Request flow

`index.ts` sends everything outside `/api/*` to static assets. For API requests it builds the dependencies: the Gemini client (or the canned `demo.ts` client when `DEMO_GEMINI=1`), the protection services and the usage client. If `PASS_SECRET` or `TURNSTILE_SECRET_KEY` is missing outside demo mode, it returns 503 (fail closed).

`app.ts` routes the API:

| Route | Purpose |
|---|---|
| `GET /api/config` | Booking URL, Turnstile site key, and whether the app is available (not credit-locked) |
| `POST /api/verify` | Exchanges a Turnstile token for a signed pass |
| `POST /api/analyse` | Runs an Analysis and streams the Report sections as NDJSON |
| `POST /api/chat` | One Coaching Chat turn, streamed as NDJSON text deltas |
| `POST /api/event` | Counts a page event (`download`, `booking_click`) |
| `GET /api/metrics` | Content-free daily counts (Bearer `METRICS_TOKEN`) |
| `POST /api/admin/unlock` | Clears the out-of-credit lock (Bearer `METRICS_TOKEN`) |

`app.ts` takes its dependencies as a `Deps` object, which is the seam the tests use: `test/worker/` drives `handleApi` with a fake Gemini client and in-memory protection.

### Abuse and cost controls

Each model-calling request goes through `guard()` in this order:

1. **Credit lock.** If the app is locked, refuse at once without calling Gemini or using up any limits.
2. **Pass.** The `x-coach-pass` header must carry a pass issued by `/api/verify` after Turnstile. It's an HMAC-signed expiry time valid for 4 hours, so the server keeps no session state.
3. **Burst limit.** The Workers rate-limiting bindings `ANALYSE_BURST` (3/min) and `CHAT_BURST` (12/min) are keyed by IP.

`/api/analyse` then reserves a slot in the `UsageGuard` Durable Object, which enforces `ANALYSES_PER_IP_PER_HOUR` per hashed IP and the global `DAILY_ANALYSIS_CAP`. Once the daily cap is reached, users see "We're busy today — book a session with Al instead". Input sizes are capped by `LIMITS` in `src/shared/report.ts`. The Coaching Chat is capped by `MAX_CHAT_TURNS` in `src/shared/chat.ts`, checked by both the browser and the Worker.

### Analysis pipeline

`pipeline.ts` runs each Analysis as a series of structured Gemini calls. Each call is validated against its zod schema (converted to JSON Schema for Gemini's structured output) and retried once if it's invalid:

1. **Extract**: skills, roles and achievements from the Resume, and requirements tagged Must-have or nice-to-have.
2. **Assess**: maps each requirement to Resume evidence, finds the Gaps and sets the Fit Band. `constrainFitBand` enforces the Fit Band definitions in code rather than trusting the model.
3. **Plan**, **Rewrites** and **Interview** run in parallel. Each section streams to the browser as soon as it's ready. A Rewrite is rejected unless its original line really appears in the Resume.

Prompts are in `prompts.ts`. Resume and Job Description text is wrapped in delimiters and treated as data. The model has no tools.

### Gemini client

`gemini.ts` calls `generativelanguage.googleapis.com` directly, with no AI Gateway or proxy in between ([ADR-0002](docs/adr/0002-gemini-paid-tier-only.md)), and uses none of Gemini's data-storing features. A 402, or a quota error about credit or billing, is flagged as out of credit. `app.ts` then locks the whole app for 15 minutes through `UsageGuard`. Ordinary 429 rate limits don't lock it.

### State that does persist

There's one Durable Object, `UsageGuard` (`usage-guard.ts`), and it never sees user content. It holds:

- per-IP hourly Analysis counts, keyed by an HMAC of the IP made with `PASS_SECRET`
- the global daily Analysis count
- daily metrics for 90 days: `analysis_completed`, `download`, `booking_click`, `out_of_credit`
- the out-of-credit lock timestamp

### Logging and headers

`log.ts` writes only content-free events: event names, steps, error codes, timings and token counts. Every response carries `Cache-Control: no-store` and the security headers in `http.ts` (API) and `public/_headers` (static assets).

## Testing

- `npm test` (Vitest) runs the Worker HTTP-seam tests, including the privacy tests that check logs for a marker string and check that Gemini is the only host called. It also runs the browser Session, extraction and export tests.
- `npm run test:e2e` (Playwright) runs the privacy acceptance suite against `wrangler dev --env e2e`, with demo Gemini and high limits. It checks that raw files never appear in request bodies, that nothing is left in browser storage, and how the out-of-credit lock behaves.

## Deployment

`.github/workflows/ci.yml` runs the typecheck, unit tests, build and e2e suite. On pushes to `main` it then runs `wrangler deploy`, if the Cloudflare secrets are set. The static app is served with Workers Static Assets from `dist/`. `run_worker_first` sends only `/api/*` to the Worker code.
