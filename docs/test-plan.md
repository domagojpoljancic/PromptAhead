# PromptAhead — Test Plan

**Status:** Active (hybrid automation as of DOM-24)  
**Source of truth:** [`promptahead-product-handoff.md`](./promptahead-product-handoff.md) §§25, 34  
**Related:** [`implementation-plan.md`](./implementation-plan.md), [`architecture.md`](./architecture.md)

## 1. Goals

- Keep curated (non-AI) mode correct and fast at every milestone.
- Prove extraction, classification, prompt safety, storage, and messaging without live websites where possible.
- Isolate Gemini Nano behind contracts; CI uses mocks; real Nano is manual on supported hardware.
- Automate side-panel / settings click-through and MV3 integration; keep only a tiny real-Chrome release smoke manual.
- Map tests to handoff acceptance criteria.

## 2. Test layers

| Layer | Tooling | Scope |
| --- | --- | --- |
| Unit | Vitest | Pure domain: classification, metadata, caps, prompts, sensitive heuristics, storage migrations, onboarding/workflow helpers |
| Fixture | Vitest + HTML fixtures | Article/product/generic extraction; sensitive pages; prompt injection |
| Integration | Vitest + chrome mock | Typed messaging; storage facades; suggestion engine switching |
| UI click-through | Vitest + jsdom | Side panel + options: onboarding, workflow, inclusion empty-block, stale/empty/fallback, settings, clear-data (`initSidePanel` / `initOptions` with injected deps) |
| Extension e2e | Playwright + persistent Chromium | Loads `extension/dist/` (test-only host grant for local fixture origin); service worker, options, direct side-panel page, local fixture extract → prompt → copy |
| Manual release smoke | Real Chrome checklist below | Toolbar/context-menu gesture, `activeTab` revoke, real clipboard, one provider handoff |
| Evaluation (dev) | Local developer mode | Nano rubric scoring; JSON export |

CI entrypoint: `npm run test:ci` (typecheck → lint → Vitest → build → Playwright).

## 3. Modes required in automation

| Mode | Purpose |
| --- | --- |
| `SUGGESTION_ENGINE=curated` | Default CI path |
| `SUGGESTION_ENGINE=mock-nano` | Deterministic structured “AI” responses |
| `SUGGESTION_ENGINE=nano` + `NANO_FORCE_DISABLED=1` | Ensures fallback wiring without hardware |

Never call cloud models in tests. Playwright never opens live ChatGPT / Claude / Gemini / Perplexity sites.

## 4. Automated vs manual (release)

### Automated (CI / `npm run test:ci`)

