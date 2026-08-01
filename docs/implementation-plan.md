# PromptAhead — Implementation Plan

**Status:** Proposed (awaiting approval before application code)  
**Source of truth:** [`promptahead-product-handoff.md`](./promptahead-product-handoff.md)  
**Companion docs:** [`architecture.md`](./architecture.md), [`privacy-threat-model.md`](./privacy-threat-model.md), [`test-plan.md`](./test-plan.md)

## Current repository state and reusable assets

- Greenfield Chrome extension repo: `README.md`, `.gitignore`, git `main` initial commit.
- Product handoff at `docs/promptahead-product-handoff.md` (identical copy also as `promptahead-prd.md`).
- No `package.json`, source, tests, or build pipeline yet.
- Reusable: locked MVP decisions, `PageContext` contract, curated action lists, Nano contracts, fixture matrix, notification state machine.

## Recommended stack (summary)

TypeScript + Manifest V3 + Vite/CRX bundler + Vitest + vanilla side-panel/options UI + `chrome.storage.local` + bundled Readability (license-reviewed) + `@types/dom-chromium-ai`. No backend, no React-by-default, no WebLLM.

See [`architecture.md`](./architecture.md) for folder layout, message flow, and permission matrix.

---

## Milestone 0 — Technical validation

**Scope (≤5 lines):** Prove volatile Chrome APIs in isolated spikes before product UI. Confirm Prompt API contexts, availability/download, structured JSON, Side Panel open paths, `activeTab` manual extraction without broad hosts, optional host grant/revoke, and non-intrusive notifications. Document in `docs/technical-spikes.md`. Curated mode must remain unblocked if Nano fails.

### Deliverables

| Spike                        | Question to answer                                                                                                          | Success criteria                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| S0.1 Prompt API contexts     | Does `LanguageModel` work in side panel, options page, service worker?                                                      | Matrix of available / unavailable with Chrome version          |
| S0.2 Availability + download | `availability()`, user-activated `create()` + `downloadprogress`                                                            | Progress UI path documented; skippable failure path clear      |
| S0.3 Structured JSON         | `responseConstraint` schema for action list                                                                                 | Valid JSON parse rate on sample prompts; error shapes captured |
| S0.4 Side Panel              | Open from toolbar, notification click, context menu                                                                         | All three paths work or documented limitation                  |
| S0.5 Manual `activeTab`      | Extract page on action click without host_permissions; does grant survive for panel-driven follow-up scripting on same tab? | Working pattern chosen (prefer extract-on-gesture)             |
| S0.6 Optional hosts          | `permissions.request` / `remove` / `contains`                                                                               | Grant and revoke without reload surprises                      |
| S0.7 Notifications           | Badge + compact notification can open panel without page injection                                                          | Least-intrusive UX selected                                    |

### Tests / checks

- Manual Chrome checklist recorded in `docs/technical-spikes.md`.
- Spike code under `spikes/` only; not wired into product entrypoints.

### Completion criteria

- [ ] `docs/technical-spikes.md` exists with results + Chrome version.
- [ ] Blocking conflicts vs handoff listed with smallest alternatives (no silent product changes).
- [ ] Decision recorded: Nano host context; Manual extraction gesture pattern.

### Checklist (update during work)

- [ ] Scaffold `spikes/` harness
- [ ] Run S0.1–S0.7
- [ ] Write spike report
- [ ] Resolve or escalate `activeTab`/panel conflict if extraction-on-gesture is insufficient

---

## Milestone 1 — Deterministic manual core

