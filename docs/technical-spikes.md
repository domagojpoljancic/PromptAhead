# PromptAhead — Technical spike report (M0)

**Status:** S0.1–S0.3 run (pass). S0.5 blocked on operator error, retest pending. S0.4 / S0.6 / S0.7 not implemented.  
**Harness:** `spikes/` MV3 extension  
**Chrome version:** 150.0.0.0 (run 2026-08-01, macOS)

Record results here after running S0.1–S0.7 in Chrome. Spike code lives under `spikes/` only.

---

## Summary decisions (post-spike)

| Decision | Outcome |
| --- | --- |
| Nano host context (side panel vs options vs service worker) | **Side panel** — confirmed end-to-end (`create()` + `prompt()` + `responseConstraint`). `LanguageModel` is also exposed in the options page and the service worker, but session creation was never exercised in the worker, so the handoff's side-panel assumption stands unchanged. |
| Manual extraction gesture pattern | _TBD — S0.5 retest required_ |
| Notification surface (badge vs notification vs both) | _TBD — S0.7 not implemented_ |
| Blocking conflicts vs product handoff | None blocking. Two adjustments to escalate: the 10 s prompt timeout is too tight for a cold session (see S0.2), and `downloadprogress` fires even when nothing downloads (see S0.2). |

---

## S0.1 — Prompt API contexts

**Question:** Does `LanguageModel` work in side panel, options page, and service worker?

**How to run:** side panel → **Run** on the S0.1 card (probes the panel realm and asks the service worker to probe itself), then options page → **Run S0.1 probe here** for the third row. The matrix is also stored under `spikes.nano.contextMatrix.v1`.

| Context | API surface | `availability()` | `create()` + `prompt()` | Notes |
| --- | --- | --- | --- | --- |
| Side panel | `LanguageModel` | `downloading` at 07:48:57, `available` by 07:50:51 | **Yes** — proven by S0.2 and S0.3 in this realm | `availability()` took 2838 ms while the model was still downloading, then 1 ms once resident |
| Options page | `LanguageModel` | `available` (1 ms) | Not attempted | Probed at 07:49:19, after the download completed |
| Service worker | `LanguageModel` | `downloading` (1 ms) | **Not attempted** — harness skips `create()` unless already resident | Global is present in the worker; session creation remains unverified there |

`Summarizer`, `Translator`, and `LanguageDetector` are also exposed in all three realms.

Also record: does `availability()` with no options disagree with the `en` `expectedInputs`/`expectedOutputs` call? **No** — the two calls matched in every realm on every run.

**Outcome:** Pass. `LanguageModel` is reachable from all three extension realms, so the "not in Web Workers" note in the architecture doc does not apply to the MV3 extension service worker — at least for detection and `availability()`.

Two caveats before reading anything more into this matrix:

1. `availability()` reports **global model state, not per-realm capability**. The side panel and worker read `downloading` only because they were probed before the download finished; the options page read `available` 20 seconds later. This is not a realm difference.
2. **Service-worker `create()` is untested.** The harness deliberately skips it unless the model is already resident, and it was not. Nothing here contradicts the product decision to host Nano in the side panel, but nothing confirms the worker as a fallback either. A follow-up worker `create()` probe is cheap now that the model is resident and would close the gap.

---

## S0.2 — Availability + download

**Question:** `availability()`, user-activated `create()`, and `downloadprogress` behavior.

**How to run:** side panel → **Run** on the S0.2 card, or the options page button. Keep the surface open for the whole download.

| Check | Result | Notes |
| --- | --- | --- |
| `availability()` | `available` (1 ms) | Model already resident by the time S0.2 ran |
| `params()` (topK / temperature ranges) | `defaultTopK=3`, `maxTopK=128`, `defaultTemperature=1`, `maxTemperature=2` | |
| User-activated `create()` | Success | **1 ms** with the model resident; user activation was `isActive=true, hasBeenActive=true` at click time |
| `downloadprogress` events (count, `loaded` scale) | **2 events, last `loaded=1`** | `loaded` is a 0–1 fraction. Events fired even though nothing was downloaded — see below |
| Warm-up `prompt()` | Success — **6459 ms** for a trivial prompt | Cold-session first-token cost, not input size |
| Session `inputUsage` / `inputQuota` | 0 → 26 of **9216** | Quota is in tokens. A 4–6k char page context is roughly 1–1.5k tokens, so the planned cap fits comfortably |
| Skippable failure path | **Not exercised** | The model was available, so the `unavailable` branch never ran. Still unverified |

**Outcome:** Pass, with two findings that change product assumptions.

**`downloadprogress` is not a reliable "is downloading" signal.** The monitor fired twice and jumped straight to `loaded=1` on a session that required no download at all. Onboarding must decide whether to show a progress UI from the `availability()` value (`downloadable` / `downloading`) and treat progress events purely as a bar-filler. Promising a determinate progress bar is not yet safe — a real cold download has not been observed, so we do not know the event cadence when bytes actually move.

**The 10 s prompt timeout is too tight for the first call.** A warm-up prompt of a few words took 6.5 s on a freshly created session, and that was with no page context attached. Constrained prompts on a warm session then ran in ~3 s (S0.3). The first real user prompt would pay the cold cost plus a 4–6k char context, which puts it uncomfortably close to 10 s. Two mitigations worth deciding between: warm the session when the panel opens (before the user picks an action), or use a longer budget for the first call and 10 s thereafter.

