import { appendSpikeLog, setSpikeStatus } from "../logging/spike-log";
import { hasBroadHostAccess } from "./permissions";
import {
  getSidePanelSpikeState,
  openSidePanelForSpike,
} from "./side-panel";
import type { SpikeId } from "./types";

/**
 * S0.7 — Notifications.
 *
 * The product question: can PromptAhead invite the user with a badge and a
 * compact notification, with nothing injected into the page, and does clicking
 * that notification open the side panel?
 *
 * The last part is not a given. `sidePanel.open()` requires a user gesture and
 * Chrome does not treat every event as one, so the notification id carries the
 * window id: the click handler can reach `open()` with zero awaits in front of
 * it and a refusal is then unambiguously Chrome's, not the harness's.
 */

const SPIKE_ID: SpikeId = "S0.7";

export const NOTIFICATIONS_STATE_STORAGE_KEY = "spikes.s07.notifications.v1";

export const SPIKE_NOTIFICATION_PREFIX = "spike-s07";

const BADGE_TEXT = "1";
const BADGE_BACKGROUND = "#5b9cff";
const BADGE_TEXT_COLOR = "#04101f";

/** Long enough for Chrome to have surfaced (or swallowed) the notification. */
const DELIVERY_CHECK_DELAY_MS = 1_500;

export interface NotificationSpikeState {
  ranAt: string | null;
  badgeSet: boolean;
  badgeReadback: string | null;
  permissionLevel: string | null;
  notificationId: string | null;
  created: boolean;
  createError: string | null;
  /** `notifications.getAll()` still listed the id shortly after creating it. */
  presentAfterCreate: boolean | null;
  clickedAt: string | null;
  closedAt: string | null;
  closedByUser: boolean | null;
  sidePanelOpened: boolean | null;
  sidePanelError: string | null;
  reportedNotShownAt: string | null;
}

function emptyState(): NotificationSpikeState {
  return {
    ranAt: null,
    badgeSet: false,
    badgeReadback: null,
    permissionLevel: null,
    notificationId: null,
    created: false,
    createError: null,
    presentAfterCreate: null,
    clickedAt: null,
    closedAt: null,
    closedByUser: null,
    sidePanelOpened: null,
    sidePanelError: null,
    reportedNotShownAt: null,
  };
}

export async function getNotificationSpikeState(): Promise<NotificationSpikeState> {
  const stored = await chrome.storage.local.get(NOTIFICATIONS_STATE_STORAGE_KEY);
  const existing = stored[NOTIFICATIONS_STATE_STORAGE_KEY] as
    | NotificationSpikeState
    | undefined;
  return { ...emptyState(), ...existing };
}

async function patchNotificationSpikeState(
  patch: Partial<NotificationSpikeState>,
): Promise<NotificationSpikeState> {
  const next = { ...(await getNotificationSpikeState()), ...patch };
  await chrome.storage.local.set({ [NOTIFICATIONS_STATE_STORAGE_KEY]: next });
  return next;
}

export async function clearNotificationSpikeState(): Promise<void> {
  await clearSpikeBadge();
  await chrome.storage.local.set({
    [NOTIFICATIONS_STATE_STORAGE_KEY]: emptyState(),
  });
}

export function isSpikeNotificationId(notificationId: string): boolean {
  return notificationId.startsWith(SPIKE_NOTIFICATION_PREFIX);
}

/**
 * `chrome.notifications` still returns promises only on newer builds, and the
 * shipped typings model it as callback-only. The callback form works
 * everywhere and, unlike the promise form, forces `runtime.lastError` to be
 * read — which is exactly where a silently rejected notification shows up.
 */
function promisify<T>(
  label: string,
  invoke: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((value) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? `${label} failed`));
        return;
      }
      resolve(value);
    });
  });
}

function createNotification(
  id: string,
  options: chrome.notifications.NotificationOptions<true>,
): Promise<string> {
  return promisify("notifications.create", (resolve) => {
    chrome.notifications.create(id, options, resolve);
  });
}

