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
    if (signals.activeMs < minActiveMs) {
      return { met: false, reason: "article-active-time" };
    }
    if (signals.scrollDepth < minScrollDepth) {
      return { met: false, reason: "article-scroll-depth" };
    }
    return { met: true, reason: "article-threshold-met" };
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
