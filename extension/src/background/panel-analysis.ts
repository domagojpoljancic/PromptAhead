/**
 * Shared Manual / post-accept analysis kickoff (DOM-34).
 *
 * Extraction starts here; the side panel then runs curated or Nano suggest.
 * Callers inside a user gesture must not await capture before `sidePanel.open`
 * (Chrome only accepts open while the gesture is still in flight).
 */

import { openSidePanel } from "../shared/chrome";
import type { ExtractionOutcome } from "./extraction";
import { captureTabContext } from "./page-context-store";

export type PanelAnalysisKickoff = {
  capture: Promise<ExtractionOutcome>;
  panel: Promise<void>;
};

/**
 * Start page extraction and open the side panel for a tab.
 * Used by Manual toolbar gestures and by Smart invite accept — never by
 * engagement threshold / badge show.
 */
export function kickOffPanelAnalysis(
  tabId: number,
  knownUrl?: string,
): PanelAnalysisKickoff {
  const capture = captureTabContext(tabId, knownUrl);
  const panel = openSidePanel(tabId);
  return { capture, panel };
}
