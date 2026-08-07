# PromptAhead

> **WIP — M3 Smart mode in progress; M2 Nano hardware smoke still open.** Manual core (M1) is buildable and covered by Vitest/Playwright/CI. Nano UX and Smart host-permission education + grant/revoke are on `main`. Chrome Web Store packaging (M4) is still ahead.

**Your next question, already prepared.**

Privacy-first Chrome extension (Manifest V3) that notices when you are genuinely interested in a page and helps you decide what to explore next. It builds an editable prompt for ChatGPT, Claude, Gemini, Perplexity, or any LLM you choose. No PromptAhead backend, accounts, or remote model calls in MVP — optional on-device Gemini Nano when available, curated fallback otherwise. **Page content never leaves the device via PromptAhead**; Nano runs only through Chrome’s on-device Prompt API.

## Status

| Area | State |
| --- | --- |
| Product extension (`extension/`) | **Manual core** + **M2 Nano UX** + **M3 Smart permissions (WIP)** — education copy, grant/revoke helpers, Settings/onboarding hooks |
| Side panel | Workflow state machine; Nano thinking + curated fallback + **Retry local AI**; calm Nano panel notices + Smart permission education (WIP) |
| Onboarding + settings | Manual-first first-run; Nano ready/download/unsupported + onboarding gate; Settings Smart grant/revoke + education (WIP, untested) |
| Destinations | Deep links with **app-first + web fallback**; Gemini / oversized prompts use **clipboard + open**; never auto-submit |
| Automation | Vitest (unit + jsdom UI), Playwright (built MV3 + navigate→stale + Nano-off curated), GitHub Actions (`test:ci`, Node 20.19+) |
| Nano CI | Curated path stays green with Nano forced off (`NANO_FORCE_DISABLED` + Playwright Settings force-basic → extract → copy); live hardware checklist remains DOM-31 / [`docs/nano-verification-checklist.md`](docs/nano-verification-checklist.md) |
| Nano engine | Longer create/prompt budgets; prefer unconstrained prompt then constrain; retain failure reason on curated fallback |
| M1 acceptance | Manual §25 map + smoke notes in [`docs/test-plan.md`](docs/test-plan.md) |
| M0 spike harness (`spikes/`) | **Done** — S0.1–S0.7 implemented and run |
| Spike results (`docs/technical-spikes.md`) | **Filled** — Chrome **150.0.0.0** (2026-08-01) |
| Extraction | JSON-LD / Open Graph / semantic-HTML classification with size caps; 6 HTML fixtures; Readability deferred |
| Suggestions + prompts | Curated + mock-Nano + real `NanoSuggestionEngine` (validate / repair / timeout / curated fallback) |
| Product docs | Handoff + architecture / plan / privacy / test plan / Nano checklist |
| Planning | Linear used as the product / issue tracker |

### Locked from M0

- Manual: extract on toolbar / context-menu / shortcut; panel may re-fetch same tab until navigation; **`activeTab` only**
- Nano (M2): host in **side panel** (and options for readiness / download)
- Smart invites (M3): **badge-first**; system notifications optional

## Quick start (product extension)

Requires Node.js **20.19+** (same floor as CI / `engines`) and Chrome with Developer mode.

```bash
npm install
npm run build
```

Load **`extension/dist/`** unpacked on `chrome://extensions`. Open any normal `http(s)` page and click the toolbar icon (or context menu / `Alt+Shift+P`): PromptAhead extracts that page, opens the side panel, and offers curated (or on-device Nano) directions when enabled.

First run shows a short, skippable onboarding (Manual default; optional Nano download; always **Continue with basic private mode**). Build a prompt, edit it, then:

- **Copy** — clipboard only
- **Open in ChatGPT / Claude / Perplexity** — deep link (native app scheme when available, then web URL with `q=` prefill)
- **Open in Gemini** (and any oversized prompt) — copy to clipboard, then open the chat UI for paste

Nothing is auto-submitted. **Refresh from page** re-reads the same tab until it navigates — after that Chrome revokes `activeTab` and you invoke the extension again (panel shows calm stale / access-lost UX). Settings and **Clear all PromptAhead data** live on the options page.

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

See [`docs/architecture.md`](docs/architecture.md) for the full folder layout. Automated vs manual release checks: [`docs/test-plan.md`](docs/test-plan.md). Nano hardware smoke: [`docs/nano-verification-checklist.md`](docs/nano-verification-checklist.md).

## Docs

| Doc | Purpose |
| --- | --- |
| [`docs/promptahead-product-handoff.md`](docs/promptahead-product-handoff.md) | Product source of truth |
| [`docs/architecture.md`](docs/architecture.md) | Stack + folder layout |
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Milestones M0–M4 |
| [`docs/technical-spikes.md`](docs/technical-spikes.md) | M0 spike report (Chrome results) |
| [`docs/privacy-threat-model.md`](docs/privacy-threat-model.md) | Privacy / threat model (on-device Nano) |
| [`docs/nano-verification-checklist.md`](docs/nano-verification-checklist.md) | Manual Nano smoke checklist |
| [`docs/test-plan.md`](docs/test-plan.md) | Test plan (automated + manual) |

`docs/promptahead-prd.md` is currently an identical copy of the handoff (legacy alias). Prefer the handoff path in links.

## What is intentionally missing

- Chrome Web Store packaging / listing (M4)
- Main-content extraction beyond the thin `main`/`article` heuristic; Mozilla Readability license call still open
- Sensitive-page heuristics (banking/medical pages are not blocked yet)
- Full Smart mode (engagement, invites, badge) — host-permission education/grant/revoke is on `main`; inject/caps still WIP
- Hardware Nano smoke beyond checklist rows — DOM-31 / [`docs/nano-verification-checklist.md`](docs/nano-verification-checklist.md); CI covers curated / Nano-off only

## Contributing / development notes

Solo WIP. Prefer small, verifiable milestones over expanding MVP scope. Open work via PR into `main`. Agents follow `.cursor/rules/pre-push-hygiene.mdc` on every push/PR.

## Cursor practices

Shared agent rules under `.cursor/rules/` (committed; local MCP/sync state stays gitignored):

| Practice | Rule | What it does |
| --- | --- | --- |
| Pre-push hygiene | [`pre-push-hygiene.mdc`](.cursor/rules/pre-push-hygiene.mdc) | Refresh README (including this section), block secrets/junk, keep docs/branches aligned before push/PR |
| Linear ⇆ Cursor sync | [`linear-sync.mdc`](.cursor/rules/linear-sync.mdc) | Pull Linear changes first (ask before absorbing); push status/checklists as work happens; issue sizing habits |
| Stuck-agent watchdog | [`stuck-agent-watchdog.mdc`](.cursor/rules/stuck-agent-watchdog.mdc) + [`.cursor/hooks/`](.cursor/hooks/) | When launching background Tasks, arm a notify heartbeat so silent hangs get nudged within minutes |

Also useful: project skill [`.cursor/skills/linear-workflow/SKILL.md`](.cursor/skills/linear-workflow/SKILL.md) for issue sizing / parent–sub-issue structure. CI + Vitest/Playwright (`npm run test:ci`) remain the automated quality gate; Linear tickets track milestone automation (e.g. Nano contracts, Smart e2e, a11y/coverage).
