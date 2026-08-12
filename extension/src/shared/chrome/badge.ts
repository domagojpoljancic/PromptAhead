/**
 * Apply / clear the toolbar action badge for Smart invites (DOM-34).
 * Thin chrome.action wrappers — callers pass domain invite payloads.
 *
 * Always paint/clear with a `tabId` when known so the `!` is per-tab
 * (global badges stick after tab switches and confuse Manual testing).
 */

export type InviteBadgePaint = {
  text: string;
  title: string;
  backgroundColor: string;
};

export type ActionBadgeDetails = {
  text?: string;
  color?: string;
  title?: string;
  tabId?: number;
};

export type ActionBadgeApi = {
  setBadgeText: (details: {
    text: string;
    tabId?: number;
  }) => Promise<void> | void;
  setBadgeBackgroundColor: (details: {
    color: string;
    tabId?: number;
  }) => Promise<void> | void;
  setTitle?: (details: {
    title: string;
    tabId?: number;
  }) => Promise<void> | void;
};

function defaultActionApi(): ActionBadgeApi | null {
  if (typeof chrome === "undefined" || !chrome.action?.setBadgeText) {
    return null;
  }
  return chrome.action;
}

/** Paint the badge-first invite on the toolbar icon for one tab. */
export async function applyInviteBadge(
  payload: InviteBadgePaint,
  api: ActionBadgeApi | null = defaultActionApi(),
  tabId?: number,
): Promise<boolean> {
  if (!api) {
    return false;
  }
  try {
    const tab = tabId !== undefined ? { tabId } : {};
    await api.setBadgeText({ text: payload.text, ...tab });
    await api.setBadgeBackgroundColor({
      color: payload.backgroundColor,
      ...tab,
    });
    if (api.setTitle) {
      await api.setTitle({ title: payload.title, ...tab });
    }
    return true;
  } catch {
    return false;
  }
}

/** Clear badge text and restore the default action title. */
export async function clearInviteBadge(
  payload: InviteBadgePaint,
  api: ActionBadgeApi | null = defaultActionApi(),
  tabId?: number,
): Promise<boolean> {
  return applyInviteBadge(payload, api, tabId);
}
