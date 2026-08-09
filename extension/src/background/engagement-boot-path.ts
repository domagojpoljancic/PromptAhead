/**
 * CRXJS build-time path for the engagement content script.
 * `?script` makes Vite emit a registerable loader file name
 * (https://crxjs.dev/concepts/content/).
 */

import engagementBootScript from "../content/engagement-boot.ts?script";

/** Packaged loader path for `chrome.scripting.registerContentScripts`. */
export const ENGAGEMENT_BOOT_SCRIPT_PATH: string = engagementBootScript;
