/**
 * Invitation state machine (handoff §32 / DOM-34 / DOM-35).
 *
 * eligible → threshold → invitation shown → accepted | dismissed | snoozed | domain_disabled
 * Caps / pause / exclusion / snooze suppress before the badge is shown.
 *
 * Pure domain — no Chrome APIs, no extraction, no Nano.
 */

import type { PageType } from "../../shared/types/page-context";
import {
  domainFromUrl,
  isDailyCapReached,
  isDomainExcluded,
  isGlobalSnoozeActive,
  recordInviteShown,
  wasDomainInvitedToday,
  wasPageInvitedToday,
  type InviteQuota,
} from "./caps";

export type InvitationPhase =
  | "eligible"
  | "threshold_reached"
  | "invitation_shown"
  | "accepted"
  | "dismissed"
  | "snoozed"
  | "domain_disabled"
  | "suppressed";

export type SuppressionReason =
  | "daily_cap"
  | "domain_already_invited_today"
  | "page_already_invited_today"
  | "proactive_paused"
  | "domain_excluded"
  | "global_snooze"
  | "invalid_url";

export type InvitationSession = {
  phase: InvitationPhase;
  pageUrl: string;
  domain: string;
  pageType: PageType;
  suppression: SuppressionReason | null;
  reason: string;
};

export type InvitePolicy = {
  dayKey: string;
  proactivePaused: boolean;
  excludedDomains: readonly string[];
  /** Day key through which global snooze remains active (inclusive). */
  snoozeUntilDayKey: string | null;
  quota: InviteQuota;
};

export type InvitationTransition = {
  session: InvitationSession;
  /** Newly entered invitation_shown — apply badge (no page UI). */
  showBadge: boolean;
  /** Newly accepted — open side panel; only then may extraction / Nano run. */
  openPanelAndAnalyze: boolean;
  /** Clear badge when leaving invitation_shown without accept, or after accept handled. */
  clearBadge: boolean;
  /** Quota after a successful show; unchanged otherwise. */
  quota: InviteQuota;
  /** New snooze day key when user snoozes; otherwise prior policy value. */
  snoozeUntilDayKey: string | null;
  /** Domain to add to exclusions when user disables the site. */
  excludeDomain: string | null;
};

export type InvitationSessionConfig = {
  pageUrl: string;
  pageType: PageType;
};

function transitionBase(
  session: InvitationSession,
  quota: InviteQuota,
  snoozeUntilDayKey: string | null,
): InvitationTransition {
  return {
    session,
    showBadge: false,
    openPanelAndAnalyze: false,
    clearBadge: false,
    quota,
    snoozeUntilDayKey,
    excludeDomain: null,
  };
}

export function createInvitationSession(
  config: InvitationSessionConfig,
): InvitationSession {
  const domain = domainFromUrl(config.pageUrl) ?? "";
  return {
    phase: "eligible",
    pageUrl: config.pageUrl,
    domain,
    pageType: config.pageType,
    suppression: null,
    reason: "init",
  };
}

/**
 * Gate checks before an invitation may be shown. Order matches product
 * priorities: pause / exclusion / snooze first, then daily + domain + page caps.
 */
export function evaluateInviteSuppression(
  session: InvitationSession,
  policy: InvitePolicy,
): SuppressionReason | null {
  if (!session.domain) {
    return "invalid_url";
  }
  if (policy.proactivePaused) {
    return "proactive_paused";
  }
  if (isDomainExcluded(session.domain, policy.excludedDomains)) {
    return "domain_excluded";
  }
  if (isGlobalSnoozeActive(policy.dayKey, policy.snoozeUntilDayKey)) {
    return "global_snooze";
  }
  if (isDailyCapReached(policy.quota, policy.dayKey)) {
    return "daily_cap";
  }
  if (wasDomainInvitedToday(policy.quota, session.domain, policy.dayKey)) {
    return "domain_already_invited_today";
  }
  if (wasPageInvitedToday(policy.quota, session.pageUrl, policy.dayKey)) {
    return "page_already_invited_today";
  }
  return null;
}

