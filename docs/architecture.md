# PromptAhead — Architecture

**Status:** Proposed (awaiting approval)  
**Source of truth:** [`promptahead-product-handoff.md`](./promptahead-product-handoff.md)  
**Constraint:** No backend, accounts, remote analytics, API keys, cloud-model calls, remote executable code, or automatic prompt submission.

## 1. Current repository state

| Asset            | State                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Git              | `main` with initial commit (`README.md`, `.gitignore`)                     |
| Application code | None                                                                       |
| Package / build  | None                                                                       |
| Tests            | None                                                                       |
| Docs             | Handoff (`promptahead-product-handoff.md`, duplicate `promptahead-prd.md`) |

Reusable assets: the handoff contracts (`PageContext`, Nano schemas, curated actions, notification state machine). Nothing else to preserve.

## 2. Recommended stack

| Layer             | Choice                                                                                                                    | Rationale                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Language          | TypeScript (strict)                                                                                                       | Matches handoff; types for Chrome + Prompt API               |
| Extension         | Manifest V3                                                                                                               | Required                                                     |
| Build             | Vite + `@crxjs/vite-plugin` (or equivalent CRX bundler)                                                                   | Simple multi-entry MV3 builds; no React required             |
| UI                | Vanilla TS + CSS (CSS variables)                                                                                          | Side panel + options are small; avoid framework weight       |
| Unit tests        | Vitest                                                                                                                    | Fast, fixture-friendly                                       |
| HTML fixtures     | Static HTML under `tests/fixtures/`                                                                                       | Classification / extraction / injection cases                |
| Extraction helper | Custom JSON-LD/OG parsers + thin `main`/`article` heuristic today; bundled Mozilla Readability still under license review | Deterministic article body; products via metadata heuristics |
| Prompt API types  | `@types/dom-chromium-ai`                                                                                                  | Official typings                                             |
| Storage           | `chrome.storage.local` only for MVP                                                                                       | IndexedDB deferred unless full history needs it              |
| Lint / format     | ESLint + Prettier                                                                                                         | Minimal, readable TS                                         |

**Dependencies to avoid:** React/Vue unless UI complexity forces it later; WebLLM / Transformers.js; any remote CDN scripts; analytics SDKs.

## 3. Proposed folder structure

```text
PromptAhead/
├── docs/                          # Product + engineering docs
├── extension/
│   ├── manifest.config.ts         # MV3 manifest source
│   ├── public/                    # Icons, static assets
│   └── src/
│       ├── background/            # Service worker
│       ├── content/               # Content script(s)
│       ├── sidepanel/             # Primary UI
│       ├── options/               # Onboarding + settings
│       ├── shared/
│       │   ├── messaging/         # Typed message contracts
│       │   ├── storage/           # Versioned schemas + migrations
│       │   └── chrome/            # Thin wrappers (tabs, permissions)
│       └── domain/
│           ├── extraction/        # Pure page → PageContext
│           ├── classification/    # article | product | generic
│           ├── sensitive/         # Sensitive-page heuristics
│           ├── suggestions/       # SuggestionEngine + adapters
│           ├── prompts/           # Deterministic prompt builder
│           ├── destinations/      # Deep-link registry + app/web open
│           ├── engagement/        # Smart-mode thresholds (M3)
│           └── learning/          # Aggregate preference signals (M3)
├── spikes/                        # Isolated M0 prototypes (removable)
├── tests/
│   ├── unit/
│   ├── fixtures/html/
│   └── integration/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

UI must not parse pages or call `chrome.storage` directly; it talks to domain + storage facades through typed messages or injected services.

## 4. Component boundaries

### Content script

- **Owns:** engagement signals (Smart mode), conservative sensitive/page-type checks, on-demand compact extraction in the page DOM.
- **Does not own:** Nano inference, prompt composition, storage writes (except forwarding), notifications.
- **Runs:** always-on only when Smart-mode host permission is granted; otherwise injected on demand via `scripting` after an explicit user gesture.

### Service worker

- **Owns:** event coordination, permission request/revocation routing, badge/notifications, message routing, lightweight session flags (e.g. last invited tab), optional extraction kickoff on action click.
- **Does not own:** Gemini Nano inference by default (handoff + web Prompt API: not in Web Workers). Milestone 0 must re-verify extension service-worker support; product still keeps Nano in the side panel as the supported path.
- **Lifetime:** short-lived; persist only via `chrome.storage` or in-flight messages.

### Side panel

- **Owns:** primary workflow UI, suggestion orchestration, prompt editing, context inclusion controls, Nano session when available.
- **Receives:** `PageContext` (or extraction errors / sensitive warnings) via messaging.
- **Does not:** scrape arbitrary DOM itself.

### Onboarding / options page

- **Owns:** mode choice, plain-language permission education then optional host permission, Nano readiness/download (user-activated), default destination, settings, clear-data actions, developer mode.

### Extraction domain

- Pure functions over HTML/DOM snapshots where possible.
- Output: `PageContext` schemaVersion 1 (handoff §31).
- Strict caps: ~8 headings, ~6 article excerpts, ~12 specs, ~4 product excerpts; total Nano input ~4–6k chars.

### Suggestion domain

```ts
interface SuggestionEngine {
  id: "curated" | "mock-nano" | "nano";
  isAvailable(): Promise<boolean>;
  suggestActions(input: ActionGenerationInput): Promise<SuggestionResult>;
  generatePrompt(input: PromptGenerationInput): Promise<string>;
}
```

- **Curated:** deterministic templates (handoff §13).
- **Mock Nano:** deterministic fixture responses for tests/dev.
- **Nano:** Prompt API adapter with schema validation, duplicate removal, one repair, timeout, fallback.

### Prompt domain

- Deterministic composition preserving verbatim source context inside delimiters.
- Injection-resistant framing (handoff §14 / §30).
- Language follows page language unless Settings override.

### Storage layer

Versioned keys (illustrative):

| Key                      | Contents                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `settings.v1`            | Mode, destination, language override, Nano preference, history mode, pause, exclusions |
| `history.recent.v1`      | Latest three prompts                                                                   |
| `history.full.v1`        | Optional full history                                                                  |
| `learning.aggregates.v1` | Category-level thresholds / preferences (no URLs)                                      |
| `dev.logs.v1`            | Local evaluation events                                                                |
| `onboarding.v1`          | Completion flags                                                                       |

Migrations run on read/startup. “Clear everything” wipes all PromptAhead-owned keys.

## 5. Message flow

```text
┌─────────────┐  engagement / extract  ┌──────────────────┐
│ Content     │ ←────────────────────► │ Service worker   │
│ script      │                        │ (router, perms,  │
└─────────────┘                        │  notifications)  │
                                       └────────┬─────────┘
                                                │
                    PageContext / errors / cmds │
                                                ▼
                                       ┌──────────────────┐
                                       │ Side panel       │
                                       │ SuggestionEngine │
                                       │ Prompt builder   │
                                       │ Nano session*    │
                                       └────────┬─────────┘
                                                │
                                       ┌────────▼─────────┐
                                       │ chrome.storage   │
                                       └──────────────────┘

