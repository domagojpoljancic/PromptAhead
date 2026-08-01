/**
 * Single entry point for every `BackgroundRequest`. Kept separate from the
 * service-worker event wiring so it can be exercised directly in tests.
 */

import { getActiveTab, openSidePanel } from "../shared/chrome";
import {
  describeError,
  isBackgroundRequest,
  type BackgroundRequest,
  type BackgroundResponse,
} from "../shared/messaging";
import {
  addRecentPrompt,
  clearAllPromptAheadData,
  readOnboarding,
  readRecentHistory,
  readSettings,
  updateOnboarding,
  updateSettings,
} from "../shared/storage";
import {
  captureTabContext,
  clearPageContextCache,
  readLatestPageContext,
} from "./page-context-store";

type ResolvedTab = { id: number; url?: string };

async function resolveTab(explicitTabId?: number): Promise<ResolvedTab | null> {
  const tab = await getActiveTab();
  if (typeof explicitTabId === "number") {
    // The panel knows the tab it was opened for; the query only adds the URL,
    // and only when `activeTab` still covers that tab.
    return { id: explicitTabId, url: tab?.id === explicitTabId ? tab.url : undefined };
  }
  return tab?.id === undefined ? null : { id: tab.id, url: tab.url };
}

export async function handleBackgroundRequest(
  request: BackgroundRequest,
): Promise<BackgroundResponse> {
  switch (request.type) {
    case "PING":
      return { ok: true, type: "PING", pong: true };

    case "GET_SETTINGS":
      return { ok: true, type: "GET_SETTINGS", settings: await readSettings() };

    case "SET_SETTINGS":
      return {
        ok: true,
        type: "SET_SETTINGS",
        settings: await updateSettings(request.patch),
      };

    case "GET_ONBOARDING":
      return { ok: true, type: "GET_ONBOARDING", onboarding: await readOnboarding() };

    case "SET_ONBOARDING":
      return {
        ok: true,
        type: "SET_ONBOARDING",
        onboarding: await updateOnboarding(request.patch),
      };

    case "GET_RECENT_HISTORY":
      return {
        ok: true,
        type: "GET_RECENT_HISTORY",
        history: await readRecentHistory(),
      };

    case "ADD_RECENT_PROMPT": {
      const history = await addRecentPrompt(request.entry);
      return {
        ok: true,
        type: "ADD_RECENT_PROMPT",
        entry: history.entries[0]!,
        history,
      };
    }

    case "CLEAR_ALL_DATA":
      await clearAllPromptAheadData();
      clearPageContextCache();
      return { ok: true, type: "CLEAR_ALL_DATA", cleared: true };

    case "GET_LATEST_PAGE_CONTEXT": {
      const tab = await resolveTab(request.tabId);
      const latest =
        tab === null ? { pageContext: null } : await readLatestPageContext(tab.id);
      return { ok: true, type: "GET_LATEST_PAGE_CONTEXT", ...latest };
    }

    case "EXTRACT_ACTIVE_TAB": {
      const tab = await resolveTab(request.tabId);
      if (tab === null) {
        return {
          ok: false,
          type: "EXTRACT_ACTIVE_TAB",
          error: "No active tab to extract from",
        };
      }
      const outcome = await captureTabContext(tab.id, tab.url);
      return outcome.ok
        ? { ok: true, type: "EXTRACT_ACTIVE_TAB", pageContext: outcome.pageContext }
        : { ok: false, type: "EXTRACT_ACTIVE_TAB", error: outcome.error };
    }

    case "OPEN_SIDE_PANEL": {
      const tab = await resolveTab(request.tabId);
      if (tab === null) {
        return {
          ok: false,
          type: "OPEN_SIDE_PANEL",
          error: "No active tab to open against",
        };
      }
      try {
        await openSidePanel(tab.id);
        return { ok: true, type: "OPEN_SIDE_PANEL", opened: true };
      } catch (error) {
        // Chrome rejects `sidePanel.open` unless a user gesture is in flight.
        return { ok: false, type: "OPEN_SIDE_PANEL", error: describeError(error) };
      }
    }
  }
}

/** Wires the router into `chrome.runtime.onMessage` (service worker only). */
export function registerBackgroundRouter(): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isBackgroundRequest(message)) {
      sendResponse({
        ok: false,
        type: "UNKNOWN",
        error: "Unrecognized message",
      } satisfies BackgroundResponse);
      return false;
    }

    handleBackgroundRequest(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({
          ok: false,
          type: message.type,
          error: describeError(error),
        } satisfies BackgroundResponse);
      });

    // Keep the channel open for the async reply.
    return true;
  });
}
