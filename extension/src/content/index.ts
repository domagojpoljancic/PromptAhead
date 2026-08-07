/**
 * Content scripts are injected on demand via `scripting` after a user gesture
 * in Manual mode — not registered in the manifest for broad auto-injection.
 *
 * Smart-mode engagement (`engagement-tracker`) is exported for injection after
 * optional host permission (DOM-32); it is not auto-registered here.
 */
export const CONTENT_SCRIPT_STUB = "manual-only";

export {
  startEngagementTracker,
  type EngagementTrackerHandle,
  type EngagementTrackerOptions,
} from "./engagement-tracker";
