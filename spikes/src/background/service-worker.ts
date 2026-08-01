import {
  appendSpikeLog,
  clearSpikeLog,
  getSpikeResults,
} from "../shared/logging/spike-log";
import type {
  BackgroundRequest,
  BackgroundResponse,
} from "../shared/messaging/messages";
import { isBackgroundRequest } from "../shared/messaging/messages";
import {
  clearActiveTabSpikeState,
  getActiveTabSpikeState,
  noteGrantedTabNavigation,
  runGestureExtraction,
} from "../shared/spikes/active-tab";
import {
  clearNotificationSpikeState,
  clearSpikeBadge,
  handleSpikeNotificationClick,
  handleSpikeNotificationClosed,
  isSpikeNotificationId,
  reportNotificationNotShown,
} from "../shared/spikes/notifications";
import { clearPermissionsSpikeState } from "../shared/spikes/permissions";
import { runSpike } from "../shared/spikes/runner";
import { probePromptApiContext } from "../shared/spikes/s01-contexts";
import { probeWorkerSessionCreation } from "../shared/spikes/s01-worker-create";
import {
  clearSidePanelSpikeState,
  noteSidePanelDocumentLoaded,
  openSidePanelForSpike,
} from "../shared/spikes/side-panel";
import type { SpikeId } from "../shared/spikes/types";

const OPEN_PANEL_MENU_ID = "promptahead-spikes-open-panel";
const EXTRACT_MENU_ID = "promptahead-spikes-extract-on-gesture";
const EXTRACT_COMMAND_ID = "extract-on-gesture";

/**
 * S0.5 needs `chrome.action.onClicked` to fire, because that callback is where
 * the fresh `activeTab` grant can be spent on `scripting.executeScript`. With
 * `openPanelOnActionClick: true` Chrome opens the panel itself and the
 * onClicked listener never runs, so we opt out and open the panel by hand from
 * the gesture instead. S0.4 still exercises the same three open paths.
 */
chrome.runtime.onInstalled.addListener(() => {
  void setupContextMenu();
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

chrome.runtime.onStartup.addListener(() => {
  void setupContextMenu();
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

async function setupContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: OPEN_PANEL_MENU_ID,
    title: "Open PromptAhead Spikes panel",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: EXTRACT_MENU_ID,
    title: "S0.5: extract this page on gesture",
    contexts: ["page", "selection"],
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) {
    return;
  }

  if (info.menuItemId === OPEN_PANEL_MENU_ID) {
    void openSidePanelForSpike({ trigger: "context-menu", tabId: tab.id });
    return;
  }

  if (info.menuItemId === EXTRACT_MENU_ID) {
    void openSidePanelForSpike({ trigger: "context-menu", tabId: tab.id });
    void runGestureExtraction(tab.id, "context-menu");
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!tab.id) {
    return;
  }
  // Open first: `sidePanel.open` must be reached from the gesture without an
  // intervening await, otherwise Chrome rejects it as a non-user action.
  void openSidePanelForSpike({ trigger: "toolbar-action", tabId: tab.id });
  void runGestureExtraction(tab.id, "action-click");
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== EXTRACT_COMMAND_ID || !tab?.id) {
    return;
  }
  // Not one of S0.4's three paths — this exists as a third activeTab gesture
  // for S0.5, so it opens the panel without recording panel coverage.
  void chrome.sidePanel.open({ tabId: tab.id });
  void runGestureExtraction(tab.id, "keyboard-command");
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!isSpikeNotificationId(notificationId)) {
    return;
  }
  void handleSpikeNotificationClick(notificationId);
});

chrome.notifications.onClosed.addListener((notificationId, byUser) => {
  if (!isSpikeNotificationId(notificationId)) {
    return;
  }
  void handleSpikeNotificationClosed(notificationId, byUser);
});

/**
 * S0.6 asks whether a runtime grant reaches the worker without a reload. The
 * worker is where Smart mode would react to it, so it logs the events itself.
 */
