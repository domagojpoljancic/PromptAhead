/**
 * Service-worker invite wiring (DOM-34).
 *
 * Engagement threshold → invitation state machine → chrome.action badge.
 * Accept / dismiss / snooze / disable clear the badge and persist caps.
 * Analysis (extract + panel suggest/Nano) starts only when
 * `openPanelAndAnalyze` is true after accept — never on threshold/badge.
 * Optional chrome.notifications deferred (badge-first; do not block on OS banners).
 */

import {
  acceptInvitation,
  calendarDayKeyUtc,
  clearInviteBadgePayload,
  createInvitationSession,
  disableDomainInvitation,
  dismissInvitation,
  inviteBadgeFor,
  onThresholdReached,
  snoozeInvitation,
  withExcludedDomain,
  type InvitationSession,
  type InvitePolicy,
  type InvitationTransition,
} from "../domain/invitation";
import {
  applyInviteBadge,
  clearInviteBadge,
  type ActionBadgeApi,
} from "../shared/chrome";
import type { PageType } from "../shared/types/page-context";
import {
  readInviteRuntime,
  readSettings,
  updateInviteRuntime,
  updateSettings,
  type InviteRuntimeState,
  type Settings,
} from "../shared/storage";

export type ThresholdDetail = {
  tabId: number;
  pageUrl: string;
  pageType: PageType;
  reason: string;
};

export type InviteAction = "accept" | "dismiss" | "snooze" | "disable_domain";

export type InviteHandleResult = {
  handled: boolean;
  showBadge: boolean;
  clearBadge: boolean;
  openPanelAndAnalyze: boolean;
  phase: InvitationSession["phase"] | null;
  suppression: string | null;
};

/** In-memory so toolbar gestures can accept without awaiting storage first. */
let activeInviteTabId: number | null = null;

export function peekActiveInviteTabId(): number | null {
  return activeInviteTabId;
}

export function rememberActiveInviteTab(tabId: number | null): void {
  activeInviteTabId = tabId;
}

function quotaFromRuntime(runtime: InviteRuntimeState) {
  return {
    dayKey: runtime.quotaDayKey,
    invitesToday: runtime.invitesToday,
    domainsInvitedToday: runtime.domainsInvitedToday,
    pagesInvitedToday: runtime.pagesInvitedToday ?? [],
  };
}

function policyFrom(
  settings: Settings,
  runtime: InviteRuntimeState,
  dayKey: string,
): InvitePolicy {
  return {
    dayKey,
    proactivePaused: settings.proactivePaused,
    excludedDomains: settings.excludedDomains,
    snoozeUntilDayKey: runtime.snoozeUntilDayKey,
    quota: quotaFromRuntime(runtime),
  };
}

function sessionFromActive(
  runtime: InviteRuntimeState,
): InvitationSession | null {
  const active = runtime.activeInvite;
  if (!active) {
    return null;
  }
  return {
    phase: "invitation_shown",
    pageUrl: active.pageUrl,
    domain: active.domain,
    pageType: active.pageType,
    suppression: null,
    reason: "threshold_reached",
  };
}

async function persistAfterTransition(
  transition: InvitationTransition,
  dayKey: string,
  tabId: number | undefined,
  settings: Settings,
  extra: Partial<Omit<InviteRuntimeState, "schemaVersion">> = {},
): Promise<void> {
  const patch: Partial<Omit<InviteRuntimeState, "schemaVersion">> = {
    quotaDayKey: transition.quota.dayKey || dayKey,
    invitesToday: transition.quota.invitesToday,
    domainsInvitedToday: [...transition.quota.domainsInvitedToday],
    pagesInvitedToday: [...transition.quota.pagesInvitedToday],
    snoozeUntilDayKey: transition.snoozeUntilDayKey,
    ...extra,
  };

  if (transition.showBadge && tabId !== undefined) {
    patch.activeInvite = {
      tabId,
      pageUrl: transition.session.pageUrl,
      domain: transition.session.domain,
      pageType: transition.session.pageType,
    };
    activeInviteTabId = tabId;
  } else if (transition.clearBadge || transition.openPanelAndAnalyze) {
    patch.activeInvite = null;
    activeInviteTabId = null;
  }

  await updateInviteRuntime(patch, dayKey);

  if (transition.excludeDomain) {
    await updateSettings({
      excludedDomains: withExcludedDomain(
        settings.excludedDomains,
        transition.excludeDomain,
      ),
    });
  }
}

