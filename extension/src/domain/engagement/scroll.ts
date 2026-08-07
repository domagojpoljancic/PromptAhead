/**
 * Scroll depth as a fraction of scrollable height (0–1).
 * Uses max(document, body) heights the content script will pass in.
 */

export type ScrollMetrics = {
  scrollY: number;
  viewportHeight: number;
  scrollHeight: number;
};

/**
 * How far the user has scrolled through the document.
 * Short pages (nothing to scroll) count as fully scrolled when the viewport
 * covers the content — otherwise articles shorter than the screen would never
 * meet the 35% bar.
 */
export function computeScrollDepth(metrics: ScrollMetrics): number {
  const { scrollY, viewportHeight, scrollHeight } = metrics;
  if (
    !Number.isFinite(scrollY) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(scrollHeight) ||
    viewportHeight <= 0
  ) {
    return 0;
  }

  const maxScroll = Math.max(0, scrollHeight - viewportHeight);
  if (maxScroll <= 0) {
    return 1;
  }

  const depth = (Math.max(0, scrollY) + viewportHeight) / scrollHeight;
  return Math.min(1, Math.max(0, depth));
}
