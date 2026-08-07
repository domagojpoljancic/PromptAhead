/**
 * Smart-mode engagement content-script entry (DOM-33).
 *
 * Registered at runtime via `chrome.scripting.registerContentScripts` after
 * optional host permission is granted — not always-on from the manifest.
 * Threshold fire only notifies (invite UX is DOM-34); no extraction / Nano.
 */

import { guessEngagementPageType } from "../domain/engagement/page-type-guess";
import { startEngagementTracker } from "./engagement-tracker";

const url = typeof location !== "undefined" ? location.href : "";
const pageType = guessEngagementPageType(document, url);

startEngagementTracker({
  pageType,
  url,
  onThresholdReached: (detail) => {
    // DOM-34 will route this into the invite state machine / badge.
    // Keep a quiet debug breadcrumb until then.
    console.debug("[PromptAhead] engagement threshold", detail.reason, {
      pageType: detail.pageType,
    });
  },
});
