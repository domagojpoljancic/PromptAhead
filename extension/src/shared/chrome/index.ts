/** Thin, typed wrappers over the handful of Chrome APIs Manual mode needs. */

export {
  applyInviteBadge,
  clearInviteBadge,
  type ActionBadgeApi,
  type InviteBadgePaint,
} from "./badge";

export function isExtensionContext(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

/**
 * Call this directly inside a gesture handler. Awaiting anything first breaks
 * Chrome's user-gesture requirement for `sidePanel.open` (spike S0.5).
 */
export function openSidePanel(tabId: number): Promise<void> {
  return chrome.sidePanel.open({ tabId });
}

/** `chrome://`, the Web Store and similar targets reject script injection. */
export function isInjectableUrl(url: string | undefined): boolean {
  if (!url) {
    return false;
  }
  if (/^https?:\/\//i.test(url)) {
    return !/^https:\/\/chromewebstore\.google\.com/i.test(url);
  }
  return url.startsWith("file://");
}

export async function executeScriptInTab<Args extends unknown[], Result>(
  tabId: number,
  func: (...args: Args) => Result,
  args?: Args,
): Promise<Result | null> {
  const [injection] = await chrome.scripting.executeScript<Args, Result>({
    target: { tabId },
    func,
    ...(args ? { args } : {}),
  });
  return (injection?.result as Result | undefined) ?? null;
}