**Status:** Ready to start (M0 decisions locked 2026-08-01 — see `docs/technical-spikes.md`)  
**First issue:** [DOM-7](https://linear.app/domagojp/issue/DOM-7) — scaffold MV3 + TS + Vite/CRX + Vitest + lint + build

**Scope (≤5 lines):** Ship a loadable MV3 TypeScript extension with Manual mode (`activeTab` + `scripting`), toolbar + side panel, deterministic article/product/generic recognition, compact extraction, curated + **More…** actions, **Anything to add?**, editable prompts, context preview/controls, Copy / Copy-and-open destinations, latest-three history, settings + clear data, and `SuggestionEngine` with curated + mock-Nano adapters. No Smart host permission. No real Nano.

### M0 → M1 carry-forward (do not reopen)

| Topic                 | Locked choice                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manual extraction     | Gesture (toolbar / context menu / shortcut) extracts in SW; `openPanelOnActionClick: false`; panel may re-fetch **same tab** until navigation/close |
| Manual permissions    | `activeTab` + `scripting` only — no optional hosts                                                                                                  |
| Nano in M1            | Mock/curated only; real Prompt API = M2; host in **side panel** when added                                                                          |
| Smart / notifications | Out of scope for M1; badge-first when M3 lands                                                                                                      |
| Cold-start / timeout  | Budget for ~6s+ first prompt in M2; curated path must not depend on Nano                                                                            |

### Deliverables

- Extension scaffold (manifest, build, load unpacked) under `extension/` (spikes stay throwaway).
- Onboarding shell (mode explanation; Smart deferred or disabled until M3; destination pick; skippable Nano placeholder).
- Content extraction pipeline + classification.
- Side-panel state machine: Understanding → Choose → Refine → Review → Prompt ready → Success / Fallback.
- Destinations: ChatGPT, Claude, Gemini, Perplexity, universal Copy.
- Storage: settings + recent history (3).
- `CuratedSuggestionEngine` + `MockNanoSuggestionEngine`.

### Permissions

`sidePanel`, `activeTab`, `scripting`, `storage` (+ optional `contextMenus`, commands).

### Tests

- Unit: classification, metadata parsing, extraction caps, prompt construction, page-language behavior, storage schema, delimiter/injection resistance.
- HTML fixtures: article / product / generic (subset of handoff §34).
- Integration: message passing + storage round-trip.
- Manual smoke: load unpacked, analyze article + product, copy prompt, clear data.

### Completion criteria

- [ ] `tsc`, lint, Vitest pass; extension builds.
- [ ] Unpacked smoke checklist documented and run.
- [ ] Permissions match Manual-only feature set.
- [ ] Curated path works with mock Nano disabled.
- [ ] Acceptance criteria mapped (handoff §25 Manual-related).

### Checklist

- [ ] Scaffold + CI scripts (`typecheck`, `lint`, `test`, `build`) — **DOM-7**
- [ ] Messaging + storage layer — **DOM-8** (code + unit tests landed; unpacked smoke pending)
- [ ] Extraction + classification + fixtures
- [ ] Curated / mock suggestion engines
- [ ] Prompt builder + destinations
- [ ] Side panel workflow
- [ ] Options/settings + clear data
- [ ] Onboarding (Manual-first)
- [ ] Manual smoke report

### Kickoff order

1. **DOM-7** — product `extension/` scaffold (do not merge spikes into product entrypoints).
2. Messaging + versioned `chrome.storage` schemas.
3. Gesture extract → `PageContext` → side panel (reuse S0.5 pattern).
4. Classification + curated actions + prompt builder + copy/open.
5. Onboarding/settings shell + smoke report.

## Milestone 2 — Gemini Nano

**Scope (≤5 lines):** Optional Nano adapter behind `SuggestionEngine`. Onboarding readiness, user-activated download with real progress, skippable basic private mode, structured actions + ranking, prompt generation without rewriting source context, validation / one repair / timeout / fallback / retry, Settings status. No worker assumption if API disallows it. Curated tests must still pass with Nano unavailable.

### Deliverables

- `NanoSuggestionEngine` using verified context from M0.
- Onboarding readiness states: ready / download / unsupported / skipped.
- Timeout (initial 10s), repair once, clear fallback copy, **Retry local AI**.
- Settings: Nano status + setup retry + force basic mode.
- Dev-friendly disable flag for tests.

### Permissions

No new host permissions.

### Tests

- Contract tests with mock Nano; Nano-disabled suite green.
- Manual: download progress, structured actions, fallback on timeout/invalid JSON, language following.
- Unit: output validation, duplicate removal, character caps.

### Completion criteria

- [ ] Curated suite unchanged green with Nano forced off.
- [ ] Manual Nano checklist on supported hardware documented.
- [ ] Fallback microcopy and retry wired.
- [ ] Privacy docs note on-device-only processing.

### Checklist

- [ ] Adapter + validation pipeline
- [ ] Onboarding download UX
- [ ] Side-panel Nano orchestration
- [ ] Settings status
- [ ] Fallback + retry
- [ ] Manual verification notes

---

## Milestone 3 — Smart mode

**Scope (≤5 lines):** Optional proactive experience: Smart preselected with plain-language permission education before Chrome’s prompt; optional runtime website access; local engagement detection; article/product thresholds; once-per-page, once-per-domain/day, three/day caps; badge/notification before Nano; snooze, domain exclusion, global pause; aggregate preference learning without browsing-history retention. Manual remains after revoke.

### Deliverables

- Permission education UI → `permissions.request`.
- Engagement tracker in content script.
- Invitation state machine (handoff §32).
- Caps, snooze, exclusions, global pause.
- Aggregate learning store (no URLs/titles for learning).
- Sensitive-page auto-block for proactive path (full override UX can land late M3 / M4).

### Permissions

Add `notifications` (and `tabs` only if spike proves necessary). Optional hosts via runtime grant.

### Tests

- Unit: thresholds, caps, state machine, learning aggregates.
- Sensitive false-positive fixtures.
- Manual: grant, trigger, dismiss, snooze, exclude, revoke → Manual still works.

### Completion criteria

- [ ] Smart never fires on protected fixture set.
- [ ] Caps enforced.
- [ ] Revocation leaves Manual functional.
- [ ] No Nano until user accepts invitation.

### Checklist

- [ ] Permission education + request/revoke
- [ ] Engagement signals
- [ ] Invitation UX
- [ ] Caps / snooze / exclusions / pause
- [ ] Aggregate learning
- [ ] Manual regression after revoke

---

## Milestone 4 — Safety, polish, and evaluation

**Scope (≤5 lines):** Sensitive-page blocking + explicit manual override warning; injection fixture tests; optional full local history; developer evaluation mode + JSON export; randomized playful microcopy, sober security warnings, purposeful animation; a11y (keyboard, SR, focus, AA, reduced motion); dark mode; performance profiling; Chrome Web Store privacy disclosure draft + release checklist.

### Deliverables

- Sensitive detector + override modal (no forever bypass for high-risk categories).
- Full history UI (search, delete one, clear all).
- Developer panel + local export with PII warning.
- Motion + microcopy pools; dark theme; a11y pass.
- `docs/chrome-web-store-privacy.md` + `docs/release-checklist.md`.
- Perf notes: curated &lt;500ms after extraction; panel paint &lt;100ms target.

### Tests

- Full injection + sensitive fixture suites.
- A11y manual checklist.
- Perf spot measurements recorded.

### Completion criteria

- [ ] Handoff §25 acceptance mapped and checked.
- [ ] Privacy disclosure matches behavior.
- [ ] Curated fallback still works.
- [ ] No unrelated scope creep.

### Checklist

- [ ] Sensitive pages + override
- [ ] Injection fixtures complete
- [ ] Full history
- [ ] Developer mode + export
- [ ] Polish / a11y / dark mode
- [ ] Store privacy + release docs
- [ ] Final smoke + eval rubric dry run

---

## Five largest implementation risks and mitigations

| #   | Risk                                                                                                                                   | Mitigation                                                                                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **`activeTab` vs side-panel UX** — panel-internal clicks do not grant `activeTab`; Manual mode must not silently require `<all_urls>`. | M0 spike: extract (or retain access) on action/shortcut/context-menu gesture; pass `PageContext` into panel. Escalate smallest alternative only if gesture pattern fails. |
| 2   | **Prompt API context / quality volatility**                                                                                            | Feature-detect; keep Nano optional; curated always tested; isolate adapter; document Chrome version; one repair + 10s timeout.                                            |
| 3   | **All-sites permission trust hit (Smart mode)**                                                                                        | Defer to M3; Manual-first; education before Chrome prompt; easy revoke; open architecture; no backend.                                                                    |
| 4   | **Prompt injection from page content**                                                                                                 | Structured extraction, delimiters, untrusted framing, JSON constraints, validation, adversarial fixtures.                                                                 |
| 5   | **Proactive annoyance / false engagement**                                                                                             | Conservative thresholds, hard caps, snooze/exclude/pause, invite-before-Nano, local adaptation without URL retention.                                                     |

## Blocking questions

Only items the handoff does not settle:

1. **Manual extraction gesture pattern (post-spike):** If action-click extraction into the side panel is unreliable on current Chrome, may we use the smallest alternative of requesting **optional** host access also for “enhanced Manual”—_or_ must Manual remain `activeTab`-only even if it forces extract-only-on-toolbar-click with no in-panel re-fetch? (**Preference to propose after M0:** keep Manual `activeTab`-only; re-fetch requires another toolbar/shortcut invocation.)
2. **Notification surface:** Prefer `chrome.notifications` + badge vs badge-only if notification permission friction is high—confirm after S0.7 which meets “compact, non-page-injected” best.
3. **Readability license:** Confirm bundling Mozilla Readability (Apache-2.0) is acceptable for distribution; otherwise keep the custom main-content heuristic. (**Deferred, not blocking:** the first DOM-13 slice ships a thin `main`/`article` + JSON-LD/OG heuristic. Revisit once real-page misses show the heuristic is the limiting factor — the snapshot shape already isolates the swap.)

No questions that reopen locked MVP name, destinations, curated lists, privacy (no backend), or Smart-vs-Manual product split.

## Progress reporting protocol

At each milestone start: restate scope in ≤5 lines and refresh checklists above.  
After each milestone: what shipped, exact test results, key modules, limitations, safest next milestone.

## Approval gate

**Stop here.** No application code until explicit approval to proceed (recommend starting with Milestone 0 spikes).
