# Nano verification checklist (M2)

Manual smoke on supported Chrome hardware. Keep in sync with Linear DOM-31.

**Chrome version:** Version 150.0.7871.124 (Official Build) (arm64)  
**Date:** 2026-08-06  
**Hardware / OS:** Apple Silicon (arm64) / macOS

> Tick boxes only after a real Chrome run with Prompt API / Gemini Nano (or explicitly record Unsupported + basic private mode). Automated CI keeps Nano forced off (`NANO_FORCE_DISABLED=1` where applicable) and Playwright asserts Settings force-basic → curated extract → prompt → copy. This checklist (DOM-31) is still the only place for real-hardware Nano smoke.

**Chrome note:** `chrome://on-device-internals` Model Status can show an empty/stuck bar even when `window.LanguageModel` is loaded and `create()` / `prompt()` work. Prefer a DevTools probe (`typeof LanguageModel`, `availability()`, short `prompt()`) over the internals UI alone.

## Setup

- [x] Load unpacked `extension/dist/` in Chrome (Developer mode)
- [x] Open a normal `http(s)` article page
- [x] Confirm Prompt API / Nano is available on this profile (`chrome://on-device-internals` or equivalent)

## Onboarding (DOM-28)

- [x] First-run overlay reaches the Nano step
- [x] **Ready** path: “Enable on-device AI” persists `nanoPreference: enabled`
- [ ] **Download** path: **WAIVED** — Chrome `downloadprogress` / zombie uninstall flaky; could not complete cleanly. Do not treat as pass.
- [x] **Unsupported** path: clear copy; **Continue with basic private mode** works
- [x] Skip / basic leaves Manual curated flow fully usable

## Side panel (DOM-29)

- [x] With Nano enabled + available: Choose shows Nano (or Nano-ranked) actions
- [x] Loading / “Local AI is thinking…” appears while Nano runs
- [x] Forced timeout / invalid output: calm fallback copy (“Tiny brain needed a nap…”) + curated actions usable
- [x] **Retry local AI** recovers or falls back without a stuck panel
- [x] Language of Nano actions follows the page language when possible

## Settings (DOM-30)

- [x] Nano status matches live `availability()` (ready / download / unsupported)
- [x] Force basic private mode → panel uses curated only
- [x] Setup / download / Prefer on-device AI from Settings works
- [x] Clear all data restores defaults (`nanoPreference: skipped`) and re-shows onboarding

## Privacy honesty

- [x] Confirm no page content is sent to a PromptAhead backend during Nano use
- [x] Understand Chrome may download the model from Google infrastructure; PromptAhead does not attach page content to that download

## Record results

```text
PASS (with Download waived)
Chrome: Version 150.0.7871.124 (Official Build) (arm64)
Nano: ok · ~61s on unconstrained prompt path (preferred over constrained)
Download path: WAIVED (downloadprogress / zombie uninstall flaky)
Automation mapping: DOM-49 done; DOM-50/51 later
```
