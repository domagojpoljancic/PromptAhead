# PromptAhead — Technical spike report (M0)

**Status:** M0 Chrome runs complete for this machine (2026-08-01). Gaps left: true cold Nano download; notification→panel (macOS suppressed); `unavailable` skip path.  
**Harness:** `spikes/` MV3 extension  
**Chrome version:** 150.0.0.0 (runs 2026-08-01, macOS)

Record results here after running S0.1–S0.7 in Chrome. Spike code lives under `spikes/` only.

---

## Summary decisions (post-spike)

| Decision                                                    | Outcome                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nano host context (side panel vs options vs service worker) | **Prefer side panel for product Nano** (UI, user activation, download progress). **All three realms work:** options exposes the API; service worker proven for `create()` + `prompt()`. Worker is a viable fallback for background jobs, not the primary UX surface. |
| Manual extraction gesture pattern                           | **Locked:** extract on toolbar/context-menu/shortcut; panel may re-fetch same tab until navigation/close; then user must invoke again. `activeTab`-only — no optional hosts for Manual. Confirmed 10:31 (follow-up refused after navigate to 24sata.hr).             |
| Notification surface (badge vs notification vs both)        | **Provisional: badge-first.** Badge works; system notification create succeeds but macOS can suppress the banner while reporting `granted`. Do not rely on notification-only invites. Notification→panel click still unverified here.                                |
| Blocking conflicts vs product handoff                       | None blocking. Escalate: cold-session timeout and `downloadprogress` reliability (see S0.2 from morning run); confirm with a true cold download if the model was wiped.                                                                                              |

---

## S0.1 — Prompt API contexts

**Question:** Does `LanguageModel` work in side panel, options page, and service worker?

**How to run:** side panel → **Run** on the S0.1 card (probes the panel realm and asks the service worker to probe itself), then options page → **Run S0.1 probe here** for the third row. The matrix is also stored under `spikes.nano.contextMatrix.v1`.

| Context        | API surface     | `availability()`                                           | `create()` + `prompt()`                                       | Notes                                                                |
| -------------- | --------------- | ---------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Side panel     | `LanguageModel` | `available` (1 ms) at 10:20:01                             | Proven earlier via S0.2/S0.3; not re-attempted in S0.1        |                                                                      |
| Options page   | `LanguageModel` | `downloading` at 10:19:31 → `available` (1 ms) at 10:20:11 | Not attempted in S0.1                                         | Timing difference is global model state, not realm capability        |
| Service worker | `LanguageModel` | `available` (0 ms)                                         | **Yes** — `create()` 5 ms; `prompt()` → `"Ready."` in 4461 ms | UserActivation API unavailable in this realm; create still succeeded |

`Summarizer`, `Translator`, and `LanguageDetector` are also exposed in all three realms.

Also record: does `availability()` with no options disagree with the `en` `expectedInputs`/`expectedOutputs` call? **No** — matched in every realm.

**Outcome:** Pass (re-run 10:20). Closes the earlier gap: the service worker can host a full session, not only expose the API. Product still prefers the **side panel** as the Nano UX host (progress UI, click activation, user-visible errors); the worker is confirmed as a technical option for background work.

Earlier morning caveat that SW `create()` was untested is **superseded** by this run.

---

## S0.2 — Availability + download

**Question:** `availability()`, user-activated `create()`, and `downloadprogress` behavior.

**How to run:** side panel → **Run** on the S0.2 card, or the options page button. Keep the surface open for the whole download.

