# PromptAhead M0 — Technical validation spikes

Isolated Chrome MV3 extension harness for Milestone 0 spikes **S0.1–S0.7**. This package is throwaway validation code only — not the product extension under `extension/` (not created yet).

## Prerequisites

- Node.js 20+
- Chrome (or Chromium) with extension developer mode enabled

## Setup

From the repository root:

```bash
npm install
```

## Build

```bash
npm run spikes:build
```

Output lands in **`spikes/dist/`** — load this folder as an unpacked extension.

For iterative work:

```bash
npm run spikes:dev
```

Rebuilds on file changes; click **Reload** on `chrome://extensions` after each build.

## Load unpacked

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the **`spikes/dist/`** directory (full path, not the repo root)

## Using the harness

1. Click the toolbar action to open the **side panel** dashboard.
2. Each card has a **briefing** (what you are testing, why it matters, what pass looks like, when the result is invalid), then numbered steps, then **Run** / **Clear log**.
3. All seven spikes have real logic. Logs live in `chrome.storage.local` (`spikes.results.v1` plus per-spike state keys).
4. Open **Options page** from the panel header for options-realm probes (S0.1–S0.3, S0.6).
5. Prefer the ordered session below rather than clicking cards at random — some spikes invalidate others if done in the wrong order.

**Where each spike executes:** S0.1–S0.3 and S0.6 run *in the surface you clicked* (side panel or options). The service worker only self-probes for the S0.1 matrix and hosts gesture handlers for S0.4 / S0.5 / S0.7.

If a card is stuck on **Running…** (for example because the panel was closed mid-download), press **Clear log** to reset it.

## Enabling the Prompt API (Gemini Nano)

Needed before S0.1–S0.3 can report anything but `unavailable`. Device requirements are strict: roughly **22 GB free disk**, **>4 GB VRAM**, an unmetered connection, and a desktop OS (Windows 10/11, macOS 13+, Linux, ChromeOS on supported hardware).

1. Open `chrome://flags/#prompt-api-for-gemini-nano` → **Enabled**.
2. Open `chrome://flags/#optimization-guide-on-device-model` → **Enabled BypassPerfRequirement** (skips the hardware/perf gate that otherwise reports `unavailable`).
3. Relaunch Chrome.
4. Open `chrome://on-device-internals` to see model status, download progress, and the reason behind an `unavailable` verdict. The download can also be kicked off from there.
5. Confirm with `chrome://version` and record that version in the spike report.

If `availability()` still returns `unavailable`, it is a device/build verdict, not a harness bug — the spikes log the skippable failure path and curated mode stays unblocked.

## Running S0.1–S0.3 — Prompt API spikes

Shared probe logic lives in `src/shared/nano/probe.ts` and is reused by all three realms, so each context is measured the same way.

### S0.1 — context matrix

1. Open the side panel and press **Run** on the S0.1 card. This probes the side-panel realm and asks the service worker to probe its own realm.
2. Open the **Options page** and press **Run S0.1 probe here** for the third row. A document can only probe the realm it runs in, which is why this step is manual.
3. Read the matrix off the S0.1 card (or the options page) and copy it into the spike report.

Each row records the API surface (`LanguageModel` vs legacy `ai.languageModel`), `availability()` with and without `expectedInputs`/`expectedOutputs`, and — in the service worker only — whether `create()` plus a one-word `prompt()` actually work there. That create attempt only happens when the model is already resident, so S0.1 never triggers a download.

### S0.2 — availability + download

Press **Run** on the S0.2 card (or the options-page button). The click supplies the user activation `create()` needs when the model still has to download. The log records `availability()`, `params()`, every ~10% of `downloadprogress`, `create()` duration, session quota, a warm-up prompt, and session teardown. **Keep the surface open**: closing the panel aborts `create()`.

If `availability()` reports `unavailable`, the spike stops with the skippable-failure guidance instead of failing loudly.

### S0.3 — structured JSON (`responseConstraint`)

Requires a resident model — run S0.2 first. S0.3 refuses to start a download of its own.

It creates one session with a system prompt, then sends three synthetic pages (article, product, generic) through `session.prompt(text, { responseConstraint })` using a small action-list schema, cloning the session per sample so history cannot leak between them. Each prompt times out after 10 s and gets at most one repair attempt; the log reports the parse rate, schema-validation problems, and raw error shapes. If the build rejects `responseConstraint`, the spike falls back to an unconstrained JSON-only pass so the difference is measurable.

## Running S0.5 — Manual `activeTab`

**Gesture pattern used here:** `setPanelBehavior({ openPanelOnActionClick: false })`, and the service worker opens the side panel itself from `chrome.action.onClicked`. With `openPanelOnActionClick: true` Chrome opens the panel directly and `action.onClicked` never fires, which would leave no place to spend the fresh `activeTab` grant. So every granting gesture (toolbar click, context menu, `Alt+Shift+E`) runs `scripting.executeScript` in the service worker first, then hands the extracted page context to the panel via `chrome.storage.local`.

Extraction is deliberately minimal: title, URL, hostname, and the first ~500 characters of body text with all form controls excluded, so no field values are ever read.

Steps:

1. Open a normal `http(s)` page — `chrome://`, the Web Store, and other restricted pages will refuse injection for unrelated reasons.
2. Click the toolbar icon on that tab. The panel opens and the S0.5 card shows the extraction captured during the gesture.
3. Press **Run panel follow-up** on the S0.5 card. This asks the service worker to re-inject the *same* tab with no new gesture — the core question of the spike. The log records whether Chrome allows it.
4. Navigate that tab to a different page, then press **Run panel follow-up** again. Injection is expected to be refused now; the card flags the navigation it saw.
5. Repeat via the page context menu (**S0.5: extract this page on gesture**) and the `Alt+Shift+E` shortcut to confirm all three gestures grant the same access.

