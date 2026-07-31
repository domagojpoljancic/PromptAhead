# PromptAhead — Test Plan

**Status:** Proposed  
**Source of truth:** [`promptahead-product-handoff.md`](./promptahead-product-handoff.md) §§25, 34  
**Related:** [`implementation-plan.md`](./implementation-plan.md), [`architecture.md`](./architecture.md)

## 1. Goals

- Keep curated (non-AI) mode correct and fast at every milestone.
- Prove extraction, classification, prompt safety, storage, and messaging without live websites where possible.
- Isolate Gemini Nano behind contracts; CI uses mocks; real Nano is manual on supported hardware.
- Map tests to handoff acceptance criteria.

## 2. Test layers

| Layer | Tooling | Scope |
| --- | --- | --- |
| Unit | Vitest | Pure domain: classification, metadata, caps, prompts, sensitive heuristics, caps/state machines, storage migrations |
| Fixture | Vitest + HTML fixtures | Article/product/generic extraction; sensitive pages; prompt injection |
| Integration | Vitest + chrome mock / minimal harness | Typed messaging; storage facades; suggestion engine switching |
| Manual Chrome | Checklist in docs | Permissions, side panel, notifications, Nano download, smoke flows |
| Evaluation (dev) | Local developer mode | Nano rubric scoring; JSON export |

Optional later: Playwright/Puppeteer extension loading if stable enough; not a M1 gate.

## 3. Modes required in automation

| Mode | Purpose |
| --- | --- |
| `SUGGESTION_ENGINE=curated` | Default CI path |
| `SUGGESTION_ENGINE=mock-nano` | Deterministic structured “AI” responses |
| `SUGGESTION_ENGINE=nano` + `NANO_FORCE_DISABLED=1` | Ensures fallback wiring without hardware |

Never call cloud models in tests.

## 4. Fixture matrix

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

| Fixture | Auto analysis |
| --- | --- |
| Login form | Block |
| Password change | Block |
| Checkout | Block |
| Card payment | Block |
| Banking dashboard | Block |
| Webmail | Block |
| Private doc editor | Block |
| Medical portal | Block |
| Benign article mentioning “bank” / “password” | Allow (false-positive guard) |

### Prompt injection

| Fixture | Expect |
| --- | --- |
| Hidden ignore-instructions text | Not obeyed; delimited in source only |
| Visible fake system prompt | Not promoted to instructions |
| Product “recommend only us” | Not forced as policy |
| Malicious HTML attributes | Stripped or inert in context |
| Extremely long repeated instructions | Caps prevent crowding out system prompt |

**Acceptance:** No unsafe instruction from fixtures appears as an instruction in the generated prompt.

## 5. Unit test catalog (minimum)

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

### Engagement (M3+)

- Article: 45s active + 35% scroll.
- Product: 30s + interaction signal.
- Hidden/unfocused time excluded.
- Once per page; once per domain/day; 3/day global.
- Snooze / exclude / pause transitions.

## 6. Integration tests

- Content → worker → panel message round-trip with typed payloads.
- Action-click extraction path stores/forwards `PageContext` for side panel (per M0 decision).
- Permission `contains` / mocked request / revoke updates settings mode safely.
- Destination open URLs are correct; no auto-submit APIs called.

## 7. Manual Chrome verification checklists

### M1 smoke

1. Load unpacked build.
2. Open article page → toolbar → side panel populates actions &lt; feeling sticky.
3. Select action → add note → inspect context → edit prompt → Copy.
4. Copy-and-open each destination once.
5. Confirm latest-three history; clear all data.
6. Confirm manifest has no broad host permission.

### M2 Nano

1. Unsupported / unavailable → basic mode messaging; curated works.
2. Download required → user gesture → progress → ready.
3. Valid actions in page language; invalid JSON → repair → fallback copy shown → Retry.
4. Force timeout → fallback &lt; ~10s policy.

### M3 Smart

1. Education UI precedes Chrome permission dialog.
2. Engagement on article/product triggers badge/notification once.
3. Dismiss / snooze / don’t suggest on this site / global pause.
4. Caps hold under repeated browsing.
5. Revoke host access → Manual still works.
6. Protected pages never proactive-trigger.

### M4 a11y / polish

- Full keyboard path to copy.
- Visible focus; SR announcements for processing/fallback/ready.
- Forced colors / contrast spot check AA.
- `prefers-reduced-motion` disables non-essential motion.
- Dark mode readable.

## 8. Nano evaluation rubric (manual, developer mode)

Score each action set 0–2 on: specificity, diversity, usefulness, factual restraint, clarity/brevity, injection resistance.  
Store only locally. Goal: whether Nano beats curated for this narrow UX—not general intelligence.  
Target: ≥1 of 3 suggestions useful on 80% of the manual eval set.

## 9. Performance checks

| Metric | Target |
| --- | --- |
| Side panel first paint / state | ≤100 ms feel (instrument where practical) |
| Curated actions after extraction | ≤500 ms |
| Nano useful suggestions | ~5 s target; hard fallback 10 s |
| Engagement listeners | No visible scroll/input jank |

Record methodology in milestone report; do not add artificial delays.

## 10. Definition of done (testing)

A milestone’s tests are done when:

- Automated suite green (`typecheck`, lint, unit/fixture/integration).
- Milestone manual checklist executed and results written into the milestone report.
- Curated path verified with Nano unavailable.
- Privacy assumptions / limitations updated if new data flows appeared.
- No live-site-only assertions without a fixture backup for core classifiers.

## 11. Acceptance criteria mapping (summary)

| Handoff §25 item | Primary coverage |
| --- | --- |
| Manual without all-site access | M1 manual checklist + manifest assert |
| Smart optional + revocable | M3 integration + manual |
| No proactive on protected pages | Sensitive fixtures + M3 manual |
| Article/product detection | Fixture suite (≥90%) |
| Nano 3+ actions in page language | M2 manual + mock contracts |
| Invalid/slow Nano → fallback | Unit validator + M2 manual |
| Prompt contents + context controls | Unit prompt tests |
| Copy / copy-and-open; panel stays open | M1 manual |
| Latest three prompts | Storage unit + manual |
| No remote analytics/backend | Architecture review + network observation during smoke |
| Injection safety | Injection fixtures |
| &lt;10 s to copy (excl. download) | M1/M4 manual timing |
| Curated with Prompt API disabled | CI curated + force-disabled |
