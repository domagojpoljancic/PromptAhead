# PromptAhead — Privacy Threat Model

**Status:** Proposed  
**Source of truth:** [`promptahead-product-handoff.md`](./promptahead-product-handoff.md)  
**Product posture:** Local-first Chrome extension; no PromptAhead backend; no remote analytics.

## 1. Assets to protect

| Asset | Sensitivity | Storage / processing |
| --- | --- | --- |
| Page content / excerpts | High | On-device extraction; optional on-device Nano; not retained as full pages |
| Selected text | High | Included in `PageContext` when present |
| Generated prompts | High | Latest 3 local by default; optional full local history |
| Page URL / title in history | Medium–High | Stored with history entries only; not used for preference learning |
| Aggregate preferences | Low–Medium | Category-level counts/thresholds only |
| Engagement signals | Medium | Ephemeral / aggregate; no browsing-history log |
| Developer evaluation logs | High if enabled | Local only; export is explicit and warned |
| Destination LLM choice | Low | Local settings |

## 2. Trust boundaries

```text
[ Untrusted webpage DOM / metadata ]
        │ extract (user-invoked or post-invitation)
        ▼
[ Extension content script ] ──messages──► [ Service worker ]
        │                                      │
        │                                      ▼
        │                               [ chrome.storage.local ]
        │                                      │
        └──────── PageContext ────────────────►│
                                               ▼
                                        [ Side panel UI ]
                                               │
                                    optional local Nano
                                               │
                                               ▼
                              [ User clipboard / new tab to LLM site ]
```

**Outside PromptAhead control:** Once the user pastes into ChatGPT/Claude/Gemini/Perplexity/etc., that provider’s privacy policy applies. PromptAhead must never submit prompts automatically.

## 3. Adversaries and threats

| ID | Threat | Impact | Mitigations |
| --- | --- | --- | --- |
| T1 | Malicious page prompt injection | Hijack Nano or final prompt instructions | Delimiters; “data not instructions”; structured extraction; JSON schema; validation; reject instruction-like outputs; fixture tests |
| T2 | Sensitive page exfiltration to clipboard / LLM | Leak credentials, health, financial data | Sensitive-page blocking; sober override warning; no sticky bypass for banking/payment/password/medical; never extract form values |
| T3 | Over-broad host permission abuse | Always-on page access | Smart mode optional; Manual uses `activeTab`; education before request; revoke path; minimum permissions per milestone |
| T4 | Proactive analysis without consent | Unexpected processing | Invitation before extraction/Nano; caps; snooze/exclude/pause |
| T5 | Accidental telemetry | Data leaves device via PromptAhead | No analytics SDK; no backend; avoid logging content to console; CWS disclosure matches behavior |
| T6 | Supply-chain / remote code | Compromised dependency executes remotely | Bundle all JS; MV3 CSP; dependency audit; no CDN scripts |
| T7 | Local storage exposure | Other extensions/malware on same profile | Chrome extension isolation; clear-all control; minimize retained data; no sync |
| T8 | Developer export misuse | User exports PII-laden JSON | Explicit action + warning; local-only |
| T9 | Notification social engineering | Spoofed urgency | Deterministic, low-key copy; no page-injected modals |
| T10 | Model download / capability fingerprinting | Hardware inference | Do not transmit hardware specs; use only local availability APIs |

## 4. Data flow summary

| Flow | Leaves device via PromptAhead? |
| --- | --- |
| Page → extraction → side panel | No |
| PageContext → Gemini Nano (Prompt API) | No (on-device after Chrome model download) |
| Prompt → clipboard | User-mediated local |
| Copy-and-open → provider site | Navigation only; no PromptAhead network payload |
| Settings / history / learning | Local `chrome.storage` only |
| Smart engagement tracking | Local only |

**Note:** Chrome’s first-time Nano model download is managed by the browser from Google infrastructure. PromptAhead must not send page content with that download. Document this honestly in privacy copy.

## 5. Sensitive-page policy

Auto analysis disabled for: banking/financial accounts, payments/checkout, email/messaging, detectable private docs/workspaces, login/password/security settings, medical portals, sensitive inputs (password/card/CVV/etc.), `chrome://` and restricted origins, Incognito unless separately designed later.

Manual override: blocking warning naming the reason + what will be read + explicit **Analyze this page anyway**. No “remember forever” for banking, payment, password, or medical categories.

## 6. Retention and deletion

| Data | Default retention | User controls |
| --- | --- | --- |
| Recent prompts | 3 entries | Clear history / clear all |
| Full history | Off | Enable, search, delete one, clear all |
| Learning aggregates | Until cleared | Clear learned preferences / clear all |
| Dev logs | Only if developer mode on | Clear with data wipe; export explicit |
| Per-page engagement | Ephemeral / capped flags | Snooze, exclude domain, pause |

## 7. Prompt-injection control objectives

- Source context always wrapped in explicit delimiters.
- System instructions state that source may contain adversarial text.
- Nano must return schema-constrained JSON for actions; freeform only for final portable prompt after validation rules.
- Curated path never sends page text to a model.
- Tests must show injected “ignore previous instructions” text does not appear as executable instructions in the outbound prompt.

## 8. Chrome Web Store disclosure alignment (draft obligations)

Disclose accurately:

- Local storage of prompts/settings.
- Optional access to website content (Smart mode).
- On-device AI via Chrome Prompt API when enabled.
- No sale of data; no remote PromptAhead collection.
- User-initiated navigation to third-party LLM sites.

Full draft deferred to Milestone 4 (`docs/chrome-web-store-privacy.md`).

## 9. Residual risks (accepted for MVP)

- User may paste sensitive prompts into third-party LLMs after override.
- Compact extraction may omit context the user needed (mitigated by preview + editable prompt + note field).
- Nano quality variance by device/Chrome version.
- Smart-mode host permission remains socially sensitive even when technically optional.
