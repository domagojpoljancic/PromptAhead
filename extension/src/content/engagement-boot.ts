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

const BOOT_FLAG = "__promptaheadEngagementBooted";

declare global {
  interface Window {
    [BOOT_FLAG]?: boolean;
  }
}

function bootEngagement(): void {
  if (typeof window === "undefined" || window[BOOT_FLAG]) {
    return;
  }
  window[BOOT_FLAG] = true;

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
}

bootEngagement();
