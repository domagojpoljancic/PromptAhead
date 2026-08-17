# M4 performance spot-check notes

Recorded for [DOM-73](https://linear.app/domagojp/issue/DOM-73) / parent [DOM-43](https://linear.app/domagojp/issue/DOM-43). Targets from [`docs/test-plan.md`](test-plan.md) §10.

## Methodology

- **Environment:** local unpacked `extension/dist/` on Chrome (same machine as day-to-day Manual smoke), not CI.
- **Curated path:** Settings suggestion engine = Basic / Nano off when measuring suggestion latency after extract.
- **Instrumentation:** wall-clock from toolbar click → Choose directions visible (DevTools Performance or status strip timing); panel first paint is qualitative (“felt instant”) unless Performance panel used.

## Spot checks (2026-08-16)

| Metric | Target | Observation |
| --- | --- | --- |
| Side panel first paint / state | ≤100 ms feel | Idle open of already-extracted Choose is snappy; no measurable jank on happy path |
| Curated actions after extraction | ≤500 ms | Curated suggest is local catalog ranking — well under 500 ms after extract returns |
| Nano useful suggestions | ~5 s / hard 10 s | Unchanged from DOM-31 hardware (~tens of seconds unconstrained); not re-baselined here — see [DOM-66](https://linear.app/domagojp/issue/DOM-66) |
| Engagement listeners | No scroll jank | No new listeners in this polish pass |

## Intentional UX dwell (not regressive jank)

- **Prompt-build min dwell (~1 s)** + fill bar ([DOM-23](https://linear.app/domagojp/issue/DOM-23)): artificial minimum so “Preparing your prompt…” is readable. Does **not** apply to curated suggest latency targets.
- **Workflow enter animation (~450 ms):** cosmetic; disabled under `prefers-reduced-motion`.

## Follow-ups

- Nano latency: Settings dropdown on DOM-66 (generate default; rank / rank-clone / hybrid opt-in). Re-baseline hardware create vs prompt in `docs/nano-verification-checklist.md` after smoke.
- Optional: add a thin DevTools mark around `suggestActions` if we want automated CI timing later (out of scope for DOM-73).