async function paintFromTransition(
  transition: InvitationTransition,
  api?: ActionBadgeApi | null,
): Promise<void> {
  if (transition.showBadge) {
    await applyInviteBadge(inviteBadgeFor(transition.session.pageType), api);
    return;
  }
  if (transition.clearBadge || transition.openPanelAndAnalyze) {
    await clearInviteBadge(clearInviteBadgePayload(), api);
  }
}

function resultFrom(
  transition: InvitationTransition,
  handled: boolean,
): InviteHandleResult {
  return {
    handled,
    showBadge: transition.showBadge,
    clearBadge: transition.clearBadge,
    openPanelAndAnalyze: transition.openPanelAndAnalyze,
    phase: transition.session.phase,
    suppression: transition.session.suppression,
  };
}

/**
 * Content-script threshold fire. No-ops when Smart mode is off.
 * Never starts extraction / Nano — badge only until accept.
 */
export async function handleEngagementThreshold(
  detail: ThresholdDetail,
  api?: ActionBadgeApi | null,
  nowMs: number = Date.now(),
): Promise<InviteHandleResult> {
  const settings = await readSettings();
  if (settings.mode !== "smart" || !settings.smartModeAvailable) {
    return {
      handled: false,
      showBadge: false,
      clearBadge: false,
      openPanelAndAnalyze: false,
      phase: null,
      suppression: null,
    };
  }

  const dayKey = calendarDayKeyUtc(nowMs);
  const runtime = await readInviteRuntime(dayKey);
  const session = createInvitationSession({
    pageUrl: detail.pageUrl,
    pageType: detail.pageType,
  });
  const transition = onThresholdReached(
    session,
    policyFrom(settings, runtime, dayKey),
  );

  await persistAfterTransition(transition, dayKey, detail.tabId, settings, {
    lastInviteEvent: {
      at: new Date(nowMs).toISOString(),
      url: detail.pageUrl,
      pageType: detail.pageType,
      showBadge: transition.showBadge,
      suppression: transition.session.suppression,
      reason: transition.session.reason,
      invitesToday: transition.quota.invitesToday,
      domainsInvitedToday: [...transition.quota.domainsInvitedToday],
    },
  });
  await paintFromTransition(transition, api);

  return resultFrom(transition, true);
}

/**
 * Resolve accept / dismiss / snooze / disable against the active badge invite.
 */
export async function handleInviteAction(
  action: InviteAction,
  tabId: number | undefined,
  api?: ActionBadgeApi | null,
  nowMs: number = Date.now(),
): Promise<InviteHandleResult> {
  const dayKey = calendarDayKeyUtc(nowMs);
  const settings = await readSettings();
  const runtime = await readInviteRuntime(dayKey);
  const session = sessionFromActive(runtime);

  if (!session || (tabId !== undefined && runtime.activeInvite?.tabId !== tabId)) {
    return {
      handled: false,
      showBadge: false,
      clearBadge: false,
      openPanelAndAnalyze: false,
      phase: session?.phase ?? null,
      suppression: null,
    };
  }

  const policy = policyFrom(settings, runtime, dayKey);
  let transition: InvitationTransition;
  switch (action) {
    case "accept":
      transition = acceptInvitation(session, policy);
      break;
    case "dismiss":
      transition = dismissInvitation(session, policy);
      break;
    case "snooze":
      transition = snoozeInvitation(session, policy);
      break;
    case "disable_domain":
      transition = disableDomainInvitation(session, policy);
      break;
  }

  await persistAfterTransition(transition, dayKey, tabId, settings);
  await paintFromTransition(transition, api);

  return resultFrom(transition, true);
}

/**
 * Toolbar click while a badge invite is active for this tab → accept.
 * Returns true when the invite path handled the gesture (caller should open panel).
 */
export async function tryAcceptInviteForTab(
  tabId: number,
  api?: ActionBadgeApi | null,
  nowMs: number = Date.now(),
): Promise<InviteHandleResult> {
  return handleInviteAction("accept", tabId, api, nowMs);
}

/** Drop badge + active invite when the inviting tab navigates or closes. */
export async function clearInviteForTab(
  tabId: number,
  api?: ActionBadgeApi | null,
): Promise<void> {
  const runtime = await readInviteRuntime();
  if (runtime.activeInvite?.tabId !== tabId) {
    return;
  }
  await updateInviteRuntime({ activeInvite: null });
  activeInviteTabId = null;
  await clearInviteBadge(clearInviteBadgePayload(), api);
}