/** True only after the user accepts — extraction / Nano must wait for this. */
export function mayStartAnalysis(session: InvitationSession): boolean {
  return session.phase === "accepted";
}

export function shouldShowInviteBadge(session: InvitationSession): boolean {
  return session.phase === "invitation_shown";
}

/**
 * Engagement threshold fired for this page. Either shows the badge-first
 * invite or records a suppression (still no page UI / no analysis).
 */
export function onThresholdReached(
  session: InvitationSession,
  policy: InvitePolicy,
): InvitationTransition {
  if (session.phase !== "eligible") {
    return transitionBase(session, policy.quota, policy.snoozeUntilDayKey);
  }

  const suppression = evaluateInviteSuppression(session, policy);
  if (suppression) {
    return transitionBase(
      {
        ...session,
        phase: "suppressed",
        suppression,
        reason: `suppressed:${suppression}`,
      },
      policy.quota,
      policy.snoozeUntilDayKey,
    );
  }

  // eligible → threshold reached → invitation shown (collapsed into one
  // transition so SW callers apply the badge exactly once).
  const shown: InvitationSession = {
    ...session,
    phase: "invitation_shown",
    suppression: null,
    reason: "threshold_reached",
  };

  return {
    ...transitionBase(
      shown,
      recordInviteShown(
        policy.quota,
        session.domain,
        policy.dayKey,
        session.pageUrl,
      ),
      policy.snoozeUntilDayKey,
    ),
    showBadge: true,
  };
}

export function acceptInvitation(
  session: InvitationSession,
  policy: InvitePolicy,
): InvitationTransition {
  if (session.phase !== "invitation_shown") {
    return transitionBase(session, policy.quota, policy.snoozeUntilDayKey);
  }
  return {
    ...transitionBase(
      {
        ...session,
        phase: "accepted",
        reason: "accepted",
      },
      policy.quota,
      policy.snoozeUntilDayKey,
    ),
    openPanelAndAnalyze: true,
    clearBadge: true,
  };
}

export function dismissInvitation(
  session: InvitationSession,
  policy: InvitePolicy,
): InvitationTransition {
  if (session.phase !== "invitation_shown") {
    return transitionBase(session, policy.quota, policy.snoozeUntilDayKey);
  }
  return {
    ...transitionBase(
      {
        ...session,
        phase: "dismissed",
        reason: "dismissed",
      },
      policy.quota,
      policy.snoozeUntilDayKey,
    ),
    clearBadge: true,
  };
}

/** Suppress proactive invites globally for the rest of the current day. */
export function snoozeInvitation(
  session: InvitationSession,
  policy: InvitePolicy,
): InvitationTransition {
  if (session.phase !== "invitation_shown") {
    return transitionBase(session, policy.quota, policy.snoozeUntilDayKey);
  }
  return {
    ...transitionBase(
      {
        ...session,
        phase: "snoozed",
        reason: "snoozed",
      },
      policy.quota,
      policy.dayKey,
    ),
    clearBadge: true,
    snoozeUntilDayKey: policy.dayKey,
  };
}

/** Don't suggest on this site — domain joins excludedDomains. */
export function disableDomainInvitation(
  session: InvitationSession,
  policy: InvitePolicy,
): InvitationTransition {
  if (session.phase !== "invitation_shown") {
    return transitionBase(session, policy.quota, policy.snoozeUntilDayKey);
  }
  return {
    ...transitionBase(
      {
        ...session,
        phase: "domain_disabled",
        reason: "domain_disabled",
      },
      policy.quota,
      policy.snoozeUntilDayKey,
    ),
    clearBadge: true,
    excludeDomain: session.domain,
  };
}

/**
 * Re-check whether a dismissed / terminal page may ever invite again.
 * Dismissed pages stay closed for this page session.
 */
export function canInviteAgainOnPage(session: InvitationSession): boolean {
  return session.phase === "eligible";
}