function getNotificationPermissionLevel(): Promise<string> {
  return promisify("notifications.getPermissionLevel", (resolve) => {
    chrome.notifications.getPermissionLevel(resolve);
  });
}

function getLiveNotificationIds(): Promise<string[]> {
  return promisify<Record<string, unknown>>(
    "notifications.getAll",
    (resolve) => {
      chrome.notifications.getAll((all) => {
        resolve((all ?? {}) as Record<string, unknown>);
      });
    },
  ).then((all) => Object.keys(all));
}

function clearNotification(id: string): Promise<boolean> {
  return promisify("notifications.clear", (resolve) => {
    chrome.notifications.clear(id, resolve);
  });
}

/**
 * `spike-s07:w<windowId>:<timestamp>` — the window id travels in the id so the
 * click handler never has to await a tabs/windows query before `open()`.
 */
function buildNotificationId(windowId: number | null): string {
  return `${SPIKE_NOTIFICATION_PREFIX}:w${windowId ?? "none"}:${Date.now()}`;
}

function parseNotificationWindowId(notificationId: string): number | null {
  const match = /^spike-s07:w(\d+):/.exec(notificationId);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function clearSpikeBadge(): Promise<void> {
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    // A badge that will not clear must never be the reason a spike throws.
  }
}

interface BadgeOutcome {
  ok: boolean;
  readback: string;
}