Notes:

- The run also probes a tab that never received a gesture. If that injection succeeds, a broad host permission is active (likely left over from S0.6) and the results are not `activeTab`-only. The card warns when `<all_urls>` is granted.
- Card status means: `pass` = Chrome behaved as documented for the current state, `fail` = surprising result that needs a product decision, `blocked` = no gesture extraction recorded yet.
- **Clear log** on the S0.5 card also clears the stored page context and grant state.

## Ordered Chrome test session

Do these in order. Each step says **what you are proving**, then **exactly what to click**.

### Before you start

1. Rebuild and reload: `npm run spikes:build` → `chrome://extensions` → **Reload** on PromptAhead Spikes.
2. Note Chrome version from `chrome://version`.
3. Open one ordinary **https://** article tab (not `chrome://`, not the Web Store). Keep a second ordinary tab open for S0.5/S0.6 control checks.
4. Confirm S0.6 banner does **not** say host access is GRANTED. If it does, press **Revoke `<all_urls>` now**.

### Optional cold-download prep (only if you want a real S0.2 download)

1. `chrome://on-device-internals` → Model Status → delete/clear the model if offered.
2. Relaunch Chrome; confirm `availability()` is `downloadable` before running S0.2.

### Block A — On-device AI (S0.1 → S0.2 → S0.3)

| # | What you are proving | Click this |
| --- | --- | --- |
| A1 | AI API exists in side panel + service worker | Open panel → **Run** on S0.1 |
| A2 | AI API exists in options page | Header **Options page** → **Run S0.1 probe here** |
| A3 | Worker can host a session (not just expose the API) | Back in panel S0.1 → **Probe worker create()** (only when model is `available`) |
| A4 | Create session, download/progress, first-prompt latency | **Run** on S0.2 — **keep the panel open** the whole time |
| A5 | Structured JSON action lists are reliable enough | **Run** on S0.3 |

### Block B — Manual page read (S0.5) — do before S0.6

| # | What you are proving | Click this |
| --- | --- | --- |
| B1 | Toolbar click can extract without broad hosts | On the **https** article tab, click the **toolbar icon** |
| B2 | Panel can (or cannot) re-read the same tab | S0.5 → **Run panel follow-up** |
| B3 | Navigation revokes the temporary grant | Navigate that tab elsewhere → **Run panel follow-up** again |
| B4 | Context menu / shortcut grant the same access | Right-click → S0.5 extract item, and/or `Alt+Shift+E` |

### Block C — Permissions, notifications, open paths

| # | What you are proving | Click this |
| --- | --- | --- |
| C1 | Optional all-sites grant + revoke without reload | **Run** on S0.6 → approve Chrome prompt → confirm end state is **revoked** |
| C2 | Options realm can also ask (may differ) | Options page → Run S0.6 once |
| C3 | Badge + notification can open the panel | **Run** on S0.7 → **close the panel** → click the notification → reopen panel |
| C4 | All three open paths work | After toolbar, context-menu open, and notification click: **Run** on S0.4 |

### After the session

Paste each card’s outcome into [`docs/technical-spikes.md`](../docs/technical-spikes.md). Prefer the card’s briefing **Pass looks like** / **Result is invalid if** lines when judging whether a run counts.

## Recording results

After running spikes manually, copy findings into [`docs/technical-spikes.md`](../docs/technical-spikes.md).

**Chrome version:** fill in from `chrome://version` (first line, e.g. `138.0.7204.0`). Record the same version for every spike table so M0 decisions are reproducible.

## Permissions (broader than M1 product)

| Permission | Purpose in spikes |
| --- | --- |
| `sidePanel` | S0.4 panel UX |
| `activeTab` | S0.5 manual extraction |
| `scripting` | S0.5 injection |
| `storage` | Spike log persistence |
| `contextMenus` | S0.4 open path + S0.5 gesture |
| `notifications` | S0.7 invite UX |
| `commands` (manifest key) | S0.5 keyboard gesture (`Alt+Shift+E`) |
| `optional_host_permissions: <all_urls>` | S0.6 grant/revoke (no persistent host permissions) |

## Layout

```text
spikes/
├── manifest.config.ts      # MV3 manifest source (@crxjs)
├── vite.config.ts
├── public/icons/
└── src/
    ├── background/         # Service worker
    ├── sidepanel/          # Spike dashboard UI + S0.1–S0.3 in the panel realm
    ├── options/            # Options page + S0.1–S0.3 in the options realm
    └── shared/
        ├── logging/        # chrome.storage log helpers
        ├── messaging/      # Typed background messages
        ├── nano/           # Prompt API facade shared by every realm
        │   ├── types.ts    # Local structural types (no ambient globals)
        │   ├── probe.ts    # detect / availability / create / prompt helpers
        │   └── matrix.ts   # Persisted S0.1 context matrix
        └── spikes/         # Spike registry, runners, and per-spike modules
            ├── document-runners.ts  # S0.1–S0.3 entry point for documents
            ├── s01-contexts.ts     # S0.1 per-realm probe
            ├── s02-availability.ts # S0.2 availability + download
            ├── s03-structured.ts   # S0.3 responseConstraint
            └── active-tab.ts       # S0.5 gesture extraction + panel follow-up
```

Remaining spikes replace their stubs in `src/shared/spikes/runner.ts`, following the split into dedicated per-spike modules.
