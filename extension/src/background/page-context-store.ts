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
/** Tab from the most recent toolbar / menu / shortcut gesture (panel may not be active tab). */
let lastGestureTabId: number | null = null;
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
  lastGestureTabId = null;
}

export function readLastGestureTabId(): number | null {
  return lastGestureTabId;
}

/** Bound extraction so GET_LATEST cannot await a hung page script forever. */
export const EXTRACTION_TIMEOUT_MS = 30_000;

export async function readLatestPageContext(tabId: number): Promise<LatestPageContext> {
  const inFlight = inFlightByTab.get(tabId);
  if (inFlight) {
    const outcome = await Promise.race([
      inFlight,
      new Promise<ExtractionOutcome>((resolve) => {
        setTimeout(
          () =>
            resolve({
              ok: false,
              error: "Reading this page took too long. Click Refresh or try again.",
            }),
          EXTRACTION_TIMEOUT_MS,
        );
      }),
    ]);
    if (!outcome.ok) {
      return { pageContext: null, error: outcome.error };
    }
  }
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
  options: { source?: "gesture" | "selection" } = {},
): Promise<ExtractionOutcome> {
  const source = options.source ?? "gesture";
  // Selection-driven re-extract must not steal the gesture-tab pointer used
  // by GET_LATEST when the panel first opens.
  if (source === "gesture") {
    lastGestureTabId = tabId;
  }
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
        source,
      });
    } else {
      rememberExtractionError(tabId, outcome.error);
    }
    return outcome;
  });

  inFlightByTab.set(tabId, run);
  return run;
}