chrome.permissions.onAdded.addListener((permissions) => {
  void appendSpikeLog(
    "S0.6",
    "success",
    `[Service worker] permissions.onAdded: origins=${(permissions.origins ?? []).join(", ") || "none"}, permissions=${(permissions.permissions ?? []).join(", ") || "none"}`,
  );
});

chrome.permissions.onRemoved.addListener((permissions) => {
  void appendSpikeLog(
    "S0.6",
    "success",
    `[Service worker] permissions.onRemoved: origins=${(permissions.origins ?? []).join(", ") || "none"}, permissions=${(permissions.permissions ?? []).join(", ") || "none"}`,
  );
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && changeInfo.status !== "loading") {
    return;
  }
  void noteGrantedTabNavigation(tabId, changeInfo.url, "navigated");
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void noteGrantedTabNavigation(tabId, undefined, "closed");
});

/** Clearing a log has to clear the state that log describes, or the card lies. */
async function clearSpikeSideState(spikeId: SpikeId): Promise<void> {
  switch (spikeId) {
    case "S0.4":
      await clearSidePanelSpikeState();
      return;
    case "S0.5":
      await clearActiveTabSpikeState();
      return;
    case "S0.6":
      await clearPermissionsSpikeState();
      return;
    case "S0.7":
      await clearNotificationSpikeState();
      return;
    default:
      return;
  }
}

async function handleRequest(request: BackgroundRequest): Promise<BackgroundResponse> {
  switch (request.type) {
    case "GET_SPIKE_RESULTS": {
      const results = await getSpikeResults();
      return { ok: true, results };
    }
    case "PROBE_PROMPT_API_IN_WORKER": {
      // S0.1's service-worker row: only this realm can answer for itself.
      // A session is created here only when the model is already resident,
      // since a worker has no user activation to spend on a download.
      try {
        const probe = await probePromptApiContext("service-worker", {
          attemptCreateWhenAvailable: true,
        });
        return { ok: true, probe };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown probe error";
        await appendSpikeLog(
          "S0.1",
          "error",
          `[Service worker] probe threw: ${message}`,
        );
        return { ok: false, error: message };
      }
    }
    case "PROBE_WORKER_NANO_CREATE": {
      try {
        const probe = await probeWorkerSessionCreation();
        return probe ? { ok: true, probe } : { ok: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown probe error";
        await appendSpikeLog(
          "S0.1",
          "error",
          `[Service worker] create() probe threw: ${message}`,
        );
        return { ok: false, error: message };
      }
    }
    case "GET_S05_STATE": {
      const s05State = await getActiveTabSpikeState();
      return { ok: true, s05State };
    }
    case "SIDE_PANEL_LOADED": {
      await noteSidePanelDocumentLoaded();
      return { ok: true };
    }
    case "S07_REPORT_NOT_SHOWN": {
      await reportNotificationNotShown();
      return { ok: true };
    }
    case "S07_CLEAR_BADGE": {
      await clearSpikeBadge();
      return { ok: true };
    }
    case "CLEAR_SPIKE_LOG": {
      const result = await clearSpikeLog(request.spikeId);
      await clearSpikeSideState(request.spikeId);
      return { ok: true, result };
    }
    case "OPEN_SIDE_PANEL": {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      const tabId = request.tabId ?? tabs[0]?.id;
      if (!tabId) {
        return { ok: false, error: "No active tab to open the side panel." };
      }
      await chrome.sidePanel.open({ tabId });
      return { ok: true };
    }
    case "RUN_SPIKE": {
      try {
        await runSpike(request.spikeId);
        const results = await getSpikeResults();
        return { ok: true, result: results[request.spikeId] };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown spike error";
        await appendSpikeLog(request.spikeId, "error", message);
        const results = await getSpikeResults();
        return { ok: false, error: message, result: results[request.spikeId] };
      }
    }
    default:
      return { ok: false, error: "Unsupported request." };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isBackgroundRequest(message)) {
    return false;
  }

  void handleRequest(message).then(sendResponse);
  return true;
});

export {};
