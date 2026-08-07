/**
 * Initial Smart-mode engagement thresholds (handoff §9).
 * Adaptation / learning adjusts these later — defaults stay fixed here.
 */

export type ArticleThreshold = {
  /** Active, visible, focused dwell time. */
  minActiveMs: number;
  /** Fraction of page height scrolled into view (0–1). */
  minScrollDepth: number;
};

export type ProductThreshold = {
  minActiveMs: number;
  /** Opening media, specs, variants, reviews, etc. */
  requireInteraction: boolean;
};

export const DEFAULT_ARTICLE_THRESHOLD: Readonly<ArticleThreshold> = {
  minActiveMs: 45_000,
  minScrollDepth: 0.35,
};

export const DEFAULT_PRODUCT_THRESHOLD: Readonly<ProductThreshold> = {
  minActiveMs: 30_000,
  requireInteraction: true,
};

export type EngagementThresholds = {
  article: ArticleThreshold;
  product: ProductThreshold;
};

export const DEFAULT_ENGAGEMENT_THRESHOLDS: Readonly<EngagementThresholds> = {
  article: DEFAULT_ARTICLE_THRESHOLD,
  product: DEFAULT_PRODUCT_THRESHOLD,
};
