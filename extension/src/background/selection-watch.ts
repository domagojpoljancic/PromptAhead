/**
 * Service-worker selection watch for low-value empty state (DOM-61).
 *
 * Starts a page listener while Manual shows “not much to prompt ahead…”.
 * On a stable selection, re-runs capture so the panel can unlock without
 * Refresh. Relies on the original toolbar gesture’s `activeTab` grant.
 */

import { executeScriptInTab } from "../shared/chrome";
import {
  installSelectionWatchInPage,
  stopSelectionWatchInPage,
  type SelectionWatchInstallResult,
  type SelectionWatchOptions,
} from "../content/selection-watch-in-page";
import { captureTabContext } from "./page-context-store";

export const SELECTION_WATCH_OPTIONS: SelectionWatchOptions = {
  debounceMs: 400,
  minChars: 12,
};

const watchingTabs = new Set<number>();

export function isSelectionWatchActive(tabId: number): boolean {
  return watchingTabs.has(tabId);
}

export async function startSelectionWatch(tabId: number): Promise<boolean> {
  try {
    const result = await executeScriptInTab<
      [SelectionWatchOptions],
      SelectionWatchInstallResult
    >(tabId, installSelectionWatchInPage, [SELECTION_WATCH_OPTIONS]);
    if (result?.watching) {
      watchingTabs.add(tabId);
      return true;
    }
    return false;
  } catch {
    watchingTabs.delete(tabId);
    return false;
  }
}

export async function stopSelectionWatch(tabId: number): Promise<void> {
  watchingTabs.delete(tabId);
  try {
    await executeScriptInTab(tabId, stopSelectionWatchInPage);
  } catch {
    // Tab closed / access lost — local bookkeeping already cleared.
  }
}

/** Drop bookkeeping (and best-effort page listener) on navigate/close. */
export function forgetSelectionWatch(tabId: number): void {
  watchingTabs.delete(tabId);
}

/**
 * Content-script SELECTION_READY. Re-extract while activeTab still holds.
 * No-ops if this tab is not under watch.
 */
export async function handleSelectionReady(
  tabId: number,
  knownUrl?: string,
): Promise<{ handled: boolean }> {
  if (!watchingTabs.has(tabId)) {
    return { handled: false };
  }
  // Stop before re-extract so a flurry of selectionchange events cannot
  // stack captures; panel restarts the watch if still on empty.
  await stopSelectionWatch(tabId);
  await captureTabContext(tabId, knownUrl, { source: "selection" });
  return { handled: true };
}

/** Test seam. */
export function clearSelectionWatchState(): void {
  watchingTabs.clear();
}
