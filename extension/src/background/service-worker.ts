import { openSidePanel } from "../shared/chrome";
import { ensureDefaults } from "../shared/storage";
import { registerBackgroundRouter } from "./router";
import { captureTabContext, forgetPageContext } from "./page-context-store";

const OPEN_PANEL_MENU_ID = "promptahead-open-panel";

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

/**
 * The single Manual entry point. Order matters and nothing may be awaited:
 * extraction is kicked off first so the injection request leaves while the
 * `activeTab` grant is freshest, then `sidePanel.open` still runs inside the
 * user gesture Chrome requires (S0.4/S0.5).
 */
function handleManualGesture(tab: chrome.tabs.Tab | undefined): void {
  if (!tab?.id) {
    return;
  }
  void captureTabContext(tab.id, tab.url);
  void openSidePanel(tab.id);
}

registerBackgroundRouter();

chrome.runtime.onInstalled.addListener(() => {
  configurePanelBehavior();
  void setupContextMenu();
  void ensureDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
  void setupContextMenu();
  void ensureDefaults();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== OPEN_PANEL_MENU_ID) {
    return;
  }
  handleManualGesture(tab);
});

chrome.action.onClicked.addListener((tab) => {
  handleManualGesture(tab);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== "open-panel") {
    return;
  }
  handleManualGesture(tab);
});

// Navigation revokes `activeTab`, so cached context for that tab is stale.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    forgetPageContext(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetPageContext(tabId);
});

export {};
