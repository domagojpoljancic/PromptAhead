# Chrome Web Store — privacy disclosure (PromptAhead)

**Status:** Draft for CWS submission dry run (DOM-44)  
**Aligns with:** [`privacy-threat-model.md`](./privacy-threat-model.md), shipped MV3 manifest, README product claims  
**Audience:** Chrome Web Store privacy practices questionnaire + listing privacy text

Use this as the source of truth when filling the Developer Dashboard **Privacy practices** form. Do not claim capabilities or data uses that are not in the current build.

## One-line product privacy claim

PromptAhead is a **local-first** Chrome extension: it helps you build editable prompts from the page you are on. **There is no PromptAhead backend, account, or analytics.** Optional on-device Gemini Nano (Chrome Prompt API) runs on the device; page content is not sent to PromptAhead servers.

## Single purpose

Help the user turn the current page (or selection) into a portable prompt for a destination LLM of their choice (ChatGPT, Claude, Gemini, Perplexity, or copy-only), with Manual mode by default and optional Smart invites.

## Permissions (manifest)

| Permission | Why PromptAhead needs it |
| --- | --- |
| `sidePanel` | Primary UI for directions → refine → review → prompt |
| `activeTab` | Manual mode: temporary access to the active tab after the user invokes the extension (toolbar / context menu / shortcut) |
| `scripting` | Inject extraction / engagement scripts when permitted |
| `storage` | Local settings, onboarding flags, recent prompts, Smart caps / pause / exclusions |
| `contextMenus` | “PromptAhead” entry on the page context menu |
| **Optional** `optional_host_permissions: <all_urls>` | **Smart mode only** — requested at runtime after education; revocable in Settings. **Not** listed as required `host_permissions`. Manual mode does not need this. |

**Not requested:** `tabs` (broad), `webRequest`, `cookies`, `history`, `identity`, remote code / CDN scripts, `notifications` (badge-first Smart invites; OS notifications deferred).

## Data collection (CWS categories)

Answer the store form to match this table.

| Category | Collected by PromptAhead? | Notes |
| --- | --- | --- |
| Personally identifiable information | **No** (as a product backend) | No accounts. Local history may store page title/URL/prompt text the user generated — stays on device in `chrome.storage.local` |
| Health / financial / authentication info | **Not collected remotely** | Sensitive pages are blocked / require an explicit Manual override; form values are not scraped for prompts |
| Personal communications | **No remote** | Email/messaging surfaces are treated as sensitive for proactive Smart; Manual override is explicit |
| Location | **No** | |
| Web history | **No browsing-history log** | Smart engagement is ephemeral / aggregate (caps, snooze, domain exclude). Optional recent prompts store title/URL **only** for history entries the user created |
| User activity | **Local only** | Engagement signals for Smart invites; no PromptAhead telemetry |
| Website content | **Processed on device** | Compact extraction into `PageContext` for suggestions/prompts. Optional Nano ranking stays on-device via Chrome’s Prompt API |

### Certification statements (typical CWS wording)

- **Not sold:** PromptAhead does not sell user data.
- **Not used for unrelated purposes:** Data processed locally is only for building prompts and optional Smart invites the user enabled.
- **Not used for creditworthiness:** N/A / not used.
- **Not transferred for purposes unrelated to the single purpose:** No PromptAhead cloud transfer. User-initiated open/copy to a third-party LLM site is under that provider’s policy.

## On-device AI (Gemini Nano / Prompt API)

- Optional. User can stay on curated / basic private mode.
- Inference for PromptAhead suggestion ranking runs **on the device** through Chrome’s Prompt API.
- Chrome may perform a **browser-managed** model download from Google infrastructure when the user starts setup. PromptAhead must **not** attach page content to that download.
- After the model is local, page context used for ranking does not leave the device via PromptAhead.

## What leaves the device

| Action | Leaves via PromptAhead? |
| --- | --- |
| Extract → panel → curated suggestions | No |
| Nano suggest / prompt build | No (on-device Prompt API) |
| Copy to clipboard | Local; user-mediated |
| Open in ChatGPT / Claude / … | Navigation / deep link or clipboard; **no auto-submit**; provider policy applies after paste |
| Settings / history / Smart caps | `chrome.storage.local` only |

## User controls

- Manual vs Smart; Smart host grant / revoke in Settings
- Global pause for proactive Smart invites; domain exclude / snooze (as shipped)
- Nano preference: enabled / basic / skipped; force basic in Settings
- Clear recent history / clear all PromptAhead data
- Sensitive-page Manual override is one-shot confirm (no forever bypass for high-risk categories)

## Listing privacy blurb (short)

Suggested listing text (edit for tone; keep facts):

> PromptAhead works on your device. It reads the page only when you ask (Manual) or after you opt into Smart website access. Optional on-device AI uses Chrome’s Gemini Nano — page content is not sent to PromptAhead servers. You copy or open prompts yourself; nothing is auto-submitted to ChatGPT or other LLMs. Clear all local data anytime in Settings.

## Cross-checks before submit

- [ ] Manifest permissions match this doc (`extension/manifest.config.ts`)
- [ ] README / threat model still say no backend / no analytics
- [ ] Smart `<all_urls>` remains **optional**, not required
- [ ] Screenshots and listing do not imply cloud AI by PromptAhead
- [ ] [`release-checklist.md`](./release-checklist.md) privacy row ticked
