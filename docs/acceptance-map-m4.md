# Full-product acceptance map (handoff §25) — M4

**Issue:** [DOM-45](https://linear.app/domagojp/issue/DOM-45) — supersedes Manual-only [DOM-12](https://linear.app/domagojp/issue/DOM-12) for release readiness.  
**Source of truth:** [`promptahead-product-handoff.md`](./promptahead-product-handoff.md) §25 (+ §34 Nano rubric).  
**Companion:** [`test-plan.md`](./test-plan.md), [`release-checklist.md`](./release-checklist.md), [`nano-verification-checklist.md`](./nano-verification-checklist.md).

**How to use**

1. Automated rows: keep green via `npm run test:ci` on the release cut.
2. Manual rows: tick during your Chrome pass (section 4 below).
3. Nano usefulness ≥80%: fill the rubric dry-run sheet (section 5) on hardware if Nano is available; otherwise record **waived — curated-only / Nano off**.

---

## 1. Release-cut scope (no creep)

### In the cut (shipped on `main` or open PR)

| Area | Status |
| --- | --- |
| Manual core + destinations | Shipped |
| Nano suggest + curated fallback + Settings force-basic | Shipped |
| Smart grant/revoke, invite badge, pause, sensitive proactive block | Shipped |
| Sensitive Manual override, injection fixtures | Shipped |
| Polish: motion/Back, onboarding check loading, microcopy, dark theme, a11y focus | Shipped |
| Store privacy draft + release checklist | Shipped (DOM-44) |
| Compare ≤10 + opt-in Include all N ≤40 | Shipped on `main` (DOM-68) — smoke with this pass |

### Explicitly **not** required for §25 / M4 exit

| Backlog | Why out of cut |
| --- | --- |
| Full local history UI (DOM-41) | Optional polish; latest-three still meets §25 |
| Developer eval export (DOM-42) | Rubric can be paper/local without export UI |
| Nano latency (DOM-66) / rank hybrid (DOM-67) | Quality target is usefulness, not sub-5s on all hardware |
| GitHub Wiki (DOM-46) | Docs live in repo |
| Strong-reasoning gap spike (DOM-65) | Review, not a ship gate |

---

## 2. Functional criteria (§25)

| # | Criterion | Coverage | Auto status | Manual tick |
| --- | --- | --- | --- | --- |
| F1 | Manual analyzes active page only after explicit action, without all-site access | Playwright extract; manifest `activeTab` only (no required hosts); **smoke:** toolbar / context menu / `Alt+Shift+P` | CI | [ ] |
| F2 | Smart requests optional website access; can be disabled or revoked | Playwright grant path + revoke→Manual; Settings education | CI | [ ] |
| F3 | Smart never proactively triggers on protected pages | Vitest sensitive matrix (DOM-37); no invite on fixtures | CI | [ ] |
| F4 | Article and product detection on representative set | Vitest HTML fixtures; ≥90% target on maintained set | CI | [ ] optional live spot |
| F5 | Nano returns 3+ primary (+ secondary) in page language | Vitest Nano contracts (mock); **hardware:** DOM-31 checklist | Mock CI | [ ] Nano HW or waive |
| F6 | Invalid/slow Nano → usable fallback | Vitest timeout/repair/fallback; Playwright Nano-off curated | CI | [ ] |
| F7 | Final prompt: action, optional note, compact context, URL, research/citation/uncertainty | Vitest `buildPrompt` + inclusion | CI | [ ] skim once |
| F8 | Users can inspect and remove included context | Vitest jsdom inclusion toggles; Review UI | CI | [ ] |
| F9 | Copy + Open-in without auto-submit; deep-link / clipboard as designed | Playwright copy; Vitest destinations; **smoke:** one live Open-in | CI + smoke | [ ] |
| F10 | Side panel remains open afterward | Playwright / jsdom success step | CI | [ ] |
| F11 | Latest three prompts retained by default | Vitest storage + options | CI | [ ] |
| F12 | No remote analytics or product backend | Architecture; **smoke:** Network tab | Arch + smoke | [ ] |

---

## 3. Quality targets (§25)

| # | Target | Coverage | Auto status | Manual tick |
| --- | --- | --- | --- | --- |
| Q1 | ≥90% article/product/generic on maintained fixtures | `tests/unit/extraction.test.ts` fixture suite | CI | — |
| Q2 | ≥1 of 3 Nano suggestions useful on 80% of eval set | Rubric dry-run (section 5); not automatable in CI | — | [ ] or waive |
| Q3 | No unsafe injection as instructions in generated prompt | Vitest `injection-fixtures.test.ts` (DOM-40) | CI | — |
| Q4 | Panel → copy &lt;10s excl. model download | Playwright curated feel; **smoke:** stopwatch once | CI + smoke | [ ] |
| Q5 | Curated flow with Prompt API disabled | Playwright `Nano forced off…`; CI curated default | CI | [ ] |

---

## 4. Consolidated manual pass (tick while testing “everything”)

Run on unpacked `extension/dist/` after `npm run build` from current `main`.

### A. Build gate

- [ ] `npm run test:ci` green on the cut you will load

### B. Manual / privacy (F1, F9–F12, Q4)

- [ ] Toolbar + one of context menu / shortcut → extract
- [ ] Navigate tab → stale / re-invoke UX
- [ ] Copy → OS paste works
- [ ] Open in one provider → no auto-submit; panel stays open
- [ ] DevTools Network → no PromptAhead backend/analytics
- [ ] Panel → copy feels &lt;10s on curated path

### C. Smart (F2–F3)

- [ ] Grant Smart → badge invite once → accept → extract
- [ ] Pause or revoke → Manual extract still works
- [ ] Sensitive page: no Smart invite; Manual shows override modal

### D. Nano / curated (F5–F6, Q5)

- [ ] Settings force basic / Nano off → full Choose → Copy still works
- [ ] (Optional HW) Nano enabled → 3 directions; or fallback notice + Retry / curated

### E. Polish / onboarding (M4, not all in §25 wording)

- [ ] Onboarding: Nano **checking** shows progress; **Back** strip works
- [ ] Step enter motion + prompt-build “Preparing…” bar
- [ ] Workflow **Back** nav strip obvious
- [ ] Options page readable (dark-first / OS light)
- [ ] Loading/success microcopy may vary; sensitive warnings stay sober

### F. Compare expand — DOM-68

- [ ] Page with **>10** named products → Compare these 10 by default
- [ ] Review shows **Include all N…** (off by default)
- [ ] Opt-in on → prompt lists expanded set (or “Included 40 of N”)
- [ ] ≤10 products → checkbox hidden

### G. Store docs sanity (DOM-44)

- [ ] [`chrome-web-store-privacy.md`](./chrome-web-store-privacy.md) matches manifest permissions
- [ ] [`release-checklist.md`](./release-checklist.md) usable as paper dry-run

---

## 5. Eval rubric dry-run sheet (handoff §34)

Score each action set **0–2** on: specificity, diversity, usefulness, factual restraint, clarity/brevity, injection resistance.  
Goal: whether Nano (or curated) improves this narrow UX — not general intelligence.

| # | Page (URL or fixture) | Engine (Nano / curated) | Spec | Div | Use | Fact | Clear | Inj | Useful? (Y/N) | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | | | | | | | | | | |
| 2 | | | | | | | | | | |
| 3 | | | | | | | | | | |
| 4 | | | | | | | | | | |
| 5 | | | | | | | | | | |

**Q2 result:** useful on ___ / ___ pages (target ≥80%).  
**Waive reason (if any):** _________________________________

Retain scores locally only (no PromptAhead cloud). Developer export UI (DOM-42) not required.

---

## 6. M4 exit criteria cross-check

From [`implementation-plan.md`](./implementation-plan.md) M4:

| Criterion | Status |
| --- | --- |
| Handoff §25 mapped and checked | **Mapped** here; **checked** when section 4 + CI green + rubric/waive filled |
| Privacy disclosure matches behavior | Docs shipped (DOM-44); confirm on smoke |
| Curated fallback still works | Playwright Nano-off + manual tick Q5 |
| No unrelated scope creep | Section 1 |

---

## 7. Results log

| Field | Value |
| --- | --- |
| Date | _fill on smoke_ |
| Chrome version | |
| Branch / commit | |
| `npm run test:ci` | |
| Manual §4 A–G | |
| Rubric / waive | |
| Sign-off | |

After you complete the pass, paste a short summary into Linear DOM-45 (or tick Done).