---

## S0.3 — Structured JSON

**Question:** `responseConstraint` schema for action list generation.

**How to run:** run S0.2 first (needs a resident model), then **Run** on the S0.3 card. Three synthetic pages (article / product / generic), 10 s timeout per prompt, one repair attempt.

| Check | Result | Notes |
| --- | --- | --- |
| `responseConstraint` accepted by this build | **Yes** | No fallback to the unconstrained JSON-only pass was needed |
| `session.clone()` available | **Yes** | Each sample ran on a fresh clone, so the parse rate is not inflated by conversation history |
| Valid JSON parse rate, first attempt | **3 / 3** | article, product, generic |
| Valid JSON parse rate, after one repair | **3 / 3** | 0 repair attempts used |
| Schema-validation problems seen | **None** | Every response had 4 well-formed actions |
| Error shapes | **None observed** | The error-shape catalogue is still empty; failures were never triggered |
| Latency per prompt | **2847 / 3190 / 3344 ms** | Warm session. `create()` with a system prompt took 571 ms; base session `inputUsage=89` |
| Repair / fallback needs | Not needed in this sample | Sample size is 3 — keep repair + validation in the product |

Action labels produced were on-topic and usefully specific, e.g. "What's the height range?", "What is the warranty?", "How long is assembly?" for the product sample.

**Outcome:** Pass. Structured output is reliable enough to build on: `responseConstraint` held the schema on every sample with zero repairs, and warm latency of ~3 s per prompt sits inside the 10 s budget.

Do not read this as licence to drop validation. Three synthetic samples on clean input prove the mechanism works, not that it is robust — the samples were short, English, and free of adversarial content, and the error-shape column is empty precisely because nothing failed. Schema validation, duplicate removal, and the one-repair path should still ship, and the adversarial cases belong in the M4 injection fixtures.

---

## S0.4 — Side Panel open paths

**Question:** Open from toolbar, notification click, and context menu.

| Path | Works? | Notes |
| --- | --- | --- |
| Toolbar action | _TBD_ | |
| Notification click | _TBD_ | |
| Context menu | _TBD_ | |

**Outcome:** _TBD_

---

## S0.5 — Manual `activeTab`

**Question:** Extract on action click without host_permissions; does grant survive for panel-driven follow-up scripting on the same tab?

| Check | Result | Notes |
| --- | --- | --- |
| Extract on toolbar/action gesture | **Not yet valid** | The only gesture recorded fired on a `chrome://` tab: `Gesture extraction failed: Cannot access a chrome:// URL` |
| No persistent host permissions | Confirmed in manifest | `optional_host_permissions: ["<all_urls>"]` only, ungranted during the run |
| Panel-internal re-script same tab | **Not reached** | Follow-up refused for lack of a recorded gesture, not by Chrome's permission model |
| Preferred pattern | _TBD_ | |

**Outcome:** Blocked — retest required. Status `blocked`, not `fail`.

This is operator error rather than a finding. Chrome refuses `scripting.executeScript` on `chrome://` URLs regardless of `activeTab`, so the gesture never produced a page context and the panel follow-up had nothing to re-inject. The `action.onClicked` handler did fire, which at least confirms `openPanelOnActionClick: false` is wired correctly.

**Retest:** click the toolbar icon on an ordinary `https://` article tab, confirm the S0.5 card shows a title/URL/excerpt, then press **Run panel follow-up**, then navigate that tab away and press it again. Until that runs, blocking question 1 in the implementation plan (`activeTab`-only Manual vs optional hosts for "enhanced Manual") stays open.

---

## S0.6 — Optional hosts

**Question:** `permissions.request` / `remove` / `contains` grant and revoke without reload surprises.

| Check | Result | Notes |
| --- | --- | --- |
| `permissions.request` grant | _TBD_ | |
| `permissions.contains` after grant | _TBD_ | |
| `permissions.remove` revoke | _TBD_ | |
| Extension reload required? | _TBD_ | |

**Outcome:** _TBD_

---

## S0.7 — Notifications

**Question:** Badge + compact notification can open panel without page injection.

| Check | Result | Notes |
| --- | --- | --- |
| Action badge | _TBD_ | |
| `chrome.notifications` create | _TBD_ | |
| Notification click opens side panel | _TBD_ | |
| Least-intrusive UX choice | _TBD_ | |

**Outcome:** _TBD_

---

## Manual checklist

- [x] Built harness: `npm run spikes:build`
- [x] Loaded unpacked from `spikes/dist/`
- [x] Chrome version recorded above (150.0.0.0)
- [ ] S0.1–S0.7 run and tables filled — S0.1–S0.3 done; S0.5 needs a retest on an `https://` page; S0.4 / S0.6 / S0.7 not implemented
- [ ] Blocking conflicts escalated (if any) — none blocking; the cold-start timeout and `downloadprogress` findings need a product call

## Open follow-ups

- Retest S0.5 on an ordinary `https://` page (blocks the Manual extraction decision).
- Probe `create()` in the service worker now that the model is resident, to close the S0.1 gap.
- Implement S0.4, S0.6, S0.7.
- Observe a genuine cold model download to learn the real `downloadprogress` cadence.
- Decide the cold-start strategy: warm the session on panel open, or a longer first-call timeout.
