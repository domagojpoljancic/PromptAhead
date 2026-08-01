/**
 * Content scripts are injected on demand via `scripting` after a user gesture
 * in Manual mode — not registered in the manifest for broad auto-injection.
 */
export const CONTENT_SCRIPT_STUB = "manual-only";
