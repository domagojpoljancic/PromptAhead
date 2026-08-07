/**
 * Smart-mode engagement content-script entry (DOM-33 / DOM-34).
 *
 * Registered at runtime via `chrome.scripting.registerContentScripts` after
 * optional host permission is granted — not always-on from the manifest.
 * Threshold fire notifies the SW invite machine (badge-first); no extraction / Nano.
 */

import { guessEngagementPageType } from "../domain/engagement/page-type-guess";
import { sendToBackground } from "../shared/messaging";
import { startEngagementTracker } from "./engagement-tracker";

const url = typeof location !== "undefined" ? location.href : "";
const pageType = guessEngagementPageType(document, url);

startEngagementTracker({
  pageType,
  url,
  onThresholdReached: (detail) => {
    void sendToBackground({
      type: "ENGAGEMENT_THRESHOLD",
      pageType: detail.pageType,
      url: detail.url,
      reason: detail.reason,
    });
  },
});
