# Contributing

Thanks for wanting to help. DevOps Career Coach is a one-person project, so I can't promise to accept every change, but bug reports, fixes and ideas are all welcome.

## Before you start

- **Security bugs:** don't open a public issue. Follow [`SECURITY.md`](SECURITY.md).
- **Bugs and ideas:** open a [GitHub issue](https://github.com/albal/coaching/issues). New issues get the `needs-triage` label until I've looked at them.
- **Code changes:** for anything bigger than a small fix, open an issue first so we can agree on the approach before you spend time on it.
- **Never use real personal data.** Don't paste a real person's Resume into an issue, a test fixture or a screenshot. Use made-up content.

## The one rule that matters most

The site stores nothing ([ADR-0001](docs/adr/0001-browser-is-the-only-store.md)). User content (Resumes, Job Descriptions, Reports and Coaching Chat) lives only in the browser tab's memory. A change won't be merged if it:

- writes user content to `localStorage`, `sessionStorage`, IndexedDB or cookies
- adds a KV, R2, D1 or Durable Object binding that could hold user content
- logs request or response bodies, prompts or model output (see `src/worker/log.ts`)
- sends user content anywhere other than the Gemini API, or puts a proxy such as AI Gateway in front of it
- uses a Gemini feature that stores content: the Files API, explicit caches, Search/Maps grounding or the Interactions API ([ADR-0002](docs/adr/0002-gemini-paid-tier-only.md))

If your change needs to break one of these, open an issue to discuss it first.

## Getting set up

You need Node.js 24. See the [README](README.md#getting-started) for the full list of commands.

```sh
npm install
npm run dev:demo   # canned Gemini replies: no API key or network needed
```

Demo mode is enough for almost all work. You don't need a Gemini key, Turnstile keys or a Cloudflare account to contribute.

## Making a change

1. Read [`ARCHITECTURE.md`](ARCHITECTURE.md) to see how the code fits together.
2. Use the vocabulary in [`GLOSSARY.md`](GLOSSARY.md): Resume, Job Description, Session, Analysis, Report, Fit Band, Gap, Must-have, Coaching Chat. Use these words in code, tests, UI text and docs.
3. Match the surrounding code: its naming, comment style and idioms.
4. If you're making a decision that's hard to reverse, add an ADR in [`docs/adr/`](docs/adr/).

## Tests

Before you open a pull request, run:

```sh
npm run typecheck
npm test
npm run test:e2e   # Playwright privacy suite; run `npx playwright install chromium` the first time
```

When you write tests:

- Test through the public seams: the Worker's `fetch` handler (`test/worker/`), the browser Session model and export (`test/web/`), or the Playwright suite (`e2e/`). Check behaviour, not internal structure.
- Gemini is always faked (`test/support/fake-gemini.ts`). No test may call the real API.
- A bug fix should come with a test that fails without the fix.

## Prompt changes

The prompts in `src/worker/prompts.ts` shape every Report. If you change them, say in the pull request why the change is needed and show a before and after from a real run on made-up data. The Fit Band definitions must stay word for word the same as in `GLOSSARY.md`.

## Pull requests

- Keep each pull request to one change, and link the issue it closes.
- Explain what changed and why. For UI changes, include a screenshot.
- CI must be green: typecheck, unit tests, build and the Playwright privacy suite.
- Merges to `main` deploy straight to the live site, so `main` must always be releasable.

## Licence

By contributing, you agree that your work is released under the project's [MIT licence](LICENSE).

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
