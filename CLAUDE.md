# CLAUDE.md

DevOps Career Coach: see `PRD.md` for the product requirements, `GLOSSARY.md` for vocabulary, and `docs/adr/` for key decisions.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for albal/coaching via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Development

- `npm test` runs the Worker HTTP-seam tests (fake Gemini client) and the browser Session model tests.
- `npm run typecheck`, `npm run build` (Vite → `dist/`), `npm run dev` (build + `wrangler dev`), `npm run dev:demo` (canned Gemini replies, no key or network needed).
- Secrets: `GEMINI_API_KEY` (Worker secret; `.dev.vars` locally). CI deploys on push to `main` when `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets exist.
