/**
 * Apply / clear the toolbar action badge for Smart invites (DOM-34).
 * Thin chrome.action wrappers — callers pass domain invite payloads.
 */

export type InviteBadgePaint = {
  text: string;
  title: string;
  backgroundColor: string;
};

export type ActionBadgeApi = {
  setBadgeText: (details: { text: string }) => Promise<void> | void;
  setBadgeBackgroundColor: (details: { color: string }) => Promise<void> | void;
  setTitle?: (details: { title: string }) => Promise<void> | void;
};

function defaultActionApi(): ActionBadgeApi | null {
  if (typeof chrome === "undefined" || !chrome.action?.setBadgeText) {
    return null;
  }
  return chrome.action;
}

/** Paint the badge-first invite on the toolbar icon. */
export async function applyInviteBadge(
  payload: InviteBadgePaint,
  api: ActionBadgeApi | null = defaultActionApi(),
): Promise<boolean> {
  if (!api) {
    return false;
  }
  try {
    await api.setBadgeText({ text: payload.text });
    await api.setBadgeBackgroundColor({ color: payload.backgroundColor });
    if (api.setTitle) {
      await api.setTitle({ title: payload.title });
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
): Promise<boolean> {
  return applyInviteBadge(payload, api);
}