| Check                                             | Result                                                                     | Notes                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `availability()`                                  | `available` (9 ms) at 10:22:28                                             | Model already resident after wipe+restore; **not a cold download**     |
| `params()` (topK / temperature ranges)            | `defaultTopK=3`, `maxTopK=128`, `defaultTemperature=1`, `maxTemperature=2` | Same as morning run                                                    |
| User-activated `create()`                         | Success                                                                    | **1 ms** with model resident; user activation `isActive=true`          |
| `downloadprogress` events (count, `loaded` scale) | **2 events: 0% → 100%** (`loaded` 0→1, `total=1`)                          | Fires even when nothing downloads — confirmed again                    |
| Warm-up `prompt()`                                | Success — **5737 ms**                                                      | Cold-session first call; morning was 6459 ms — same order of magnitude |
| Session `inputUsage` / `inputQuota`               | 0 → 26 of **9216**                                                         | Planned 4–6k char page context still fits                              |
| Skippable failure path                            | **Not exercised**                                                          | Still need an `unavailable` device/build to prove the skip path        |

**Outcome:** Pass (re-run 10:22). Reinforces morning findings.

**Still missing for a complete S0.2:** a genuine cold download (`availability()` starts as `downloadable`, progress events over real time). Wipe alone is not enough if Chrome restores the model before you click Run — delete, confirm `downloadable` in DevTools, then Run S0.2 immediately.

**Product calls unchanged:** do not treat `downloadprogress` as proof of download; drive onboarding UI off `availability()`; first-prompt budget must allow ~6 s + page context (10 s is tight).

---

## S0.3 — Structured JSON

**Question:** `responseConstraint` schema for action list generation.

**How to run:** run S0.2 first (needs a resident model), then **Run** on the S0.3 card. Three synthetic pages (article / product / generic), 10 s timeout per prompt, one repair attempt.

| Check                                       | Result                         | Notes                                                                                                  |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `responseConstraint` accepted by this build | **Yes**                        | Re-confirmed 10:23                                                                                     |
| `session.clone()` available                 | **Yes**                        |                                                                                                        |
| Valid JSON parse rate, first attempt        | **3 / 3**                      | article, product, generic                                                                              |
| Valid JSON parse rate, after one repair     | **3 / 3**                      | 0 repairs used                                                                                         |
| Schema-validation problems seen             | **None**                       |                                                                                                        |
| Error shapes                                | **None observed**              |                                                                                                        |
| Latency per prompt                          | **3348 / 3224 / 2878 ms** warm | `create()` with system prompt took **5791 ms** this run (morning was 571 ms) — cold create cost varies |
| Repair / fallback needs                     | Not needed in this sample      | Keep validation + repair in product                                                                    |

**Outcome:** Pass (re-run 10:23). Same as morning: structured output reliable on clean synthetic samples; do not drop validation/repair for real pages.

---

## S0.4 — Side Panel open paths

**Question:** Open from toolbar, notification click, and context menu.

| Path               | Works?         | Notes                                                                                                                                                           |
| ------------------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Toolbar action     | **Pass**       | Explicit `sidePanel.open({tabId})` from `action.onClicked` (because `openPanelOnActionClick: false` for S0.5). Confirmed live panel via context — e.g. 10:41:42 |
| Notification click | **Unverified** | Blocked by macOS suppressing banners (see S0.7). Not a Chrome `sidePanel.open` failure                                                                          |
| Context menu       | **Pass**       | "Open PromptAhead Spikes panel" — confirmed live panel, e.g. 10:41:57                                                                                           |

`getPanelBehavior()` = `{"openPanelOnActionClick":false}` as intended.

**Outcome:** **Pass with known gap.** Toolbar and context menu are solid Manual entry points. Notification→panel remains unverified on this machine; treat as dependent on S0.7 OS delivery, not as a broken open API.

---

## S0.5 — Manual `activeTab`

**Question:** Extract on action click without host_permissions; does grant survive for panel-driven follow-up scripting on the same tab?

