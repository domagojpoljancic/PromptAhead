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
2. Each spike card has **Run** and **Clear log**. S0.1–S0.3 and S0.5 have real logic; S0.4, S0.6, and S0.7 are still stubs.
3. Logs persist in `chrome.storage.local` under `spikes.results.v1`; S0.5 page context lives under `spikes.s05.activeTab.v1` and the S0.1 context matrix under `spikes.nano.contextMatrix.v1`.
4. Open **Options page** from the panel header to run the Prompt API spikes in the options realm.
5. Background service worker routes stub spike runs, owns the gesture handlers, sets up the context menu, and probes the Prompt API in its own realm on request.

**Where each spike executes:** S0.1–S0.3 run *in the surface you clicked* (side panel or options page), because the Prompt API has to be exercised in the realm under test and `create()` needs the click's user activation. The service worker refuses to run them on a caller's behalf; it only probes itself for the S0.1 matrix. Everything else runs in the service worker.

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