- Domain unit + HTML fixture extraction
- Messaging / storage integration with chrome mock
- Side-panel and options jsdom click-through (DOM-10 / DOM-11 happy paths + key failures)
- Playwright against built MV3: service-worker PING, options persistence, onboarding skip, local fixture extract → curated flow → copy, clear-all, **Nano forced off (Settings force basic) → curated extract → prompt → copy**, **Smart invite threshold → badge → accept → panel extract**, **Settings pause → no invite badge + Manual extract still works**, **Smart revoke → Manual extract → curated still works** (DOM-56 Done)
- Sensitive-page **proactive** auto-block Vitest matrix (login, password-change, checkout, card, banking, webmail, private doc, medical + FP article) — [DOM-37](https://linear.app/domagojp/issue/DOM-37)
- Production manifest stays `activeTab`-only; e2e copies `extension/dist/` and adds a **test-only** `host_permissions` entry for `http://127.0.0.1:<fixture-port>/*`
- Real Nano hardware / Prompt API smoke stays manual: [`nano-verification-checklist.md`](./nano-verification-checklist.md) (DOM-31) — Playwright never downloads or runs Nano
- Remaining OS permission-dialog edges: [DOM-38](https://linear.app/domagojp/issue/DOM-38) manual smoke (Done); Manual override modal on protected pages: [DOM-39](https://linear.app/domagojp/issue/DOM-39)


### Manual release smoke (keep tiny)

Run once on a real Chrome profile before tagging / store upload:

1. Load unpacked `extension/dist/` from `chrome://extensions` (Developer mode).
2. On a normal `https` page, open the panel via **toolbar icon** (and once via context menu or `Alt+Shift+P`) — confirms gesture → `activeTab` → extract → panel.
3. Navigate the tab after capture, then **Refresh from page** — expect the revoke / re-invoke copy (not a silent wrong page).
4. Build a prompt and **Copy**; paste into a notes app (real clipboard).
5. **Open in** one provider (e.g. ChatGPT) — confirm prefill or paste hint; nothing auto-submitted.
6. Settings → **Clear all PromptAhead data** → reopen panel → onboarding returns.

Do **not** require full matrix of destinations, languages, or fixture pages in the manual pass — those live in Vitest / Playwright.

## 5. Fixture matrix

Store under `tests/fixtures/html/` with expected JSON sidecars where useful.

### Recognition / extraction

| Fixture | Expect |
| --- | --- |
| NewsArticle JSON-LD complete | `pageType: article`; publisher/author/date present |
| Blog without structured metadata | `article` or high-quality `generic` with headings/excerpts |
| Paywalled intro only | Truncation reported; no invented body |
| Product JSON-LD | `pageType: product`; price/brand when present |
| Dynamic price (static snapshot approximating) | Graceful missing price |
| Product list / search | Not a single product (`generic` or list-safe behavior) |
| Marketplace multi-seller | Product if primary entity clear; else generic |
| Generic docs page | `generic` |
| Empty / error / unsupported | Safe empty context; no throw |

**Quality target:** ≥90% correct article/product/generic on maintained fixture set.

### Sensitive pages

| Fixture | Auto analysis | Automation |
| --- | --- | --- |
| Login form | Block | Vitest `sensitive-page.test.ts` + Playwright override (DOM-37/39) |
| Password change | Block | Vitest + Playwright (DOM-37/39) |
| Checkout | Block | Vitest + Playwright (DOM-37/39) |
| Card payment | Block | Vitest + Playwright (DOM-37/39) |
| Banking dashboard | Block | Vitest + Playwright (DOM-37/39) |
| Webmail | Block | Vitest + Playwright (DOM-37/39) |
| Private doc editor | Block | Vitest + Playwright (DOM-37/39) |
| Medical portal | Block | Vitest + Playwright (DOM-37/39) |
| Benign article mentioning “bank” / “password” | Allow (false-positive guard) | Vitest + Playwright (DOM-37/39) |

**Manual-only:** none for the matrix above — live-site spot checks remain optional smoke, not a CI gate.

### Prompt injection

| Fixture | Expect | Automation |
| --- | --- | --- |
| Hidden ignore-instructions text (`injection-hidden-ignore.html`) | Not collected / not obeyed; delimited in source only | Vitest `injection-fixtures.test.ts` (DOM-40) |
| Visible fake system prompt (`injection-fake-system.html`) | Not promoted to instructions | Vitest (DOM-40) |
| Product “recommend only us” (`injection-product-recommend-us.html`) | Not forced as policy | Vitest (DOM-40) |
| Malicious HTML attributes (`injection-malicious-attrs.html`) | Stripped or inert in context | Vitest (DOM-40) |
| Extremely long repeated instructions (`injection-long-repeat.html`) | Caps prevent crowding out system prompt | Vitest (DOM-40) |

**Acceptance:** No unsafe instruction from fixtures appears as an instruction in the generated prompt. Covered by Vitest through extract → `buildPrompt` (no live LLM).

## 6. Unit test catalog (minimum)

### Classification & extraction

- JSON-LD `NewsArticle` / `Article` / `Product` detection priority over weak heuristics.
- Open Graph fallback.
- Heading/excerpt caps enforced.
- Selected text priority + truncation flag.
- Language detection / passthrough behavior for prompts.
- No form values, scripts, or hidden cookie-banner dumps in excerpts.

### Prompt construction

- Includes task, optional note, delimited source, untrusted-data instruction, web-research/citation/uncertainty asks, action-specific output format.
- Context inclusion toggles remove title/URL/page/selection/note as requested.
- Page language vs Settings override.

### Suggestions

- Curated primary (3) + More lists match handoff §13 per page type.
- Mock Nano returns schema-valid ranked actions.
- Validator rejects duplicates, title-restatements, over-long titles/descriptions, research-claiming output.
- Repair attempted once; then curated fallback.

### Storage

- Recent history max 3; oldest evicted.
- Clear history / clear preferences / clear all.
- Schema migration no-op and v1→v2 stub.

### UI / workflow (jsdom)

- Onboarding welcome → mode → destination → nano → complete (and skip).
- Choose → Refine → Review → Prompt → Copy success.
- Empty inclusion block disables Build prompt.
- Stale / empty / extraction fallback cards.
- Options destination / language save; clear history; clear all (+ confirm cancel).

### Engagement (M3+)

- Article: 30s active **or** ~⅓ scroll (either bar).
- Product: 30s + disposition signal.
- Hidden/unfocused time excluded.
- Once per page; once per domain/day; 3/day global.
- Snooze / exclude / pause transitions.

## 7. Integration & e2e tests

### Vitest + chrome mock

- Content → worker → panel message round-trip with typed payloads.
- Action-click extraction path stores/forwards `PageContext` for side panel (per M0 decision).
- Permission `contains` / mocked request / revoke updates settings mode safely.
- Destination deep links are correct per provider registry; no auto-submit query params; Gemini / oversize use clipboard + base URL; app→web fallback is covered by unit tests.

### Playwright (MV3)

Scripts: `npm run test:e2e` / `test:e2e:headed` / included in `test:ci`.

- Launch `chromium.launchPersistentContext` with `--load-extension` pointing at a **copy** of `extension/dist/`.
- Assert service worker + `PING`.
- Open `chrome-extension://<id>/src/options/index.html` and `…/sidepanel/index.html` directly (no `chrome://extensions` automation).
- Serve `tests/fixtures/html/article-jsonld.html` on `127.0.0.1`; extract via background with test-only host grant.
- Walk curated prompt flow to Copy; clear-all from options.
- Force basic private mode (Nano off) → curated suggestions still complete extract → prompt → copy (hardware Nano remains DOM-31).
- Smart revoke → settings Manual → fixture extract → curated still completes (DOM-56).
- Smart invite threshold message → `!` badge → accept → panel extract (DOM-56; no real permission dialog / dwell in CI).
- Settings pause checkbox → `proactive_paused` suppresses badge; Manual extract still completes (DOM-56).
- Protected-page (DOM-37 deferred) e2e still open; OS permission-dialog + notification edges: [DOM-38](https://linear.app/domagojp/issue/DOM-38) (Done manual smoke). Chrome Details → Site access may stay “On all sites” after `permissions.remove(<all_urls>)` — product truth is Settings / `permissions.contains`.

## 8. Manual Chrome verification checklists


### M1 release smoke

See §4 “Manual release smoke” — that is the only required pre-release Chrome pass for Manual core.

### M1 extended (optional / when debugging)

1. Load unpacked build.
2. Open article page → toolbar → side panel populates actions &lt; feeling sticky.
3. Select action → add note → inspect context → edit prompt → Copy.
4. Open-in each destination once (verify prefill or paste hint; nothing auto-submitted).
5. Confirm latest-three history; clear all data.
6. Confirm manifest has no broad host permission.

### M2 Nano

1. Unsupported / unavailable → basic mode messaging; curated works.
2. Download required → user gesture → progress → ready.
3. Valid actions in page language; invalid JSON → repair → fallback copy shown → Retry.
4. Force timeout → fallback &lt; ~10s policy.

### M3 Smart

1. Education UI precedes Chrome permission dialog — **manual** ([DOM-38](https://linear.app/domagojp/issue/DOM-38) Done); CI does not drive the optional-host dialog.
2. Engagement on article/product triggers badge once — **automated** Playwright path seeds Smart settings and fires `ENGAGEMENT_THRESHOLD` → `!` badge → accept → panel extract (DOM-56); real dwell/scroll + OS notification stay manual.
3. Dismiss / snooze / don’t suggest on this site / global pause — arithmetic in Vitest; Settings **Pause proactive Smart invites** → no badge + Manual extract still works — **automated** Playwright (DOM-56). Snooze/exclude UI edges remain manual/Vitest.
4. Caps hold under repeated browsing — Vitest; flaky OS edges manual.
5. Revoke host access → Manual still works — **automated** Playwright thin path (DOM-56); confirm once on real Chrome under [DOM-38](https://linear.app/domagojp/issue/DOM-38). Note: Chrome Details → Site access may still show “On all sites” after revoke; product truth is Settings / `permissions.contains`.
6. Protected pages never proactive-trigger — **automated** Vitest fixture matrix ([DOM-37](https://linear.app/domagojp/issue/DOM-37)); Manual extract shows override modal then force-confirm — **automated** Playwright ([DOM-39](https://linear.app/domagojp/issue/DOM-39)).

### M4 a11y / polish

- Automated axe (serious/critical) on options + side panel idle/choose — Playwright ([DOM-54](https://linear.app/domagojp/issue/DOM-54)); color-contrast deferred.
- Full keyboard path to copy — manual / [DOM-43](https://linear.app/domagojp/issue/DOM-43).
- Visible focus; SR announcements for processing/fallback/ready — [DOM-43](https://linear.app/domagojp/issue/DOM-43).
- Forced colors / contrast spot check AA — [DOM-43](https://linear.app/domagojp/issue/DOM-43).
- `prefers-reduced-motion` disables non-essential motion — [DOM-43](https://linear.app/domagojp/issue/DOM-43).
- Dark mode readable — [DOM-43](https://linear.app/domagojp/issue/DOM-43).

## 9. Nano evaluation rubric (manual, developer mode)

Score each action set 0–2 on: specificity, diversity, usefulness, factual restraint, clarity/brevity, injection resistance.  
Store only locally. Goal: whether Nano beats curated for this narrow UX—not general intelligence.  
Target: ≥1 of 3 suggestions useful on 80% of the manual eval set.

## 10. Performance checks

| Metric | Target |
| --- | --- |
| Side panel first paint / state | ≤100 ms feel (instrument where practical) |
| Curated actions after extraction | ≤500 ms |
| Nano useful suggestions | ~5 s target; hard fallback 10 s |
| Engagement listeners | No visible scroll/input jank |

Record methodology in milestone report; do not add artificial delays.

**M4 spot-check notes:** [`docs/perf-notes.md`](perf-notes.md) (DOM-73).

## 10a. Playwright flake notes (CI)

Known sources and mitigations ([DOM-53](https://linear.app/domagojp/issue/DOM-53)):

| Source | Mitigation |
| --- | --- |
| Extension page `ERR_ABORTED` / frame detach on first `goto` | Retry navigation up to 3× with short backoff in `openExtensionPage` / launch ready poll |
| Service worker up before message handlers | Poll `PING` via options page until ready (no fixed silent sleep) |
| Fixture server bind race | HTTP readiness probe after `listen` |
| Transient Chromium flakes in Actions | `retries: 2` when `CI=1`; `trace: on-first-retry` |

Prefer `expect.poll` / locator timeouts over `waitForTimeout` unless documenting a Chromium-only transient (see helpers).

## 10b. Coverage gates (Vitest / CI)

`npm run test:ci` runs `vitest run --coverage` (also `npm run test:coverage` locally).

| Scope | Threshold (lines / functions / statements / branches) |
| --- | --- |
| `extension/src/domain/**` + `extension/src/shared/messaging/**` | 75 / 75 / 75 / 65 |

Configured in `vitest.config.ts`. Floors are intentionally modest (below current measured coverage) so feature work is not blocked. To raise: run `npm run test:coverage`, confirm the new numbers are stable, then bump `thresholds` and this table together. Exclude list skips barrels (`index.ts`) and `types.ts`. Spikes / `dist` are out of scope.

## 11. Definition of done (testing)

A milestone’s tests are done when:

- Automated suite green (`npm run test:ci`).
- Milestone manual release smoke executed and results written into the milestone report (DOM-12 acceptance report when filed).
- Curated path verified with Nano unavailable.
- Privacy assumptions / limitations updated if new data flows appeared.
- No live-site-only assertions without a fixture backup for core classifiers.

## 12. Acceptance criteria mapping (handoff §25)

**Full-product map (M4):** [`acceptance-map-m4.md`](./acceptance-map-m4.md) — [DOM-45](https://linear.app/domagojp/issue/DOM-45). Supersedes Manual-only [DOM-12](https://linear.app/domagojp/issue/DOM-12) for release readiness.

Owner for historical M1 Manual close: **DOM-12**. Rows below remain a quick index; prefer the M4 doc for the consolidated manual pass + rubric sheet.

### Manual-related (M1 — covered now)

| Handoff §25 criterion | Coverage |
| --- | --- |
| Manual analyzes active page only after explicit action, without all-site access | Playwright MV3 extract (test-only fixture host grant); production manifest `activeTab`-only; **manual smoke** toolbar / context-menu / shortcut gesture |
| Article and product detection on representative set | Vitest HTML fixture suite (classification + extraction); quality target ≥90% on maintained fixtures |
| Final prompt includes action, optional note, compact context, source URL, research/citation/uncertainty asks | Vitest prompt builder + jsdom Refine inclusion controls |
| Users can inspect and remove included context | Vitest jsdom: empty inclusion block disables Build; per-field toggles |
| Copy and Open-in without auto-submit; panel stays open | Playwright copy path; Vitest destination / handoff unit tests; **manual smoke** one live provider Open-in |
| Latest three prompts retained by default | Vitest storage + options clear-history / clear-all |
| No remote analytics or product backend | Architecture (no backend); **manual smoke** Network tab observation |
| Injection safety (no unsafe page text as instructions) | Vitest injection fixtures (`tests/unit/injection-fixtures.test.ts`, DOM-40) |
| &lt;10 s panel → copy (excl. model download) | Playwright curated flow timing feel; **manual smoke** once on real Chrome |
| Curated mode with Prompt API disabled | CI default `SUGGESTION_ENGINE=curated` + mock-nano / force-disabled modes |
| Stale after navigate / `activeTab` revoke | Vitest access-lost → `#stale`; Playwright navigate → stale; **manual smoke** Refresh after navigate |

**Recorded smoke:** DOM-12 Linear comment (2026-08-03) + checklist on the issue. Still manual-only at release: real toolbar gesture, OS clipboard paste check, one live provider Open-in, Network tab no-backend check. Re-verify on the current cut via [`acceptance-map-m4.md`](./acceptance-map-m4.md) §4.

### Nano / Smart / M4 (mapped in acceptance-map-m4)

| Handoff §25 criterion | Coverage |
| --- | --- |
| Smart optional + revocable; never proactive on protected pages | Playwright Smart invite/pause/revoke; Vitest sensitive proactive matrix; manual ticks in acceptance-map §4C |
| Nano returns 3+ actions; invalid/slow → fallback; usefulness ≥80% eval | Vitest Nano contracts + Playwright Nano-off; hardware rubric sheet in acceptance-map §5 / DOM-31 |
| A11y / polish / store disclosure | Playwright axe; polish shipped; [`chrome-web-store-privacy.md`](./chrome-web-store-privacy.md) |
