/**
 * Content-script engagement adapter (DOM-33).
 *
 * Wires DOM visibility / focus / scroll / click into the pure session.
 * Does not extract page content and does not call Nano — on threshold it only
 * invokes the provided callback (SW invite wiring is DOM-34).
 *
 * Not registered in the manifest yet: always-on injection requires Smart host
 * permission (DOM-32). Callers inject this after grant.
 */

import type { PageType } from "../shared/types/page-context";
import {
  createEngagementSession,
  isEngagementEligibleUrl,
  noteFocus,
  noteProductInteraction,
  noteScroll,
  noteVisibility,
  tickEngagement,
  type EngagementSessionState,
  type EngagementThresholds,
  type InteractionTargetSnapshot,
} from "../domain/engagement";

export type EngagementTrackerOptions = {
  pageType: PageType;
  url: string;
  thresholds?: EngagementThresholds;
  /** Fired at most once per page when the threshold is met. */
  onThresholdReached: (detail: {
    pageType: PageType;
    url: string;
    reason: string;
  }) => void;
  /** Defaults to `window` / `document` in the page. */
  clock?: () => number;
  /** Scroll sampling interval — keeps handlers off the hot path. */
  scrollThrottleMs?: number;
  /** Active-time poll so dwell alone can cross the bar without events. */
  tickIntervalMs?: number;
};

export type EngagementTrackerHandle = {
  stop: () => void;
  /** Test / debug seam. */
  getState: () => EngagementSessionState;
};

function snapshotInteractionTarget(node: EventTarget | null): InteractionTargetSnapshot | null {
  if (!(node instanceof Element)) {
    return null;
  }
  const el = node as HTMLElement;
  const attrBits = [
    el.id,
    typeof el.className === "string" ? el.className : "",
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("name") ?? "",
    el.getAttribute("data-testid") ?? "",
  ];
  const productChrome = Boolean(
    el.closest(
      "[itemtype*='Product'], [data-product], .product, #product, [class*='product']",
    ),
  );
  return {
    tagName: el.tagName,
    role: el.getAttribute("role") ?? undefined,
    type: el.getAttribute("type") ?? undefined,
    hints: attrBits.join(" "),
    inProductChrome: productChrome,
  };
}

function readScrollMetrics(doc: Document, win: Window) {
  const root = doc.documentElement;
  const body = doc.body;
  return {
    scrollY: win.scrollY || root.scrollTop || body?.scrollTop || 0,
    viewportHeight: win.innerHeight || root.clientHeight || 0,
    scrollHeight: Math.max(
      root.scrollHeight,
      body?.scrollHeight ?? 0,
      root.offsetHeight,
      body?.offsetHeight ?? 0,
    ),
  };
}

/**
 * Start passive engagement listeners. No-ops (returns a stopped handle) on
 * ineligible origins so callers do not need a separate gate.
 */
export function startEngagementTracker(
  options: EngagementTrackerOptions,
  doc?: Document,
  win?: Window,
): EngagementTrackerHandle {
  if (!isEngagementEligibleUrl(options.url)) {
    const empty = createEngagementSession({
      pageType: options.pageType,
      url: options.url,
      now: 0,
      visible: false,
      focused: false,
    });
    return { stop: () => undefined, getState: () => empty };
  }

  const pageDoc = doc ?? document;
  const pageWin = win ?? window;
  const clock = options.clock ?? (() => Date.now());
  const scrollThrottleMs = options.scrollThrottleMs ?? 200;
  const tickIntervalMs = options.tickIntervalMs ?? 1_000;
  let state = createEngagementSession({
    pageType: options.pageType,
    url: options.url,
    thresholds: options.thresholds,
    now: clock(),
    visible: pageDoc.visibilityState === "visible",
    focused: typeof pageDoc.hasFocus === "function" ? pageDoc.hasFocus() : true,
  });

  let stopped = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const apply = (
    result: ReturnType<typeof tickEngagement>,
  ): void => {
    state = result.state;
    if (result.thresholdReached) {
      options.onThresholdReached({
        pageType: options.pageType,
        url: options.url,
        reason: result.reason,
      });
    }
  };

  const onVisibility = (): void => {
    if (stopped) return;
    apply(
      noteVisibility(
        state,
        pageDoc.visibilityState === "visible",
        clock(),
        options.thresholds,
      ),
    );
  };

  const onFocus = (): void => {
    if (stopped) return;
    apply(noteFocus(state, true, clock(), options.thresholds));
  };

  const onBlur = (): void => {
    if (stopped) return;
    apply(noteFocus(state, false, clock(), options.thresholds));
  };

  const flushScroll = (): void => {
    if (stopped) return;
    apply(
      noteScroll(
        state,
        readScrollMetrics(pageDoc, pageWin),
        clock(),
        options.thresholds,
      ),
    );
  };

  const onScroll = (): void => {
    if (stopped || scrollTimer !== null) return;
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      flushScroll();
    }, scrollThrottleMs);
  };

  const onClick = (event: Event): void => {
    if (stopped || options.pageType !== "product") return;
    const target = snapshotInteractionTarget(event.target);
    if (!target) return;
    apply(noteProductInteraction(state, target, clock(), options.thresholds));
  };

  pageDoc.addEventListener("visibilitychange", onVisibility, { passive: true });
  pageWin.addEventListener("focus", onFocus, { passive: true });
  pageWin.addEventListener("blur", onBlur, { passive: true });
  pageWin.addEventListener("scroll", onScroll, { passive: true, capture: true });
  pageDoc.addEventListener("click", onClick, { passive: true, capture: true });

  tickTimer = setInterval(() => {
    if (stopped) return;
    apply(tickEngagement(state, clock(), options.thresholds));
  }, tickIntervalMs);

  // Initial scroll sample for short pages already in view.
  flushScroll();

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      pageDoc.removeEventListener("visibilitychange", onVisibility);
      pageWin.removeEventListener("focus", onFocus);
      pageWin.removeEventListener("blur", onBlur);
      pageWin.removeEventListener("scroll", onScroll, true);
      pageDoc.removeEventListener("click", onClick, true);
      if (scrollTimer !== null) clearTimeout(scrollTimer);
      if (tickTimer !== null) clearInterval(tickTimer);
    },
    getState: () => state,
  };
}
