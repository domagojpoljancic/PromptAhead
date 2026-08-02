/**
 * Per-tab memory of the last extraction.
 *
 * The service worker can be torn down at any time, so this is a best-effort
 * convenience — never a source of truth. Entries are dropped as soon as the tab
 * navigates or closes, which is also the moment Chrome revokes `activeTab`.
 */

import type { PageContext } from "../domain/extraction";
import { broadcastBackgroundEvent } from "../shared/messaging";
import { extractPageContextForTab, type ExtractionOutcome } from "./extraction";

export type LatestPageContext = {
  pageContext: PageContext | null;
  error?: string;
};

const latestByTab = new Map<number, LatestPageContext>();
/**
 * The panel usually asks for context before the gesture's extraction has
 * finished, so readers await the in-flight run instead of seeing "none yet".
 */
const inFlightByTab = new Map<number, Promise<ExtractionOutcome>>();
/** Identity of the newest run per tab; a superseded run must not write. */
const currentRunByTab = new Map<number, object>();

export function rememberPageContext(tabId: number, pageContext: PageContext): void {
  latestByTab.set(tabId, { pageContext });
}

export function rememberExtractionError(tabId: number, error: string): void {
  latestByTab.set(tabId, { pageContext: null, error });
}

export function forgetPageContext(tabId: number): void {
  latestByTab.delete(tabId);
  inFlightByTab.delete(tabId);
  // Also disowns any run still in flight, so a slow extraction of the previous
  // page cannot repopulate the cache after the tab navigated away.
  currentRunByTab.delete(tabId);
}

export function clearPageContextCache(): void {
  latestByTab.clear();
  inFlightByTab.clear();
  currentRunByTab.clear();
}

export async function readLatestPageContext(tabId: number): Promise<LatestPageContext> {
  await inFlightByTab.get(tabId);
  return latestByTab.get(tabId) ?? { pageContext: null };
}

/**
 * Starts extraction and records the outcome for the tab. Callers in a gesture
 * handler must not await this before opening the side panel — Chrome only
 * accepts `sidePanel.open` while the gesture is still in flight.
 */
export function captureTabContext(
  tabId: number,
  knownUrl?: string,
): Promise<ExtractionOutcome> {
  const token = {};
  currentRunByTab.set(tabId, token);

  const run = extractPageContextForTab(tabId, knownUrl).then((outcome) => {
    if (currentRunByTab.get(tabId) !== token) {
      return outcome;
    }
    currentRunByTab.delete(tabId);
    inFlightByTab.delete(tabId);
    if (outcome.ok) {
      rememberPageContext(tabId, outcome.pageContext);
      broadcastBackgroundEvent({
        type: "PAGE_CONTEXT_UPDATED",
        tabId,
        pageContext: outcome.pageContext,
      });
    } else {
      rememberExtractionError(tabId, outcome.error);
    }
    return outcome;
  });

  inFlightByTab.set(tabId, run);
  return run;
}