async function setSpikeBadge(): Promise<BadgeOutcome> {
  try {
    await chrome.action.setBadgeText({ text: BADGE_TEXT });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_BACKGROUND });
    if (typeof chrome.action.setBadgeTextColor === "function") {
      await chrome.action.setBadgeTextColor({ color: BADGE_TEXT_COLOR });
    }

    const text = await chrome.action.getBadgeText({});
    const background = await chrome.action.getBadgeBackgroundColor({});
    const readback = `text="${text}", background=[${background.join(", ")}]`;
    return { ok: text === BADGE_TEXT, readback };
  } catch (error) {
    return {
      ok: false,
      readback: `threw — ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function activeWindowId(): Promise<number | null> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return tab?.windowId ?? null;
  } catch {
    return null;
  }
}

/**
 * Sets the badge, posts the notification, then stops. The interesting half of
 * the spike happens in the click handler, so this run ends `blocked` — the
 * evidence is missing, nothing has failed yet.
 */
export async function runNotificationSpike(spikeId: SpikeId): Promise<void> {
  await setSpikeStatus(spikeId, "running");
  await patchNotificationSpikeState({
    ...emptyState(),
    ranAt: new Date().toISOString(),
  });

  const badge = await setSpikeBadge();
  await patchNotificationSpikeState({
    badgeSet: badge.ok,
    badgeReadback: badge.readback,
  });
  await appendSpikeLog(
    spikeId,
    badge.ok ? "success" : "error",
    `Action badge set and read back: ${badge.readback}`,
  );
  await appendSpikeLog(
    spikeId,
    "info",
    "The badge stays up on purpose so you can see it. It clears when you click or dismiss the notification, or with the buttons on this card.",
  );

  if (typeof chrome.notifications?.create !== "function") {
    await appendSpikeLog(
      spikeId,
      "error",
      "chrome.notifications is not available in this build — the badge is the only invitation surface left.",
    );
    await setSpikeStatus(spikeId, "fail");
    return;
  }

  let permissionLevel: string | null = null;
  try {
    permissionLevel = await getNotificationPermissionLevel();
  } catch (error) {
    await appendSpikeLog(
      spikeId,
      "warn",
      `notifications.getPermissionLevel() threw — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await patchNotificationSpikeState({ permissionLevel });
  await appendSpikeLog(
    spikeId,
    permissionLevel === "granted" ? "info" : "warn",
    `notifications.getPermissionLevel() = ${permissionLevel ?? "unknown"}`,
  );

  if (permissionLevel === "denied") {
    await appendSpikeLog(
      spikeId,
      "error",
      "Chrome-level notification permission is denied for this extension, so nothing can be posted. Re-enable it at chrome://settings/content/notifications and run again.",
    );
    await setSpikeStatus(spikeId, "blocked");
    return;
  }

  const windowId = await activeWindowId();
  if (windowId === null) {
    await appendSpikeLog(
      spikeId,
      "warn",
      "No focused window found, so the notification id cannot carry one. The click handler will have to query for a tab first, which may cost the user gesture and make the side-panel result inconclusive.",
    );
  }

  const notificationId = buildNotificationId(windowId);
  let created = false;
  let createError: string | null = null;
  try {
    await createNotification(notificationId, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("public/icons/icon-128.png"),
      title: "PromptAhead",
      message: "Want help turning this page into a prompt?",
      priority: 0,
      requireInteraction: true,
      silent: true,
    });
    created = true;
  } catch (error) {
    createError = error instanceof Error ? error.message : String(error);
  }

  await patchNotificationSpikeState({ notificationId, created, createError });

  if (!created) {
    await appendSpikeLog(
      spikeId,
      "error",
      `notifications.create() failed — ${createError ?? "unknown error"}`,
    );
    await setSpikeStatus(spikeId, "fail");
    return;
  }

  await appendSpikeLog(
    spikeId,
    "success",
    `notifications.create() resolved — id=${notificationId} (requireInteraction: true, silent, no buttons).`,
  );
  await appendSpikeLog(
    spikeId,
    "info",
    "No content script ran and no scripting.executeScript call was made: badge and notification are both browser chrome, so the page was never touched.",
  );

  if (await hasBroadHostAccess()) {
    await appendSpikeLog(
      spikeId,
      "warn",
      "<all_urls> is currently granted (left over from S0.6). It is not needed for this spike — revoke it so the 'no page access required' claim is demonstrated rather than assumed.",
    );
  } else {
    await appendSpikeLog(
      spikeId,
      "success",
      "No host permissions are granted, so the invitation surface provably needs zero page access.",
    );
  }

  await new Promise((resolve) => setTimeout(resolve, DELIVERY_CHECK_DELAY_MS));

  let presentAfterCreate: boolean | null = null;
  try {
    presentAfterCreate = (await getLiveNotificationIds()).includes(
      notificationId,
    );
  } catch (error) {
    await appendSpikeLog(
      spikeId,
      "warn",
      `notifications.getAll() threw — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await patchNotificationSpikeState({ presentAfterCreate });

  await appendSpikeLog(
    spikeId,
    presentAfterCreate === false ? "warn" : "info",
    `notifications.getAll() ${DELIVERY_CHECK_DELAY_MS} ms later ${
      presentAfterCreate === null
        ? "could not be read"
        : presentAfterCreate
          ? "still lists the notification"
          : "no longer lists it — Chrome accepted the call but the notification is gone, which is what OS-level suppression looks like"
    }.`,
  );
  await appendSpikeLog(
    spikeId,
    "warn",
    'macOS can swallow Chrome notifications while still reporting "granted". If no banner appeared, check System Settings → Notifications → Google Chrome, then press "Notification not shown" on this card so the result is recorded as blocked rather than as a failure.',
  );
  await appendSpikeLog(
    spikeId,
    "info",
    "Close the side panel first, then click the notification. With the panel already open, a successful click only proves Chrome allowed the call — not that a closed panel actually opens. Reopen the panel afterwards to read the result.",
  );
  await setSpikeStatus(spikeId, "blocked");
}

/**
 * Notification click. Called straight from the event listener: the first thing
 * that runs is `sidePanel.open()`, so if Chrome refuses it is because a
 * notification click is not a user gesture, not because we awaited first.
 */
export async function handleSpikeNotificationClick(
  notificationId: string,
): Promise<void> {
  const windowId = parseNotificationWindowId(notificationId);
  const clickedAt = new Date().toISOString();

  let opened: boolean;
  if (windowId !== null) {
    opened = await openSidePanelForSpike({
      trigger: "notification-click",
      windowId,
    });
  } else {
    await appendSpikeLog(
      SPIKE_ID,
      "warn",
      "Notification id carried no window id, so the handler had to query tabs before opening the panel. A refusal below is inconclusive.",
    );
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (!tab?.id) {
      await appendSpikeLog(
        SPIKE_ID,
        "error",
        "No tab found to open the side panel against after the notification click.",
      );
      await patchNotificationSpikeState({ clickedAt, sidePanelOpened: false });
      await setSpikeStatus(SPIKE_ID, "fail");
      return;
    }
    opened = await openSidePanelForSpike({
      trigger: "notification-click",
      tabId: tab.id,
      awaitedBeforeOpen: true,
    });
  }

  const panelState = await getSidePanelSpikeState();
  const attempt = panelState.attempts["notification-click"];

  await patchNotificationSpikeState({
    clickedAt,
    sidePanelOpened: opened,
    sidePanelError: attempt?.error ?? null,
  });

  await appendSpikeLog(
    SPIKE_ID,
    "success",
    `notifications.onClicked fired for ${notificationId}.`,
  );

  await clearNotification(notificationId).catch(() => false);
  await clearSpikeBadge();
  await appendSpikeLog(SPIKE_ID, "info", "Notification cleared and badge reset.");

  if (opened) {
    await appendSpikeLog(
      SPIKE_ID,
      "success",
      "Side panel opened from the notification click — badge + notification is a complete invitation path with no page injection.",
    );
    await setSpikeStatus(SPIKE_ID, "pass");
    return;
  }

  await appendSpikeLog(
    SPIKE_ID,
    "error",
    `Side panel did NOT open from the notification click — ${attempt?.error ?? "no error message"}. The notification can still invite, but it cannot open the panel itself: the product would have to fall back to the badge plus a toolbar click.`,
  );
  await setSpikeStatus(SPIKE_ID, "fail");
}

export async function handleSpikeNotificationClosed(
  notificationId: string,
  byUser: boolean,
): Promise<void> {
  const state = await getNotificationSpikeState();
  if (state.notificationId !== notificationId || state.clickedAt) {
    return;
  }

  await patchNotificationSpikeState({
    closedAt: new Date().toISOString(),
    closedByUser: byUser,
  });
  await clearSpikeBadge();
  await appendSpikeLog(
    SPIKE_ID,
    byUser ? "info" : "warn",
    byUser
      ? "You dismissed the notification without clicking it. Badge cleared; run again and click the banner itself to finish the spike."
      : "The notification closed on its own without a click — it timed out or the OS withdrew it. Badge cleared.",
  );
  await setSpikeStatus(SPIKE_ID, "blocked");
}

/** The tester saw no banner. That is an OS limitation, not a code failure. */
export async function reportNotificationNotShown(): Promise<void> {
  const state = await getNotificationSpikeState();
  await patchNotificationSpikeState({
    reportedNotShownAt: new Date().toISOString(),
  });
  await clearSpikeBadge();

  await appendSpikeLog(
    SPIKE_ID,
    "warn",
    `Tester reports no notification appeared, although create() ${
      state.created ? "succeeded" : "did not succeed"
    } and Chrome reported permission level "${state.permissionLevel ?? "unknown"}".`,
  );
  await appendSpikeLog(
    SPIKE_ID,
    "warn",
    "Blocked, not failed: Chrome accepted the notification and the extension code is correct — the operating system suppressed delivery. On macOS check System Settings → Notifications → Google Chrome (Allow Notifications, and not in Do Not Disturb / Focus).",
  );
  await appendSpikeLog(
    SPIKE_ID,
    "info",
    "If this cannot be fixed on the test machine, record S0.7 as badge-proven / notification-unverified and decide the invitation surface from the badge result alone.",
  );
  await setSpikeStatus(SPIKE_ID, "blocked");
}
