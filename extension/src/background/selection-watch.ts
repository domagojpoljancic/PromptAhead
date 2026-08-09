/**
 * Service-worker selection watch + page-upgrade for low-value empty (DOM-61/62).
 *
 * While Manual shows “not much to prompt ahead…”, we:
 * 1. Watch for text selection and re-extract (activeTab still valid).
 * 2. Remember the tab so a later navigation to a real article can auto-extract
 *    when Smart host permission is already granted (activeTab is gone after
 *    navigate — Manual alone cannot silently re-read).
 */

import { executeScriptInTab } from "../shared/chrome";
import { assessUrlPromptValue } from "../domain/page-value";
import { hasSmartHostPermission } from "../domain/smart";
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
/** Tabs on low-value empty that may navigate to a real article next. */
const awaitingPageUpgrade = new Set<number>();

export function isSelectionWatchActive(tabId: number): boolean {
  return watchingTabs.has(tabId);
}

export function isAwaitingPageUpgrade(tabId: number): boolean {
  return awaitingPageUpgrade.has(tabId);
}

export async function startSelectionWatch(tabId: number): Promise<boolean> {
  try {
    const result = await executeScriptInTab<
      [SelectionWatchOptions],
      SelectionWatchInstallResult
    >(tabId, installSelectionWatchInPage, [SELECTION_WATCH_OPTIONS]);
    if (result?.watching) {
      watchingTabs.add(tabId);
      awaitingPageUpgrade.add(tabId);
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
  awaitingPageUpgrade.delete(tabId);
  try {
    await executeScriptInTab(tabId, stopSelectionWatchInPage);
  } catch {
    // Tab closed / access lost — local bookkeeping already cleared.
  }
}

/** Clear the “maybe they’ll open an article” flag (gesture / unlock / close). */
export function clearAwaitingPageUpgrade(tabId: number): void {
  awaitingPageUpgrade.delete(tabId);
}

/**
 * Drop the in-page selection listener bookkeeping (navigate clears activeTab).
 * Keeps `awaitingPageUpgrade` so a finished load can still auto-extract under Smart.
 */
export function forgetSelectionWatch(tabId: number): void {
  watchingTabs.delete(tabId);
}

/** Tab closed — drop everything. */
export function forgetPageUpgradeState(tabId: number): void {
  watchingTabs.delete(tabId);
  awaitingPageUpgrade.delete(tabId);
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

/**
 * After navigate completes: if we were on low-value empty and Smart host
 * access exists, capture the new page when it looks worth prompting.
 */
export async function tryUpgradeAfterNavigation(
  tabId: number,
  url: string,
): Promise<{ attempted: boolean; captured: boolean }> {
  if (!awaitingPageUpgrade.has(tabId)) {
    return { attempted: false, captured: false };
  }
  awaitingPageUpgrade.delete(tabId);

  if (!assessUrlPromptValue(url).worthPrompting) {
    return { attempted: true, captured: false };
  }

  if (!(await hasSmartHostPermission())) {
    return { attempted: true, captured: false };
  }

  const outcome = await captureTabContext(tabId, url, { source: "navigation" });
  return { attempted: true, captured: outcome.ok };
}

/** Test seam. */
export function clearSelectionWatchState(): void {
  watchingTabs.clear();
  awaitingPageUpgrade.clear();
}
