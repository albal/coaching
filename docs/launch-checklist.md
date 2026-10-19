# Launch checklist

Work through this before the first public launch, and repeat the marked items whenever the change says so. The automated privacy suite (`npm test` and `npm run test:e2e`) must be green in CI first.

## Gemini (ADR-0002)

- [ ] `GEMINI_API_KEY` comes from a Google Cloud project with an **active, prepaid billing account**. Free-trial or promotional credits alone are not enough.
- [ ] AI Studio shows that key's project on the **Paid tier**. *Repeat after every key rotation.*
- [ ] Project logging in AI Studio is **off** for this project, or you have accepted and disclosed its retention.
- [ ] No Gemini Files API, explicit caching, Search/Maps grounding or Interactions API storage is in use (the code uses none; re-check after any change to `src/worker/gemini.ts`).

## Prepaid credit

- [ ] Decide whether Auto-reload stays **off** (the app locks when the balance hits £0.00) or on (Google tops up from your card).
- [ ] Set `DAILY_ANALYSIS_CAP` so one day can't spend the whole balance. A full Analysis plus a short Coaching Chat costs about $0.03 at current Flash-Lite prices, so £4 covers roughly 150 Analyses. Measure the real cost from AI Studio usage after the first few runs.
- [ ] Know how to unlock after topping up. The lock clears itself 15 minutes after the last out-of-credit error, or at once with:
      `curl -X POST https://<your-domain>/api/admin/unlock -H "authorization: Bearer $METRICS_TOKEN"`
- [ ] `out_of_credit` appears in `GET /api/metrics`, so you can see when (and how often) the balance ran out.

## No proxy in the call path

- [ ] The Worker calls `generativelanguage.googleapis.com` directly. There's no Cloudflare AI Gateway or other proxy in between (also checked by `test/worker/privacy.test.ts`).
- [ ] No AI Gateway is attached to this Worker in the Cloudflare dashboard.

## Cloudflare

- [ ] Worker secrets are set with `wrangler secret put`: `GEMINI_API_KEY`, `TURNSTILE_SECRET_KEY` and `PASS_SECRET` (a long random string). `METRICS_TOKEN` is optional.
- [ ] `TURNSTILE_SITE_KEY` in `wrangler.jsonc` matches a Turnstile widget configured for the production hostname.
- [ ] `BOOKING_URL` in `wrangler.jsonc` points to the live Cal.com or Calendly page.
- [ ] `ANALYSES_PER_IP_PER_HOUR` and `DAILY_ANALYSIS_CAP` are set from the measured cost per Analysis and the monthly budget.
- [ ] A billing alert is set on the Google Cloud project for the monthly AI budget.
- [ ] GitHub repo secrets `CLOUDFLARE_API_TOKEN` (Workers deploy permission) and `CLOUDFLARE_ACCOUNT_ID` are set, so CI deploys on push to `main`.
- [ ] Workers Logs, viewed in the dashboard after a real Analysis, contain only event names, timings, token counts and error codes.

## Privacy notice

- [ ] `/privacy` names the operator and a real contact email (replace the placeholder).
- [ ] It still states that Google processes the text, doesn't train on it, keeps it for up to **55 days** for abuse monitoring, and may process it outside the UK/EU. Re-check against Google's current [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [usage policies](https://ai.google.dev/gemini-api/docs/usage-policies).
- [ ] The landing page and consent box wording match the notice.

## Manual checks in a real browser

- [ ] Run a full Analysis with a real Resume and Job Description, and confirm all five tabs are sensible.
- [ ] **Save as PDF** produces a clean, readable PDF (check page breaks and dark mode off).
- [ ] The downloaded Markdown opens correctly in a Markdown viewer.
- [ ] Closing the tab with an undownloaded Report shows the leave-page warning.
- [ ] On a phone: upload, Analysis, tabs, Coaching Chat and download all work at narrow width.
