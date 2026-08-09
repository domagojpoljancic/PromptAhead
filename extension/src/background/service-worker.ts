import {
  hasSmartHostPermission,
  smartOriginsGranted,
  syncEngagementContentScripts,
} from "../domain/smart";
import { broadcastBackgroundEvent } from "../shared/messaging";
import { ensureDefaults } from "../shared/storage";
import { ENGAGEMENT_BOOT_SCRIPT_PATH } from "./engagement-boot-path";
import {
  clearInviteForTab,
  peekActiveInviteTabId,
  tryAcceptInviteForTab,
} from "./invite-controller";
import { kickOffPanelAnalysis } from "./panel-analysis";
import { registerBackgroundRouter } from "./router";
import { forgetPageContext } from "./page-context-store";
import {
  forgetPageUpgradeState,
  forgetSelectionWatch,
  tryUpgradeAfterNavigation,
} from "./selection-watch";

const OPEN_PANEL_MENU_ID = "promptahead-open-panel";
const ENGAGEMENT_JS = [ENGAGEMENT_BOOT_SCRIPT_PATH] as const;

/**
 * Manual mode spends `activeTab` on gesture before opening the panel.
 * With `openPanelOnActionClick: true`, Chrome opens the panel itself and
 * `action.onClicked` never fires — so we opt out and open by hand (S0.5).
 */
function configurePanelBehavior(): void {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}

async function setupContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: OPEN_PANEL_MENU_ID,
    title: "Open PromptAhead",
    contexts: ["page"],
  });
}

/** Register engagement tracker iff optional Smart host access is present. */
async function syncEngagementRegistration(): Promise<void> {
  const granted = await hasSmartHostPermission();
  const result = await syncEngagementContentScripts(
    granted,
    undefined,
    undefined,
    ENGAGEMENT_JS,
  );
  if (result.error) {
    console.warn("[PromptAhead] engagement script sync failed:", result.error);
  } else if (granted && result.registered) {
    console.info(
      "[PromptAhead] engagement script registered",
      result.js?.join(", ") ?? "",
    );
  }
}

/**
 * Manual / post-accept entry. Order matters and nothing may be awaited:
 * extraction is kicked off first so the injection request leaves while the
 * `activeTab` grant is freshest, then `sidePanel.open` still runs inside the
 * user gesture Chrome requires (S0.4/S0.5). Suggest (curated/Nano) runs in the
 * panel after context arrives — never on engagement threshold alone.
 */
function handleManualGesture(tab: chrome.tabs.Tab | undefined): void {
  if (!tab?.id) {
    return;
  }
  kickOffPanelAnalysis(tab.id, tab.url);
}

/**
 * Toolbar / shortcut / menu. Uses in-memory invite tab id so accept can open
 * the panel inside the user gesture (no await before sidePanel.open).
 * Badge/threshold never reaches here — only an explicit accept gesture does.
 */
function handleGesture(tab: chrome.tabs.Tab | undefined): void {
  if (!tab?.id) {
    return;
  }
  if (peekActiveInviteTabId() === tab.id) {
    // Accept clears badge; analysis uses the same Manual extract→panel path.
    void tryAcceptInviteForTab(tab.id);
    kickOffPanelAnalysis(tab.id, tab.url);
    return;
  }
  handleManualGesture(tab);
}

registerBackgroundRouter();

// Every SW wake (including unpacked Reload) — do not rely only on onInstalled.
configurePanelBehavior();
void setupContextMenu();
void ensureDefaults();
void syncEngagementRegistration();

chrome.runtime.onInstalled.addListener(() => {
  configurePanelBehavior();
  void setupContextMenu();
  void ensureDefaults();
  void syncEngagementRegistration();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
  void setupContextMenu();
  void ensureDefaults();
  void syncEngagementRegistration();
});

// Smart grant/revoke from options or onboarding (S0.6) — keep content-script
// registration in lockstep so engagement never runs without host access.
chrome.permissions.onAdded.addListener((permissions) => {
  if (smartOriginsGranted(permissions.origins)) {
    void syncEngagementContentScripts(true, undefined, undefined, ENGAGEMENT_JS);
  }
});

chrome.permissions.onRemoved.addListener((permissions) => {
  if (smartOriginsGranted(permissions.origins)) {
    void syncEngagementContentScripts(false, undefined, undefined, ENGAGEMENT_JS);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== OPEN_PANEL_MENU_ID) {
    return;
  }
  handleGesture(tab);
});

chrome.action.onClicked.addListener((tab) => {
  handleGesture(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-panel") {
    return;
  }
  handleGesture(tab);
});

// Navigation revokes `activeTab`, so cached context for that tab is stale.
// The panel stays open and reacts to PAGE_CONTEXT_CLEARED (DOM-10).
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // `status: "loading"` covers full navigations; `url` covers same-document
  // and some Playwright-driven navigations that omit status.
  if (changeInfo.status === "loading" || changeInfo.url !== undefined) {
    forgetPageContext(tabId);
    // Keep awaitingPageUpgrade so a completed load can Smart-auto-extract.
    forgetSelectionWatch(tabId);
    void clearInviteForTab(tabId);
    broadcastBackgroundEvent({
      type: "PAGE_CONTEXT_CLEARED",
      tabId,
      reason: "navigated",
    });
  }

  if (changeInfo.status === "complete") {
    const url = tab.url ?? "";
    if (!/^https?:/i.test(url)) {
      return;
    }
    void (async () => {
      await tryUpgradeAfterNavigation(tabId, url);

      if (!(await hasSmartHostPermission())) {
        return;
      }
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [...ENGAGEMENT_JS],
        });
      } catch {
        // Restricted page or missing host access on this tab.
      }
    })();
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetPageContext(tabId);
  forgetPageUpgradeState(tabId);
  void clearInviteForTab(tabId);
  broadcastBackgroundEvent({
    type: "PAGE_CONTEXT_CLEARED",
    tabId,
    reason: "closed",
  });
});

export {};
