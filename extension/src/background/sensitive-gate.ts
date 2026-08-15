/**
 * Pre-extract sensitive gate for Manual captures (DOM-39).
 *
 * URL check first; DOM inject only when the URL alone does not block.
 * Never sticky — callers pass `force` for a one-shot override.
 */

import {
  assessDocumentSensitivityInPage,
  assessUrlSensitivity,
  type SensitiveAssessment,
} from "../domain/sensitive";
import { executeScriptInTab, isInjectableUrl } from "../shared/chrome";

const ALLOWED: SensitiveAssessment = {
  blocked: false,
  category: null,
  reason: "not_sensitive",
};

/** Stable error string when extract is refused pending override. */
export const SENSITIVE_PAGE_BLOCKED_ERROR =
  "This page looks sensitive. Confirm in the side panel to analyze it anyway.";

export async function assessTabForManualCapture(
  tabId: number,
  knownUrl?: string,
): Promise<SensitiveAssessment> {
  if (knownUrl !== undefined) {
    // chrome:// / Web Store etc. — extract explains; not a sensitive-override modal.
    if (!isInjectableUrl(knownUrl)) {
      return ALLOWED;
    }
    const fromUrl = assessUrlSensitivity(knownUrl);
    if (fromUrl.blocked) {
      return fromUrl;
    }
  }

  try {
    const fromDom = await executeScriptInTab(
      tabId,
      assessDocumentSensitivityInPage,
    );
    if (fromDom?.blocked) {
      return fromDom;
    }
  } catch {
    // Access lost / inject refused — let the real extract report ACCESS_LOST.
  }
  return ALLOWED;
}