* Nano only in extension document context (side panel / options), pending M0 spike.
```

### Manual mode (Milestone 1)

1. User clicks toolbar action (or shortcut / context menu).
2. Action gesture grants temporary `activeTab`; service worker opens side panel and/or kicks off extraction for that tab.
3. Content script (injected) returns compact `PageContext`.
4. Side panel runs curated (or mock/Nano) suggestions → refine → prompt → copy/open.
5. Navigate away → `activeTab` revoked; user must invoke again.

**Known Chrome constraint (to spike):** `activeTab` is granted by action/context-menu/shortcut gestures, not by later clicks _inside_ the side panel. Design must extract (or retain host access) from the granting gesture—typically extract on action click in the service worker path, then hand `PageContext` to the panel. Do **not** silently add `<all_urls>` for Manual mode.

### Smart mode (Milestone 3)

1. Optional host permission granted after education UI.
2. Content script tracks active time / visibility / scroll / product interactions.
3. Threshold → badge + compact notification (no Nano yet).
4. User accepts → side panel opens → extraction → suggestions (Nano if available).

## 6. Permissions by milestone

| Milestone      | Permissions                                                                                               | Host permissions                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| M0 spikes      | As needed per isolated prototype                                                                          | Temporary / optional in spike only                    |
| M1 Manual core | `sidePanel`, `activeTab`, `scripting`, `storage`, `contextMenus` (optional), `alarms` (optional)          | None persistent                                       |
| M2 Nano        | Same as M1; no extra host permission                                                                      | None                                                  |
| M3 Smart       | + `notifications`, optional `tabs` if required for invitation UX; runtime `permissions.request` for hosts | Optional `<all_urls>` or equivalent via runtime grant |
| M4             | Same; no new remote powers                                                                                | Same                                                  |

Never request permissions for features not yet implemented. Bundle all JS; CSP must block remote code.

## 7. API volatility notes (pre-spike)

| API                          | Handoff assumption                         | Current docs signal (verify in M0)                                                                       |
| ---------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Prompt API / `LanguageModel` | Not in Web Workers; use side panel         | Official web docs still say not in Web Workers; some extension guidance claims SW support—**spike both** |
| Structured output            | JSON schema via `responseConstraint`       | Documented for Prompt API                                                                                |
| Side Panel                   | Open from toolbar / notification / gesture | `setPanelBehavior`, `sidePanel.open` require user gesture                                                |
| `activeTab` + panel          | Manual extraction without broad hosts      | Panel-internal clicks do not grant `activeTab`; action-click grant persists until navigation—**spike**   |
| Optional hosts               | Runtime request + revoke                   | `permissions.request` / `permissions.remove`                                                             |
| Notifications                | Badge + compact invite; no page modal      | Prefer `chrome.notifications` + action badge                                                             |

## 8. Security boundaries

- Page HTML/text is untrusted input.
- Extraction strips scripts/hidden noise; never includes form field values.
- Nano/system prompts treat `<SOURCE_DATA>` / `<source>` as data only.
- Sensitive pages block auto analysis; manual override is explicit and non-sticky for banking/payment/password/medical.
- No production console logging of page content or prompts.
