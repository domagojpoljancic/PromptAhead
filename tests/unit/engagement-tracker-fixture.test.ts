/**
 * DOM-33 Done-when: instrumented fixture pages prove threshold fire, plus a
 * light jank smoke (passive listeners + scroll throttle) without Playwright.
 *
 * Uses the Vitest jsdom document (not a nested JSDOM) so `instanceof Element`
 * in the tracker matches click targets.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startEngagementTracker } from "../../extension/src/content/engagement-tracker";
import { computeScrollDepth } from "../../extension/src/domain/engagement";
import { readFixture } from "./helpers/fixture-dom";

const ARTICLE_URL = "https://news.example.com/eu-ai-act";
const PRODUCT_URL = "https://shop.example.com/aurora-14";

/** Short bars so the fixture suite stays fast under fake timers. */
const FAST_THRESHOLDS = {
  article: { minActiveMs: 1_000, minScrollDepth: 0.35 },
  product: { minActiveMs: 500, requireInteraction: true },
} as const;

type ScrollMetricsSetup = {
  innerHeight: number;
  scrollHeight: number;
  scrollY?: number;
};

function mountFixtureIntoDocument(
  name: string,
  metrics: ScrollMetricsSetup,
): { win: Window & typeof globalThis; doc: Document } {
  const parsed = new DOMParser().parseFromString(readFixture(name), "text/html");
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;

  const win = window;
  const doc = document;

  Object.defineProperty(doc, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  vi.spyOn(doc, "hasFocus").mockReturnValue(true);

  Object.defineProperty(win, "innerHeight", {
    configurable: true,
    value: metrics.innerHeight,
  });
  Object.defineProperty(win, "scrollY", {
    configurable: true,
    writable: true,
    value: metrics.scrollY ?? 0,
  });
  Object.defineProperty(doc.documentElement, "clientHeight", {
    configurable: true,
    value: metrics.innerHeight,
  });
  Object.defineProperty(doc.documentElement, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(doc.documentElement, "scrollTop", {
    configurable: true,
    get: () => win.scrollY,
  });
  Object.defineProperty(doc.body, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });

  return { win, doc };
}

describe("engagement tracker on HTML fixtures", () => {
  let now = 0;
  let stopHandle: (() => void) | undefined;

  beforeEach(() => {
    now = 0;
    vi.useFakeTimers();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  afterEach(() => {
    stopHandle?.();
    stopHandle = undefined;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("fires article threshold on article-jsonld after dwell + scroll depth", async () => {
    const { win, doc } = mountFixtureIntoDocument("article-jsonld", {
      innerHeight: 500,
      scrollHeight: 2000,
      scrollY: 0,
    });
    const onThresholdReached = vi.fn();

    expect(
      computeScrollDepth({
        scrollY: 0,
        viewportHeight: 500,
        scrollHeight: 2000,
      }),
    ).toBeCloseTo(0.25);

    const handle = startEngagementTracker({
      pageType: "article",
      url: ARTICLE_URL,
      thresholds: FAST_THRESHOLDS,
      clock: () => now,
      scrollThrottleMs: 50,
      tickIntervalMs: 200,
      onThresholdReached,
    }, doc, win);
    stopHandle = handle.stop;

    expect(handle.getState().scrollDepth).toBeCloseTo(0.25);
    expect(onThresholdReached).not.toHaveBeenCalled();

    Object.defineProperty(win, "scrollY", {
      configurable: true,
      writable: true,
      value: 400,
    });
    win.dispatchEvent(new Event("scroll"));
    now = 50;
    await vi.advanceTimersByTimeAsync(50);
    expect(handle.getState().scrollDepth).toBeCloseTo(0.45);
    expect(onThresholdReached).not.toHaveBeenCalled();

    now = 1_000;
    await vi.advanceTimersByTimeAsync(200);
    expect(onThresholdReached).toHaveBeenCalledTimes(1);
    expect(onThresholdReached).toHaveBeenCalledWith({
      pageType: "article",
      url: ARTICLE_URL,
      reason: "article-threshold-met",
    });
    expect(Object.keys(onThresholdReached.mock.calls[0]![0]).sort()).toEqual([
      "pageType",
      "reason",
      "url",
    ]);

    now = 2_000;
    await vi.advanceTimersByTimeAsync(200);
    expect(onThresholdReached).toHaveBeenCalledTimes(1);
  });

  it("fires product threshold on product-jsonld after dwell + meaningful click", async () => {
    const { win, doc } = mountFixtureIntoDocument("product-jsonld", {
      innerHeight: 800,
      scrollHeight: 800,
    });
    const onThresholdReached = vi.fn();

    const specs = doc.createElement("button");
    specs.className = "view-specifications";
    specs.textContent = "Specifications";
    doc.body.appendChild(specs);

    const handle = startEngagementTracker({
      pageType: "product",
      url: PRODUCT_URL,
      thresholds: FAST_THRESHOLDS,
      clock: () => now,
      scrollThrottleMs: 50,
      tickIntervalMs: 100,
      onThresholdReached,
    }, doc, win);
    stopHandle = handle.stop;

    now = 500;
    await vi.advanceTimersByTimeAsync(100);
    expect(onThresholdReached).not.toHaveBeenCalled();
    expect(handle.getState().active.activeMs).toBeGreaterThanOrEqual(500);

    now = 600;
    specs.click();
    expect(onThresholdReached).toHaveBeenCalledTimes(1);
    expect(onThresholdReached).toHaveBeenCalledWith({
      pageType: "product",
      url: PRODUCT_URL,
      reason: "product-threshold-met",
    });
  });

  it("jank smoke: passive listeners and one scroll flush per throttle window", async () => {
    const { win, doc } = mountFixtureIntoDocument("article-jsonld", {
      innerHeight: 500,
      scrollHeight: 2000,
      scrollY: 0,
    });

    const winAdd = vi.spyOn(win, "addEventListener");
    const docAdd = vi.spyOn(doc, "addEventListener");
    const onThresholdReached = vi.fn();

    const handle = startEngagementTracker({
      pageType: "article",
      url: ARTICLE_URL,
      thresholds: FAST_THRESHOLDS,
      clock: () => now,
      scrollThrottleMs: 100,
      tickIntervalMs: 5_000,
      onThresholdReached,
    }, doc, win);
    stopHandle = handle.stop;

    expect(winAdd).toHaveBeenCalledWith(
      "scroll",
      expect.any(Function),
      expect.objectContaining({ passive: true, capture: true }),
    );
    expect(docAdd).toHaveBeenCalledWith(
      "click",
      expect.any(Function),
      expect.objectContaining({ passive: true, capture: true }),
    );
    expect(docAdd).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
      expect.objectContaining({ passive: true }),
    );

    const depthBeforeBurst = handle.getState().scrollDepth;
    for (let i = 1; i <= 40; i += 1) {
      Object.defineProperty(win, "scrollY", {
        configurable: true,
        writable: true,
        value: i * 10,
      });
      win.dispatchEvent(new Event("scroll"));
    }
    expect(handle.getState().scrollDepth).toBe(depthBeforeBurst);

    now = 100;
    await vi.advanceTimersByTimeAsync(100);
    expect(handle.getState().scrollDepth).toBeCloseTo(
      computeScrollDepth({
        scrollY: 400,
        viewportHeight: 500,
        scrollHeight: 2000,
      }),
    );
  });
});
