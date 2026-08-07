/**
 * Smart-mode engagement domain (M3 / DOM-33).
 *
 * Pure helpers for thresholds, eligibility, scroll depth, product interactions,
 * and a once-per-page session. Content scripts drive the session; invitation
 * UX and daily caps live in DOM-34.
 */

export {
  createActiveTimeState,
  flushActiveTime,
  readActiveMs,
  setFocused,
  setVisibility,
  type ActiveTimeState,
} from "./active-time";

export { isEngagementEligibleUrl } from "./eligibility";

export {
  evaluateEngagementThreshold,
  type EngagementSignalSnapshot,
  type ThresholdEvaluation,
} from "./evaluate";

export {
  classifyProductInteraction,
  isMeaningfulProductInteraction,
  type InteractionTargetSnapshot,
  type ProductInteractionKind,
} from "./product-signals";

export { computeScrollDepth, type ScrollMetrics } from "./scroll";

export {
  createEngagementSession,
  noteFocus,
  noteProductInteraction,
  noteScroll,
  noteVisibility,
  tickEngagement,
  type EngagementSessionConfig,
  type EngagementSessionState,
  type EngagementTickResult,
} from "./session";

export {
  DEFAULT_ARTICLE_THRESHOLD,
  DEFAULT_ENGAGEMENT_THRESHOLDS,
  DEFAULT_PRODUCT_THRESHOLD,
  type ArticleThreshold,
  type EngagementThresholds,
  type ProductThreshold,
} from "./thresholds";
