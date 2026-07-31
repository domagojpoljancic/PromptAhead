# PromptAhead — Technical spike report (M0)

**Status:** Awaiting spike runs  
**Harness:** `spikes/` MV3 extension  
**Chrome version:** _(fill from `chrome://version`, e.g. 138.0.7204.0)_

Record results here after running S0.1–S0.7 in Chrome. Spike code lives under `spikes/` only.

---

## Summary decisions (post-spike)

| Decision | Outcome |
| --- | --- |
| Nano host context (side panel vs options vs service worker) | _TBD_ |
| Manual extraction gesture pattern | _TBD_ |
| Notification surface (badge vs notification vs both) | _TBD_ |
| Blocking conflicts vs product handoff | _None yet / list here_ |

---

## S0.1 — Prompt API contexts

**Question:** Does `LanguageModel` work in side panel, options page, and service worker?

**How to run:** side panel → **Run** on the S0.1 card (probes the panel realm and asks the service worker to probe itself), then options page → **Run S0.1 probe here** for the third row. The matrix is also stored under `spikes.nano.contextMatrix.v1`.

| Context | API surface | `availability()` | `create()` + `prompt()` | Notes |
| --- | --- | --- | --- | --- |
| Side panel | _TBD_ | _TBD_ | _TBD_ (see S0.2) | |
| Options page | _TBD_ | _TBD_ | _TBD_ (see S0.2) | |
| Service worker | _TBD_ | _TBD_ | _TBD_ | |

Also record: does `availability()` with no options disagree with the `en` `expectedInputs`/`expectedOutputs` call? _TBD_

**Outcome:** _TBD_

---

## S0.2 — Availability + download

**Question:** `availability()`, user-activated `create()`, and `downloadprogress` behavior.

**How to run:** side panel → **Run** on the S0.2 card, or the options page button. Keep the surface open for the whole download.

| Check | Result | Notes |
| --- | --- | --- |
| `availability()` | _TBD_ | |
| `params()` (topK / temperature ranges) | _TBD_ | |
| User-activated `create()` | _TBD_ | duration _TBD_ |
| `downloadprogress` events (count, `loaded` scale) | _TBD_ | determinate progress possible? |
| Warm-up `prompt()` | _TBD_ | |
| Session `inputUsage` / `inputQuota` | _TBD_ | informs the ~4–6k char input cap |
| Skippable failure path | _TBD_ | |

**Outcome:** _TBD_

---

## S0.3 — Structured JSON

**Question:** `responseConstraint` schema for action list generation.

**How to run:** run S0.2 first (needs a resident model), then **Run** on the S0.3 card. Three synthetic pages (article / product / generic), 10 s timeout per prompt, one repair attempt.

| Check | Result | Notes |
| --- | --- | --- |
| `responseConstraint` accepted by this build | _TBD_ | Chrome 137+ expected |
| `session.clone()` available | _TBD_ | used to isolate samples |
| Valid JSON parse rate, first attempt | _TBD_ /3 | |
| Valid JSON parse rate, after one repair | _TBD_ /3 | |
| Schema-validation problems seen | _TBD_ | missing keys, extra keys, label length |
| Error shapes | _TBD_ | name / constructor / message |
| Latency per prompt | _TBD_ | vs the 10 s product timeout |
| Repair / fallback needs | _TBD_ | |

**Outcome:** _TBD_

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
| Extract on toolbar/action gesture | _TBD_ | |
| No persistent host permissions | _TBD_ | |
| Panel-internal re-script same tab | _TBD_ | |
| Preferred pattern | _TBD_ | |

**Outcome:** _TBD_

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

- [ ] Built harness: `npm run spikes:build`
- [ ] Loaded unpacked from `spikes/dist/`
- [ ] Chrome version recorded above
- [ ] S0.1–S0.7 run and tables filled
- [ ] Blocking conflicts escalated (if any)
