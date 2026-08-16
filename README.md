# PromptAhead

> **WIP — M4 release readiness.** Manual core + Nano + Smart + polish + store docs on `main`. Full §25 acceptance map (DOM-45) ready for your Chrome pass; compare expand (DOM-68 / PR #40) smoke with that pass. Store upload / listing assets still TBD.

**Your next question, already prepared.**

Privacy-first Chrome extension (Manifest V3) that notices when you are genuinely interested in a page and helps you decide what to explore next. It builds an editable prompt for ChatGPT, Claude, Gemini, Perplexity, or any LLM you choose. No PromptAhead backend, accounts, or remote model calls in MVP — optional on-device Gemini Nano when available, curated fallback otherwise. **Page content never leaves the device via PromptAhead**; Nano runs only through Chrome’s on-device Prompt API.

## Status

| Area | State |
| --- | --- |
| Product extension (`extension/`) | **Manual core** + **M2 Nano UX** + **M3 Smart** (grant/revoke, engagement, badge invite, accept→extract) |
| Side panel | Workflow state machine; Nano thinking + curated fallback + **Retry local AI**; **randomized microcopy** on loading/success; calm Nano panel notices + Smart permission education; **selection auto-refresh** on low-value empty state; **step enter motion (~450ms) + ~1s prompt-build fill bar + full-width Back nav** |
| Onboarding + settings | Manual-first first-run; Nano ready/download/unsupported + **check-loading bar** + **top Back nav**; Settings Smart grant/revoke + education; **shared dark-first theme** (panel + options, light via `prefers-color-scheme`); **global proactive pause** toggle |
| Destinations | Deep links with **app-first + web fallback**; Gemini / oversized prompts use **clipboard + open**; never auto-submit |
| Automation | Vitest (unit + jsdom UI + **coverage gates** on domain/messaging), Playwright (MV3 + navigate→stale + Nano-off curated + Smart invite/pause/revoke + homepage empty-state + **axe a11y** + **sensitive Manual override**), GitHub Actions (`test:ci`, Node 20.19+) |
| Nano CI | Curated path stays green with Nano forced off (`NANO_FORCE_DISABLED` + Playwright Settings force-basic → extract → copy); live hardware checklist remains DOM-31 / [`docs/nano-verification-checklist.md`](docs/nano-verification-checklist.md) |
| Nano engine | Longer create/prompt budgets; prefer unconstrained prompt then constrain; retain failure reason on curated fallback |
| M1 acceptance | Manual §25 map + smoke notes in [`docs/test-plan.md`](docs/test-plan.md) |
| M0 spike harness (`spikes/`) | **Done** — S0.1–S0.7 implemented and run |
| Spike results (`docs/technical-spikes.md`) | **Filled** — Chrome **150.0.0.0** (2026-08-01) |
| Extraction | JSON-LD / Open Graph / semantic-HTML classification with size caps; HTML fixtures include JSON-LD + **DOM-only product grids** + **prompt-injection suite**; **page-value gate** (editors / home / large listings → empty unless selection; **≤10 named products/articles → compare-these direction**); Readability deferred |
| Engagement | Domain + content tracker; CRXJS `?script` boot; article invite **30s OR ~⅓ scroll**; low-value skip (DOM-60); **sensitive proactive block** full fixture matrix (DOM-37); **per-tab invite badge** |
| Invitation (Smart) | State machine + **caps** (once/page · once/domain/day · ≤3/day) + snooze / exclude / global pause persistence (Vitest); SW badge on threshold (no extract); accept → panel + Manual extract/suggest; dismiss·snooze·exclude clear badge; Manual extract still works when proactive paused; Settings **Pause proactive Smart invites**; Playwright **badge→accept→extract** + **pause UI** + revoke→Manual; optional `chrome.notifications` deferred |
| Suggestions + prompts | Curated + mock-Nano + real `NanoSuggestionEngine` (validate / repair / timeout / curated fallback); small ItemList / multi-product pages get **Compare these N** first; **injection fixtures** assert sealed SOURCE_DATA |
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

Load **`extension/dist/`** unpacked on `chrome://extensions`. Open a normal article or product page and click the toolbar icon (or context menu / `Alt+Shift+P`): PromptAhead extracts that page, opens the side panel, and offers curated (or on-device Nano) directions when enabled. Homepages, large category/search lists, and app/editor surfaces (e.g. Google Docs) show a calm empty state unless you select text first — after the empty state, selecting text on the page auto-refreshes the panel (no Refresh click). Short named lists (up to 10 products or articles from structured markup) stay promptable with a **Compare these N** direction.

First run shows a short, skippable onboarding (Manual default; optional Nano download; always **Continue with basic private mode**). Build a prompt, edit it, then:

- **Copy** — clipboard only
- **Open in ChatGPT / Claude / Perplexity** — deep link (native app scheme when available, then web URL with `q=` prefill)
- **Open in Gemini** (and any oversized prompt) — copy to clipboard, then open the chat UI for paste

Nothing is auto-submitted. **Refresh from page** re-reads the same tab until it navigates — after that Chrome revokes `activeTab` and you invoke the extension again (panel shows calm stale / access-lost UX). From a low-value empty state, opening an article updates the panel CTA (and auto-captures when Smart website access is already granted). Settings and **Clear all PromptAhead data** live on the options page.

### Developer scripts

| Script | Purpose |
| --- | --- |
| `npm run build` | Build product extension → `extension/dist/` |
| `npm run typecheck` | TypeScript check (product + spikes) |
| `npm run lint` | ESLint |
| `npm run test` | Vitest unit / jsdom UI tests |
| `npm run test:coverage` | Vitest + coverage gates (domain + messaging) |
| `npm run test:e2e` | Build + Playwright MV3 extension tests |
| `npm run test:e2e:headed` | Same as `test:e2e` with a visible browser |
| `npm run test:ci` | typecheck → lint → Vitest+coverage → build → Playwright |
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
| [`docs/perf-notes.md`](docs/perf-notes.md) | M4 perf spot-check notes (DOM-73) |
| [`docs/chrome-web-store-privacy.md`](docs/chrome-web-store-privacy.md) | CWS privacy practices draft (DOM-44) |
| [`docs/release-checklist.md`](docs/release-checklist.md) | Internal CWS submission dry-run checklist (DOM-44) |
| [`docs/acceptance-map-m4.md`](docs/acceptance-map-m4.md) | Full-product §25 map + consolidated manual / rubric pass (DOM-45) |

`docs/promptahead-prd.md` is currently an identical copy of the handoff (legacy alias). Prefer the handoff path in links.

## What is intentionally missing

- Chrome Web Store packaging / listing (M4) — privacy draft + release checklist in docs; upload / listing assets still TBD
- Main-content extraction beyond the thin `main`/`article` heuristic; Mozilla Readability license call still open
- Sensitive-page heuristics for **proactive Smart** and **Manual override** (DOM-37 / DOM-39): URL + DOM auto-block; Manual shows a blocking confirm before extract (no sticky bypass)
- Full Smart mode polish (optional notifications, dedicated invite dismiss UI) — badge/SW + accept→panel+extract landed; Playwright badge→accept + pause UI + revoke→Manual shipped

- Hardware Nano smoke beyond checklist rows — DOM-31 / [`docs/nano-verification-checklist.md`](docs/nano-verification-checklist.md); CI covers curated / Nano-off only
- Optional full local history UI / developer eval export (DOM-41 / DOM-42)

## Contributing / development notes

Solo WIP. Prefer small, verifiable milestones over expanding MVP scope. Open work via PR into `main`. Agents follow `.cursor/rules/pre-push-hygiene.mdc` on every push/PR.

## Cursor practices

Shared agent rules under `.cursor/rules/` (committed; local MCP/sync state stays gitignored):

| Practice | Rule | What it does |
| --- | --- | --- |
| Pre-push hygiene | [`pre-push-hygiene.mdc`](.cursor/rules/pre-push-hygiene.mdc) | Refresh README (including this section), block secrets/junk, keep docs/branches aligned before push/PR |
| Linear ⇆ Cursor sync | [`linear-sync.mdc`](.cursor/rules/linear-sync.mdc) | Pull Linear changes first (ask before absorbing); push status/checklists as work happens; issue sizing habits |
| Stuck-agent watchdog | [`stuck-agent-watchdog.mdc`](.cursor/rules/stuck-agent-watchdog.mdc) + [`.cursor/hooks/`](.cursor/hooks/) | Background Task heartbeat via `run-stuck-agent-watchdog.sh` (idle-exit when watch file empty); nudge/replace stuck agents |

Also useful: project skill [`.cursor/skills/linear-workflow/SKILL.md`](.cursor/skills/linear-workflow/SKILL.md) for issue sizing / parent–sub-issue structure. CI + Vitest/Playwright (`npm run test:ci`) remain the automated quality gate; Linear tickets track milestone automation (e.g. Nano contracts, Smart e2e, a11y/coverage).
