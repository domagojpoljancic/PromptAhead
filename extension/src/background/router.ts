/**
 * Single entry point for every `BackgroundRequest`. Kept separate from the
 * service-worker event wiring so it can be exercised directly in tests.
 */

import { getActiveTab, openSidePanel } from "../shared/chrome";
import {
  broadcastBackgroundEvent,
  describeError,
  isBackgroundEvent,
  isBackgroundRequest,
  type BackgroundRequest,
  type BackgroundResponse,
} from "../shared/messaging";
import {
  addRecentPrompt,
  clearAllPromptAheadData,
  clearLearningAggregates,
  clearRecentHistory,
  readOnboarding,
  readRecentHistory,
  readSettings,
  updateOnboarding,
  updateSettings,
} from "../shared/storage";
import {
  clearInviteForTab,
  handleEngagementThreshold,
  handleInviteAction,
} from "./invite-controller";
import {
  captureTabContext,
  clearPageContextCache,
  readLastGestureTabId,
  readLatestPageContext,
} from "./page-context-store";

type ResolvedTab = { id: number; url?: string };

export type RequestContext = {
  /** Tab that sent the message (content script), when known. */
  senderTabId?: number;
};

async function resolveTab(explicitTabId?: number): Promise<ResolvedTab | null> {
  const tab = await getActiveTab();
  const resolvedId =
    explicitTabId ?? readLastGestureTabId() ?? tab?.id ?? undefined;
  if (resolvedId === undefined) {
    return null;
  }
  return {
    id: resolvedId,
    url: tab?.id === resolvedId ? tab.url : undefined,
  };
}

export async function handleBackgroundRequest(
  request: BackgroundRequest,
  context: RequestContext = {},
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

    case "CLEAR_RECENT_HISTORY":
      return {
        ok: true,
        type: "CLEAR_RECENT_HISTORY",
        history: await clearRecentHistory(),
      };

    case "CLEAR_LEARNED_PREFS":
      await clearLearningAggregates();
      return { ok: true, type: "CLEAR_LEARNED_PREFS", cleared: true };

    case "CLEAR_ALL_DATA": {
      const restored = await clearAllPromptAheadData();
      clearPageContextCache();
      broadcastBackgroundEvent({
        type: "PAGE_CONTEXT_CLEARED",
        tabId: -1,
        reason: "cleared",
      });
      return {
        ok: true,
        type: "CLEAR_ALL_DATA",
        cleared: true,
        settings: restored.settings,
        onboarding: restored.onboarding,
      };
    }

    case "GET_LATEST_PAGE_CONTEXT": {
      const tab = await resolveTab(request.tabId);
      if (tab === null) {
        return { ok: true, type: "GET_LATEST_PAGE_CONTEXT", pageContext: null };
      }
      const latest = await readLatestPageContext(tab.id);
      return {
        ok: true,
        type: "GET_LATEST_PAGE_CONTEXT",
        tabId: tab.id,
        ...latest,
      };
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
        ? {
            ok: true,
            type: "EXTRACT_ACTIVE_TAB",
            pageContext: outcome.pageContext,
            tabId: tab.id,
          }
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

    case "ENGAGEMENT_THRESHOLD": {
      const tabId = request.tabId ?? context.senderTabId;
      if (tabId === undefined) {
        return {
          ok: false,
          type: "ENGAGEMENT_THRESHOLD",
          error: "No tab id for engagement threshold",
        };
      }
      const outcome = await handleEngagementThreshold({
        tabId,
        pageUrl: request.url,
        pageType: request.pageType,
        reason: request.reason,
      });
      return {
        ok: true,
        type: "ENGAGEMENT_THRESHOLD",
        handled: outcome.handled,
        showBadge: outcome.showBadge,
        phase: outcome.phase,
        suppression: outcome.suppression,
      };
    }

    case "INVITE_ACTION": {
      const tabId = request.tabId ?? context.senderTabId;
      const outcome = await handleInviteAction(request.action, tabId);
      if (
        outcome.handled &&
        outcome.openPanelAndAnalyze &&
        tabId !== undefined
      ) {
        // TODO(DOM-34 follow-up): full Nano-on-accept analysis pipeline.
        // For now open the side panel so accept is immediately actionable.
        try {
          void captureTabContext(tabId);
          await openSidePanel(tabId);
        } catch {
          // Gesture may be missing when called from a non-gesture message.
        }
      }
      return {
        ok: true,
        type: "INVITE_ACTION",
        handled: outcome.handled,
        clearBadge: outcome.clearBadge,
        openPanelAndAnalyze: outcome.openPanelAndAnalyze,
        phase: outcome.phase,
      };
    }
  }
}

/** Wires the router into `chrome.runtime.onMessage` (service worker only). */
export function registerBackgroundRouter(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Push events are for open pages (side panel); the worker ignores them.
    if (isBackgroundEvent(message)) {
      return false;
    }
    if (!isBackgroundRequest(message)) {
      sendResponse({
        ok: false,
        type: "UNKNOWN",
        error: "Unrecognized message",
      } satisfies BackgroundResponse);
      return false;
    }

    const context: RequestContext = {
      senderTabId: sender.tab?.id,
    };

    handleBackgroundRequest(message, context)
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

export { clearInviteForTab };
