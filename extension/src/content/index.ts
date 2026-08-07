/**
 * Content scripts are injected on demand via `scripting` after a user gesture
 * in Manual mode — not registered in the manifest for broad auto-injection.
 *
 * Smart-mode engagement boots from `engagement-boot.ts`, registered at runtime
 * after optional host grant (`syncEngagementContentScripts` in the SW).
 */
export const CONTENT_SCRIPT_STUB = "manual-only";

export {
  startEngagementTracker,
  type EngagementTrackerHandle,
  type EngagementTrackerOptions,
} from "./engagement-tracker";
