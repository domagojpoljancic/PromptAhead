# Nano verification checklist (M2)

Manual smoke on supported Chrome hardware. Fill Chrome version after you run it.

**Chrome version:** _______________  
**Date:** _______________  
**Hardware / OS:** _______________

> Hardware boxes stay unchecked until you run them on a real Chrome with Prompt API / Gemini Nano. Automated CI keeps Nano forced off (`NANO_FORCE_DISABLED=1` where applicable) and asserts curated paths.

**Chrome note:** `chrome://on-device-internals` Model Status can show an empty/stuck bar even when `window.LanguageModel` is loaded and `create()` / `prompt()` work. Prefer a DevTools probe (`typeof LanguageModel`, `availability()`, short `prompt()`) over the internals UI alone.

## Setup

- [ ] Load unpacked `extension/dist/` in Chrome (Developer mode)
- [ ] Open a normal `http(s)` article page
- [ ] Confirm Prompt API / Nano is available on this profile (`chrome://on-device-internals` or equivalent)

## Onboarding (DOM-28)

- [ ] First-run overlay reaches the Nano step
- [ ] **Ready** path: “Enable on-device AI” persists `nanoPreference: enabled`
- [ ] **Download** path: user-activated download shows progress; can finish or continue basic
- [ ] **Unsupported** path: clear copy; **Continue with basic private mode** works
- [ ] Skip / basic leaves Manual curated flow fully usable

## Side panel (DOM-29)

- [ ] With Nano enabled + available: Choose shows Nano (or Nano-ranked) actions
- [ ] Loading / “Local AI is thinking…” appears while Nano runs
- [ ] Forced timeout / invalid output: calm fallback copy (“Tiny brain needed a nap…”) + curated actions usable
- [ ] **Retry local AI** recovers or falls back without a stuck panel
- [ ] Language of Nano actions follows the page language when possible

## Settings (DOM-30)

- [ ] Nano status matches live `availability()` (ready / download / unsupported)
- [ ] Force basic private mode → panel uses curated only
- [ ] Setup / download / Prefer on-device AI from Settings works
- [ ] Clear all data restores defaults (`nanoPreference: skipped`) and re-shows onboarding

## Privacy honesty

- [ ] Confirm no page content is sent to a PromptAhead backend during Nano use
- [ ] Understand Chrome may download the model from Google infrastructure; PromptAhead does not attach page content to that download

## Record results

Short note (pass/fail + anything surprising):

```text
(paste here after the hardware run)
```
