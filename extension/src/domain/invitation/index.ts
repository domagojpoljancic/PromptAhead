/**
 * Smart-mode invitation domain (M3 / DOM-34).
 *
 * Pure state machine + caps + badge-first copy. Service worker applies
 * chrome.action badges via background/invite-controller (optional
 * chrome.notifications deferred).
 */

export {
  clearInviteBadgePayload,
  inviteBadgeFor,
  type InviteBadgePayload,
} from "./badge";

export {
  DEFAULT_DAILY_INVITE_CAP,
  EMPTY_INVITE_QUOTA,
  calendarDayKeyUtc,
  domainFromUrl,
  isDailyCapReached,
  isDomainExcluded,
  isGlobalSnoozeActive,
  normalizeDomain,
  recordInviteShown,
  wasDomainInvitedToday,
  type InviteQuota,
} from "./caps";

export { INVITE_COPY, inviteCopyFor } from "./copy";

export {
  acceptInvitation,
  canInviteAgainOnPage,
  createInvitationSession,
  disableDomainInvitation,
  dismissInvitation,
  evaluateInviteSuppression,
  mayStartAnalysis,
  onThresholdReached,
  shouldShowInviteBadge,
  snoozeInvitation,
  type InvitationPhase,
  type InvitationSession,
  type InvitationSessionConfig,
  type InvitationTransition,
  type InvitePolicy,
  type SuppressionReason,
} from "./machine";
