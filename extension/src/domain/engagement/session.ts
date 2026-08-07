/**
 * Per-page engagement session: accumulates signals and fires at most once.
 * Intentionally does not extract DOM content or call Nano — threshold only
 * means “invite candidate” (DOM-34 owns the invitation state machine).
 */

import type { PageType } from "../../shared/types/page-context";
import {
  createActiveTimeState,
  flushActiveTime,
  readActiveMs,
  setFocused,
  setVisibility,
  type ActiveTimeState,
} from "./active-time";
import { evaluateEngagementThreshold } from "./evaluate";
import {
  isMeaningfulProductInteraction,
  type InteractionTargetSnapshot,
} from "./product-signals";
import { computeScrollDepth, type ScrollMetrics } from "./scroll";
import {
  DEFAULT_ENGAGEMENT_THRESHOLDS,
  type EngagementThresholds,
} from "./thresholds";

export type EngagementSessionConfig = {
  pageType: PageType;
  /** Page URL — used only for eligibility checks by the caller. */
  url: string;
  thresholds?: EngagementThresholds;
  now?: number;
  visible?: boolean;
  focused?: boolean;
};

export type EngagementSessionState = {
  pageType: PageType;
  url: string;
  active: ActiveTimeState;
  scrollDepth: number;
  hasProductInteraction: boolean;
  /** Threshold already reached this page load — no re-fire. */
  fired: boolean;
  lastReason: string;
};

export type EngagementTickResult = {
  state: EngagementSessionState;
  /** True exactly once when the threshold first becomes met. */
  thresholdReached: boolean;
  reason: string;
};

export function createEngagementSession(
  config: EngagementSessionConfig,
): EngagementSessionState {
  const now = config.now ?? 0;
  return {
    pageType: config.pageType,
    url: config.url,
    active: createActiveTimeState(now, config.visible ?? true, config.focused ?? true),
    scrollDepth: 0,
    hasProductInteraction: false,
    fired: false,
    lastReason: "init",
  };
}

function snapshotFrom(
  state: EngagementSessionState,
  now: number,
): {
  pageType: PageType;
  activeMs: number;
  scrollDepth: number;
  hasProductInteraction: boolean;
} {
  return {
    pageType: state.pageType,
    activeMs: readActiveMs(state.active, now),
    scrollDepth: state.scrollDepth,
    hasProductInteraction: state.hasProductInteraction,
  };
}

function evaluate(
  state: EngagementSessionState,
  now: number,
  thresholds: EngagementThresholds,
): EngagementTickResult {
  const evaluation = evaluateEngagementThreshold(snapshotFrom(state, now), thresholds);
  const shouldFire = evaluation.met && !state.fired;
  const next: EngagementSessionState = {
    ...state,
    active: flushActiveTime(state.active, now),
    fired: state.fired || shouldFire,
    lastReason: evaluation.reason,
  };
  return {
    state: next,
    thresholdReached: shouldFire,
    reason: evaluation.reason,
  };
}

export function noteVisibility(
  state: EngagementSessionState,
  visible: boolean,
  now: number,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
): EngagementTickResult {
  const next = { ...state, active: setVisibility(state.active, visible, now) };
  return evaluate(next, now, thresholds);
}

export function noteFocus(
  state: EngagementSessionState,
  focused: boolean,
  now: number,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
): EngagementTickResult {
  const next = { ...state, active: setFocused(state.active, focused, now) };
  return evaluate(next, now, thresholds);
}

export function noteScroll(
  state: EngagementSessionState,
  metrics: ScrollMetrics,
  now: number,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
): EngagementTickResult {
  const depth = Math.max(state.scrollDepth, computeScrollDepth(metrics));
  const next = { ...state, scrollDepth: depth };
  return evaluate(next, now, thresholds);
}

export function noteProductInteraction(
  state: EngagementSessionState,
  target: InteractionTargetSnapshot,
  now: number,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
): EngagementTickResult {
  const meaningful = isMeaningfulProductInteraction(target);
  const next = {
    ...state,
    hasProductInteraction: state.hasProductInteraction || meaningful,
  };
  return evaluate(next, now, thresholds);
}

/** Periodic / idle tick so active time alone can cross the bar. */
export function tickEngagement(
  state: EngagementSessionState,
  now: number,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
): EngagementTickResult {
  return evaluate(state, now, thresholds);
}
