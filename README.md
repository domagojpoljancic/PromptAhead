# PromptAhead

> **WIP — first public draft.** Not installable as a product yet. Milestone 0 (technical validation) is in progress; Chrome spike results are still TBD.

**Your next question, already prepared.**

Privacy-first Chrome extension (Manifest V3) that notices when you are genuinely interested in a page and helps you decide what to explore next. It builds an editable prompt for ChatGPT, Claude, Gemini, Perplexity, or any LLM you choose. No PromptAhead backend, accounts, or remote model calls in MVP — optional on-device Gemini Nano when available, curated fallback otherwise.

## Status

| Area | State |
| --- | --- |
| Product extension (`extension/`) | Not started |
| M0 spike harness (`spikes/`) | **WIP** — scaffolded; S0.1–S0.3 + S0.5 implemented; S0.4 / S0.6 / S0.7 still stubs |
| Spike results (`docs/technical-spikes.md`) | **WIP** — tables ready; Chrome runs not recorded |
| Product docs | Draft handoff + architecture / plan / privacy / test plan |
| Milestone | [M0 · Technical Validation](https://linear.app/domagojp) · tracking [DOM-6](https://linear.app/domagojp/issue/DOM-6/run-chrome-api-validation-spikes-s01-s07) |

## Quick start (spike harness only)

Requires Node.js 20+ and Chrome with Developer mode.

```bash
npm install
npm run spikes:build
```

Then load **`spikes/dist/`** as an unpacked extension on `chrome://extensions`.

Iterative rebuilds: `npm run spikes:dev` (reload the extension after each build).

Details, gesture notes for S0.5, and permissions: [`spikes/README.md`](spikes/README.md).

## Repository layout

```text
PromptAhead/
├── docs/          # Product + engineering docs (source of truth for MVP)
├── spikes/        # Throwaway M0 Chrome API validation harness (not the product)
├── package.json   # Root scripts for the spikes build
└── README.md
```

The product app will live under `extension/` later (see [`docs/architecture.md`](docs/architecture.md)).

## Docs

| Doc | Purpose |
| --- | --- |
| [`docs/promptahead-product-handoff.md`](docs/promptahead-product-handoff.md) | Product source of truth |
| [`docs/architecture.md`](docs/architecture.md) | Proposed stack + folder layout |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Milestones M0–M4 |
| [`docs/technical-spikes.md`](docs/technical-spikes.md) | M0 spike report (fill after Chrome runs) |
| [`docs/privacy-threat-model.md`](docs/privacy-threat-model.md) | Privacy / threat model |
| [`docs/test-plan.md`](docs/test-plan.md) | Test plan |

## What is intentionally missing

- No published Chrome Web Store build
- No Smart mode / host-permission product UI
- No automated CI yet
- Spike outcomes depend on your Chrome version and hardware (Nano)

## Contributing / development notes

This repo is a solo WIP first draft. Expect incomplete spikes, placeholder TBD tables, and docs that may lead the code. Prefer small, verifiable milestones over expanding MVP scope.
