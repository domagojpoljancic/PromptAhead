# PromptAhead

> **WIP — M1 Manual core + automation.** Product path is buildable and covered by Vitest/Playwright/CI. Remaining: a short real-Chrome release smoke (toolbar gesture, `activeTab` revoke, clipboard, one provider open), then Web Store packaging.

**Your next question, already prepared.**

Privacy-first Chrome extension (Manifest V3) that notices when you are genuinely interested in a page and helps you decide what to explore next. It builds an editable prompt for ChatGPT, Claude, Gemini, Perplexity, or any LLM you choose. No PromptAhead backend, accounts, or remote model calls in MVP — optional on-device Gemini Nano when available, curated fallback otherwise.

## Status

| Area | State |
| --- | --- |
| Product extension (`extension/`) | **Manual core** — gesture extract → Choose → Refine → Review → Prompt ready → Copy / Open-in |
| Side panel | Explicit workflow state machine; one step at a time; context inclusion controls; stale-after-navigate |
| Onboarding + settings | Manual-first first-run overlay; options page for destination, history, clear-data, developer mode |
| Destinations | Deep links with **app-first + web fallback**; Gemini / oversized prompts use **clipboard + open**; never auto-submit |
| Automation | Vitest (unit + jsdom UI), Playwright (built MV3), GitHub Actions (`test:ci`) |
| M0 spike harness (`spikes/`) | **Done** — S0.1–S0.7 implemented and run |
| Spike results (`docs/technical-spikes.md`) | **Filled** — Chrome **150.0.0.0** (2026-08-01) |
| Extraction | JSON-LD / Open Graph / semantic-HTML classification with size caps; 6 HTML fixtures; Readability deferred |
| Suggestions + prompts | Curated + mock-Nano engines; injection-resistant `<SOURCE_DATA>` builder |
| Product docs | Draft handoff + architecture / plan / privacy / test plan |
| Planning | Linear used as the product / issue tracker |

### Locked from M0

- Manual: extract on toolbar / context-menu / shortcut; panel may re-fetch same tab until navigation; **`activeTab` only**
- Nano (M2): host in **side panel**
- Smart invites (M3): **badge-first**; system notifications optional

## Quick start (product extension)

Requires Node.js 20.19+ (same floor as CI / `engines`) and Chrome with Developer mode.

```bash
npm install
npm run build
```

Load **`extension/dist/`** unpacked on `chrome://extensions`. Open any normal `http(s)` page and click the toolbar icon (or context menu / `Alt+Shift+P`): PromptAhead extracts that page, opens the side panel, and offers curated directions.

First run shows a short, skippable onboarding (Manual default; Smart deferred). Build a prompt, edit it, then:

- **Copy** — clipboard only
- **Open in ChatGPT / Claude / Perplexity** — deep link (native app scheme when available, then web URL with `q=` prefill)
- **Open in Gemini** (and any oversized prompt) — copy to clipboard, then open the chat UI for paste

Nothing is auto-submitted. **Refresh from page** re-reads the same tab until it navigates — after that Chrome revokes `activeTab` and you invoke the extension again. Settings and **Clear all PromptAhead data** live on the options page.

### Developer scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Build product extension → `extension/dist/` |
| `npm run typecheck` | TypeScript check (product + spikes) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit / jsdom UI tests |
| `npm run test:e2e` | Build + Playwright MV3 extension tests |
| `npm run test:e2e:headed` | Same as `test:e2e` with a visible browser |
| `npm run test:ci` | typecheck → lint → Vitest → build → Playwright |
| `npm run spikes:build` | Build M0 spike harness → `spikes/dist/` |
| `npm run spikes:dev` | Watch rebuild for spikes |

Playwright needs Chromium once: `npx playwright install chromium` (CI uses `--with-deps`).

## Quick start (spike harness)

```bash
npm run spikes:build
```

Load **`spikes/dist/`** unpacked. Details: [`spikes/README.md`](spikes/README.md).

## Repository layout

```text
PromptAhead/
├── .github/       # CI workflow
├── docs/          # Product + engineering docs
├── extension/     # Product MV3 extension (M1+)
├── spikes/        # Throwaway M0 Chrome API validation harness
├── tests/         # Unit, jsdom UI, and Playwright e2e
├── package.json   # Root scripts and devDependencies
└── README.md
```

See [`docs/architecture.md`](docs/architecture.md) for the full folder layout. Automated vs manual release checks: [`docs/test-plan.md`](docs/test-plan.md).

## Docs

| Doc | Purpose |
| --- | --- |
| [`docs/promptahead-product-handoff.md`](docs/promptahead-product-handoff.md) | Product source of truth |
| [`docs/architecture.md`](docs/architecture.md) | Stack + folder layout |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Milestones M0–M4 |
| [`docs/technical-spikes.md`](docs/technical-spikes.md) | M0 spike report (Chrome results) |
| [`docs/privacy-threat-model.md`](docs/privacy-threat-model.md) | Privacy / threat model |
| [`docs/test-plan.md`](docs/test-plan.md) | Test plan (automated + manual) |

## What is intentionally missing

- Short real-Chrome release smoke (toolbar/context-menu gesture, `activeTab` revoke, real clipboard, one provider open)
- Main-content extraction beyond the thin `main`/`article` heuristic; Mozilla Readability license call still open
- Sensitive-page heuristics (banking/medical pages are not blocked yet)
- Published Chrome Web Store build
- Smart mode / host-permission product UI
- Real Gemini Nano integration (M2)

## Contributing / development notes

Solo WIP. Prefer small, verifiable milestones over expanding MVP scope. Open work via PR into `main`.