| Check                             | Result                                                         | Notes                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extract on toolbar/action gesture | **Pass**                                                       | Zalando product page (and earlier LinkedIn): title/URL/~500-char excerpt in 1–3 ms. `chrome://` correctly refused.                                        |
| No persistent host permissions    | **Pass**                                                       | Control inject into never-granted tab refused (`Extension manifest must request permission…`). Confirms temporary `activeTab`, not leftover `<all_urls>`. |
| Panel-internal re-script same tab | **Allowed**                                                    | Multiple follow-ups succeeded with no new gesture on tab `1239998703` after action-click grant.                                                           |
| Preferred pattern                 | **Extract on gesture + allow panel re-fetch until navigation** | First capture must still come from toolbar / context menu / shortcut.                                                                                     |
| Grant revoked after navigation    | **Pass**                                                       | Tab navigated to `https://www.24sata.hr/` at 10:30:59; follow-up at 10:31:40 **refused** (`Extension manifest must request permission…`).                 |

**Outcome:** **Pass.** Manual mode stays `activeTab`-only.

**Locked pattern:** extract on toolbar / context-menu / shortcut gesture → panel may re-fetch the **same tab** until that tab navigates or closes → then the user must invoke again. No optional host permission required for Manual.

---

## S0.6 — Optional hosts

**Question:** `permissions.request` / `remove` / `contains` grant and revoke without reload surprises.

| Check                              | Result   | Notes                                                                     |
| ---------------------------------- | -------- | ------------------------------------------------------------------------- |
| `permissions.request` grant        | **Pass** | Returned `true` in 5468 ms; prompt almost certainly shown                 |
| `permissions.contains` after grant | **true** |                                                                           |
| Grant usable without reload        | **Pass** | Never-granted tab became injectable immediately; `tabs.query` exposed URL |
| `permissions.remove` revoke        | **Pass** | Returned `true`; `contains` → `false`                                     |
| Access gone after revoke           | **Pass** | Injection refused again; URL hidden again                                 |
| `onAdded` / `onRemoved`            | **Pass** | Fired in side panel and service worker                                    |
| Left revoked at end                | **Yes**  | S0.5 remains valid                                                        |

**Outcome:** **Pass** (10:32, side panel). Optional `<all_urls>` grant/revoke works without reload — Smart mode can educate → request → revoke cleanly.

---

## S0.7 — Notifications

**Question:** Badge + compact notification can open panel without page injection.

| Check                               | Result                                 | Notes                                                                                |
| ----------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------ |
| Action badge                        | **Pass**                               | Set and read back `text="1"`, blue background; visible on toolbar                    |
| `chrome.notifications` create       | **Pass (API)**                         | `create()` ok, `getPermissionLevel()=granted`, still listed in `getAll()` after 1.5s |
| Notification click opens side panel | **Unverified**                         | No banner on this Mac — OS suppressed delivery                                       |
| Least-intrusive UX choice           | **Badge-first; notification optional** | Do not depend on system notification alone for Smart invites                         |
| Page untouched                      | **Pass**                               | No content script / no host permission needed for invite surface                     |

**Outcome:** **Blocked** (10:40) — not a Chrome API failure. Badge invitation path is proven. Notification click→panel remains unverified on this machine until macOS allows Chrome banners.

**Product decision (provisional):** Smart mode should use the **action badge** as the reliable invite; treat `chrome.notifications` as a nicety that may never appear on some Macs. Education copy should not promise a visible banner.

---

## Manual checklist

- [x] Built harness: `npm run spikes:build`
- [x] Loaded unpacked from `spikes/dist/`
- [x] Chrome version recorded above (150.0.0.0)
- [x] S0.1–S0.7 run and tables filled (S0.7 notification click OS-blocked; S0.4 notification path accordingly unverified)
- [x] Blocking conflicts escalated — none blocking ship of M1; open product calls listed below

## Open follow-ups

- Observe a genuine cold model download (`downloadable` → progress over time) if onboarding must promise a determinate bar.
- Prove `unavailable` skippable-failure path on unsupported hardware/build.
- Optional: retest notification→panel on a Mac with Chrome banners enabled.
- Decide cold-start strategy: warm session on panel open vs longer first-call timeout (~6s+ observed).
- M0 → M1: Manual core can proceed with locked `activeTab` pattern and side-panel Nano host.
