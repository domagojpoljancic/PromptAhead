# PromptAhead

> **WIP — development on `main`.** Manual core path works end-to-end. Panel polish, onboarding, Chrome smoke, and Web Store packaging still TBD.

**Your next question, already prepared.**

Privacy-first Chrome extension (Manifest V3) that notices when you are genuinely interested in a page and helps you decide what to explore next. It builds an editable prompt for ChatGPT, Claude, Gemini, Perplexity, or any LLM you choose. No PromptAhead backend, accounts, or remote model calls in MVP — optional on-device Gemini Nano when available, curated fallback otherwise.

## Status

| Area | State |
| --- | --- |
| Product extension (`extension/`) | **Manual core works** — gesture extract → Choose → Refine → Review → Copy / Open-in |
| Destinations | Deep links with **app-first + web fallback**; Gemini and oversized prompts use **clipboard + open**; never auto-submit |
| M0 spike harness (`spikes/`) | **Done** — S0.1–S0.7 implemented and run |
| Spike results (`docs/technical-spikes.md`) | **Filled** — Chrome **150.0.0.0** (2026-08-01) |
| Tooling | `build`, `typecheck`, `lint`, `test`, `spikes:build` at repo root |
| Extraction | JSON-LD / Open Graph / semantic-HTML classification with size caps; 6 HTML fixtures; Readability deferred |
| Suggestions + prompts | Curated + mock-Nano engines; injection-resistant `<SOURCE_DATA>` builder |
| Product docs | Draft handoff + architecture / plan / privacy / test plan |
| Planning | Linear used as the product / issue tracker |

### Locked from M0

- Manual: extract on toolbar / context-menu / shortcut; panel may re-fetch same tab until navigation; **`activeTab` only**
- Nano (M2): host in **side panel**
- Smart invites (M3): **badge-first**; system notifications optional

## Quick start (product extension)

Requires Node.js 20+ and Chrome with Developer mode.

```bash
npm install
npm run build
```

Load **`extension/dist/`** unpacked on `chrome://extensions`. Open any normal `http(s)` page and click the toolbar icon (or context menu / `Alt+Shift+P`): PromptAhead extracts that page, opens the side panel, and offers curated directions.

Build a prompt, edit it, then:

- **Copy** — clipboard only
- **Open in ChatGPT / Claude / Perplexity** — deep link (native app scheme when available, then web URL with `q=` prefill)
- **Open in Gemini** (and any oversized prompt) — copy to clipboard, then open the chat UI for paste

Nothing is auto-submitted. **Refresh from page** re-reads the same tab until it navigates — after that Chrome revokes `activeTab` and you invoke the extension again.

### Developer scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Build product extension → `extension/dist/` |
| `npm run typecheck` | TypeScript check (product + spikes) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit tests |
| `npm run spikes:build` | Build M0 spike harness → `spikes/dist/` |
| `npm run spikes:dev` | Watch rebuild for spikes |

## Quick start (spike harness)

```bash
npm run spikes:build
```

Load **`spikes/dist/`** unpacked. Details: [`spikes/README.md`](spikes/README.md).

## Repository layout

```text
PromptAhead/
├── docs/          # Product + engineering docs
├── extension/     # Product MV3 extension (M1+)
├── spikes/        # Throwaway M0 Chrome API validation harness
├── tests/         # Unit tests + fixtures
├── package.json   # Root scripts and devDependencies
└── README.md
```

See [`docs/architecture.md`](docs/architecture.md) for the full folder layout.

## Docs

| Doc | Purpose |
| --- | --- |
| [`docs/promptahead-product-handoff.md`](docs/promptahead-product-handoff.md) | Product source of truth |
| [`docs/architecture.md`](docs/architecture.md) | Stack + folder layout |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Milestones M0–M4 |
| [`docs/technical-spikes.md`](docs/technical-spikes.md) | M0 spike report (Chrome results) |
| [`docs/privacy-threat-model.md`](docs/privacy-threat-model.md) | Privacy / threat model |
| [`docs/test-plan.md`](docs/test-plan.md) | Test plan |

## What is intentionally missing

- Side-panel state-machine polish and empty/error states
- Onboarding / settings / clear-data UX
- Manual smoke report + acceptance checklist; unpacked Chrome smoke still pending
- Main-content extraction beyond the thin `main`/`article` heuristic; Mozilla Readability license call still open
- Sensitive-page heuristics (banking/medical pages are not blocked yet)
- Published Chrome Web Store build
- Smart mode / host-permission product UI
- Automated CI

## Contributing / development notes

Solo WIP. Work lands on **`main`** during this development phase. Prefer small, verifiable milestones over expanding MVP scope.
