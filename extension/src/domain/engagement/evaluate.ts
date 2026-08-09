/**
 * Threshold evaluation — pure, no I/O, never triggers extraction/Nano.
 */

import type { PageType } from "../../shared/types/page-context";
import {
  DEFAULT_ENGAGEMENT_THRESHOLDS,
  type EngagementThresholds,
} from "./thresholds";

export type EngagementSignalSnapshot = {
  pageType: PageType;
  activeMs: number;
  /** 0–1 scroll depth. */
  scrollDepth: number;
  hasProductInteraction: boolean;
};

export type ThresholdEvaluation = {
  met: boolean;
  /** Stable reason for tests / debug logs. */
  reason: string;
};

/**
 * Whether current signals meet the initial article / product bars.
 * Generic pages never meet — Smart invites only for article/product (handoff).
 * Articles: active dwell **or** deep scroll (either bar is enough).
 */
export function evaluateEngagementThreshold(
  signals: EngagementSignalSnapshot,
  thresholds: EngagementThresholds = DEFAULT_ENGAGEMENT_THRESHOLDS,
): ThresholdEvaluation {
  if (signals.pageType === "generic") {
    return { met: false, reason: "generic-page" };
  }

  if (signals.pageType === "article") {
    const { minActiveMs, minScrollDepth } = thresholds.article;
    const timeOk = signals.activeMs >= minActiveMs;
    const scrollOk = signals.scrollDepth >= minScrollDepth;
    if (timeOk) {
      return { met: true, reason: "article-active-time-met" };
    }
    if (scrollOk) {
      return { met: true, reason: "article-scroll-depth-met" };
    }
    return { met: false, reason: "article-threshold-pending" };
  }

  // product
  const { minActiveMs, requireInteraction } = thresholds.product;
  if (signals.activeMs < minActiveMs) {
    return { met: false, reason: "product-active-time" };
  }
  if (requireInteraction && !signals.hasProductInteraction) {
    return { met: false, reason: "product-interaction" };
  }
  return { met: true, reason: "product-threshold-met" };
}
