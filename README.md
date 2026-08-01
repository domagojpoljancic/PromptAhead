# PromptAhead

> **WIP — public draft.** Not installable as a product yet. Milestone 0 (technical validation) is in progress.

**Your next question, already prepared.**

Privacy-first Chrome extension (Manifest V3) that notices when you are genuinely interested in a page and helps you decide what to explore next. It builds an editable prompt for ChatGPT, Claude, Gemini, Perplexity, or any LLM you choose. No PromptAhead backend, accounts, or remote model calls in MVP — optional on-device Gemini Nano when available, curated fallback otherwise.

## Status

| Area | State |
| --- | --- |
| Product extension (`extension/`) | Not started |
| M0 spike harness (`spikes/`) | **WIP** — all seven spikes (S0.1–S0.7) implemented in the harness |
| Spike results (`docs/technical-spikes.md`) | **WIP** — Chrome **150.0.0.0** (2026-08-01): S0.1–S0.3 **pass**; S0.5 retest pending; S0.4 / S0.6 / S0.7 not yet recorded |
| Product docs | Draft handoff + architecture / plan / privacy / test plan |
| Planning | Linear used as the product / issue tracker |

## Quick start (spike harness only)

Requires Node.js 20+ and Chrome with Developer mode.

```bash
npm install
npm run spikes:build
```

Then load **`spikes/dist/`** as an unpacked extension on `chrome://extensions`.

Iterative rebuilds: `npm run spikes:dev` (reload the extension after each build).

Details, ordered run session, and permissions: [`spikes/README.md`](spikes/README.md).

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
| [`docs/technical-spikes.md`](docs/technical-spikes.md) | M0 spike report (Chrome results) |
| [`docs/privacy-threat-model.md`](docs/privacy-threat-model.md) | Privacy / threat model |
| [`docs/test-plan.md`](docs/test-plan.md) | Test plan |

## What is intentionally missing

- No published Chrome Web Store build
- No Smart mode / host-permission product UI
- No automated CI yet
- Spike outcomes depend on your Chrome version and hardware (Nano)

## Contributing / development notes

This repo is a solo WIP draft. Expect incomplete Chrome validation tables and docs that may lead the code. Prefer small, verifiable milestones over expanding MVP scope.
