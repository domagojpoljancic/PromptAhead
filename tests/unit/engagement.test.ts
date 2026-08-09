// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ARTICLE_THRESHOLD,
  DEFAULT_PRODUCT_THRESHOLD,
  computeScrollDepth,
  createActiveTimeState,
  createEngagementSession,
  evaluateEngagementThreshold,
  guessEngagementPageType,
  isEngagementEligibleUrl,
  isMeaningfulProductInteraction,
  classifyProductInteraction,
  noteFocus,
  noteProductInteraction,
  noteScroll,
  noteVisibility,
  readActiveMs,
  setFocused,
  setVisibility,
  tickEngagement,
} from "../../extension/src/domain/engagement";
import { startEngagementTracker } from "../../extension/src/content/engagement-tracker";

describe("isEngagementEligibleUrl", () => {
  it("allows http(s) pages", () => {
    expect(isEngagementEligibleUrl("https://news.example.com/a")).toBe(true);
    expect(isEngagementEligibleUrl("http://shop.example.com/p/1")).toBe(true);
  });

  it("blocks restricted / sensitive technical origins", () => {
    expect(isEngagementEligibleUrl("chrome://settings")).toBe(false);
    expect(isEngagementEligibleUrl("chrome-extension://abc/options.html")).toBe(
      false,
    );
    expect(isEngagementEligibleUrl("about:blank")).toBe(false);
    expect(isEngagementEligibleUrl("file:///tmp/x.html")).toBe(false);
    expect(isEngagementEligibleUrl("not a url")).toBe(false);
  });
});

describe("computeScrollDepth", () => {
  it("returns 1 when the page fits in the viewport", () => {
    expect(
      computeScrollDepth({ scrollY: 0, viewportHeight: 800, scrollHeight: 600 }),
    ).toBe(1);
  });

  it("measures progress through a tall page", () => {
    // Halfway through a 2000px page with 500px viewport → (500+500)/2000 = 0.5
    expect(
      computeScrollDepth({
        scrollY: 500,
        viewportHeight: 500,
        scrollHeight: 2000,
      }),
    ).toBeCloseTo(0.5);
  });

  it("clamps to [0, 1]", () => {
    expect(
      computeScrollDepth({
        scrollY: 10_000,
        viewportHeight: 800,
        scrollHeight: 2000,
      }),
    ).toBe(1);
    expect(
      computeScrollDepth({
        scrollY: -10,
        viewportHeight: 0,
        scrollHeight: 2000,
      }),
    ).toBe(0);
  });
});

describe("active time", () => {
  it("counts only while visible and focused", () => {
    let state = createActiveTimeState(0, true, true);
    state = setVisibility(state, false, 10_000);
    expect(readActiveMs(state, 10_000)).toBe(10_000);

    state = setVisibility(state, true, 20_000);
    state = setFocused(state, false, 25_000);
    expect(readActiveMs(state, 25_000)).toBe(15_000);

    state = setFocused(state, true, 30_000);
    expect(readActiveMs(state, 40_000)).toBe(25_000);
  });
});

describe("product interaction heuristics", () => {
  it("recognizes media, specs, variants, and reviews", () => {
    expect(
      classifyProductInteraction({
        tagName: "IMG",
        hints: "gallery thumbnail",
      }),
    ).toBe("media");
    expect(
      classifyProductInteraction({
        tagName: "BUTTON",
        hints: "specifications",
      }),
    ).toBe("specs");
    expect(
      classifyProductInteraction({
        tagName: "SELECT",
        hints: "size",
        inProductChrome: true,
      }),
    ).toBe("variant");
    expect(
      classifyProductInteraction({
        tagName: "A",
        hints: "customer reviews",
      }),
    ).toBe("reviews");
  });

  it("ignores cookie / login chrome", () => {
    expect(
      isMeaningfulProductInteraction({
        tagName: "BUTTON",
        hints: "accept cookies",
      }),
    ).toBe(false);
  });
});

describe("evaluateEngagementThreshold", () => {
  it("meets article bar on dwell alone or deep scroll alone", () => {
    expect(
      evaluateEngagementThreshold({
        pageType: "article",
        activeMs: DEFAULT_ARTICLE_THRESHOLD.minActiveMs,
        scrollDepth: 0,
        hasProductInteraction: false,
      }),
    ).toEqual({ met: true, reason: "article-active-time-met" });

    expect(
      evaluateEngagementThreshold({
        pageType: "article",
        activeMs: 0,
        scrollDepth: DEFAULT_ARTICLE_THRESHOLD.minScrollDepth,
        hasProductInteraction: false,
      }),
    ).toEqual({ met: true, reason: "article-scroll-depth-met" });

    expect(
      evaluateEngagementThreshold({
        pageType: "article",
        activeMs: DEFAULT_ARTICLE_THRESHOLD.minActiveMs - 1,
        scrollDepth: DEFAULT_ARTICLE_THRESHOLD.minScrollDepth - 0.01,
        hasProductInteraction: false,
      }),
    ).toEqual({ met: false, reason: "article-threshold-pending" });
  });

  it("requires product dwell plus interaction", () => {
    expect(
      evaluateEngagementThreshold({
        pageType: "product",
        activeMs: DEFAULT_PRODUCT_THRESHOLD.minActiveMs,
        scrollDepth: 0,
        hasProductInteraction: false,
      }).reason,
    ).toBe("product-interaction");

    expect(
      evaluateEngagementThreshold({
        pageType: "product",
        activeMs: DEFAULT_PRODUCT_THRESHOLD.minActiveMs,
        scrollDepth: 0,
        hasProductInteraction: true,
      }),
    ).toEqual({ met: true, reason: "product-threshold-met" });
  });

  it("never meets on generic pages", () => {
    expect(
      evaluateEngagementThreshold({
        pageType: "generic",
        activeMs: 120_000,
        scrollDepth: 1,
        hasProductInteraction: true,
      }).met,
    ).toBe(false);
  });
});

describe("engagement session (once per page)", () => {
  it("fires once for an article after dwell alone", () => {
    let session = createEngagementSession({
      pageType: "article",
      url: "https://news.example.com/story",
      now: 0,
    });

    let result = noteScroll(
      session,
      { scrollY: 0, viewportHeight: 500, scrollHeight: 2000 },
      1_000,
    );
    // shallow scroll alone must not invite
    expect(result.thresholdReached).toBe(false);
    session = result.state;

    result = tickEngagement(session, DEFAULT_ARTICLE_THRESHOLD.minActiveMs);
    expect(result.thresholdReached).toBe(true);
    expect(result.reason).toBe("article-active-time-met");
    session = result.state;

    result = tickEngagement(session, DEFAULT_ARTICLE_THRESHOLD.minActiveMs + 5_000);
    expect(result.thresholdReached).toBe(false);
    expect(session.fired).toBe(true);
  });

  it("fires for an article on deep scroll before dwell", () => {
    const session = createEngagementSession({
      pageType: "article",
      url: "https://news.example.com/story",
      now: 0,
    });

    const result = noteScroll(
      session,
      { scrollY: 1_200, viewportHeight: 500, scrollHeight: 2000 },
      500,
    );
    // depth = (1200+500)/2000 = 0.85 ≥ 2/3
    expect(result.thresholdReached).toBe(true);
    expect(result.reason).toBe("article-scroll-depth-met");
  });

  it("does not count hidden time toward the article dwell bar", () => {
    let session = createEngagementSession({
      pageType: "article",
      url: "https://news.example.com/story",
      now: 0,
    });
    session = noteScroll(
      session,
      { scrollY: 0, viewportHeight: 500, scrollHeight: 2000 },
      0,
    ).state;

    session = noteVisibility(session, false, 5_000).state;
    const result = tickEngagement(session, 60_000);
    expect(result.thresholdReached).toBe(false);
    expect(result.reason).toBe("article-threshold-pending");
  });

  it("fires for a product after dwell + meaningful click", () => {
    let session = createEngagementSession({
      pageType: "product",
      url: "https://shop.example.com/p/1",
      now: 0,
    });

    session = tickEngagement(session, DEFAULT_PRODUCT_THRESHOLD.minActiveMs).state;
    expect(session.fired).toBe(false);

    const result = noteProductInteraction(
      session,
      { tagName: "BUTTON", hints: "view specifications" },
      DEFAULT_PRODUCT_THRESHOLD.minActiveMs + 100,
    );
    expect(result.thresholdReached).toBe(true);
    expect(result.reason).toBe("product-threshold-met");
  });

  it("ignores focus loss via noteFocus without extracting anything", () => {
    const session = createEngagementSession({
      pageType: "article",
      url: "https://news.example.com/story",
      now: 0,
    });
    const result = noteFocus(session, false, 1_000);
    expect(result.thresholdReached).toBe(false);
    // Session API has no extraction side effects — only signal fields.
    expect(Object.keys(result.state).sort()).toEqual(
      [
        "active",
        "fired",
        "hasProductInteraction",
        "lastReason",
        "pageType",
        "scrollDepth",
        "url",
      ].sort(),
    );
  });
});

describe("guessEngagementPageType", () => {
  it("classifies article and product from light DOM hints", () => {
    const article = document.implementation.createHTMLDocument("a");
    article.body.innerHTML = "<article><h1>Story</h1></article>";
    expect(guessEngagementPageType(article, "https://news.example.com/a")).toBe(
      "article",
    );

    const product = document.implementation.createHTMLDocument("p");
    product.head.innerHTML =
      '<meta property="og:type" content="product" />';
    expect(
      guessEngagementPageType(product, "https://shop.example.com/item/1"),
    ).toBe("product");
  });

  it("falls back to generic when unsure", () => {
    const doc = document.implementation.createHTMLDocument("g");
    doc.body.innerHTML = "<div>hello</div>";
    expect(guessEngagementPageType(doc, "https://example.com/")).toBe("generic");
  });

  it("treats /live-news/ URLs and LiveBlogPosting JSON-LD as articles", () => {
    const bare = document.implementation.createHTMLDocument("live");
    bare.body.innerHTML = "<div>updates</div>";
    expect(
      guessEngagementPageType(
        bare,
        "https://edition.cnn.com/2026/08/09/world/live-news/iran-war-trump",
      ),
    ).toBe("article");

    const ld = document.implementation.createHTMLDocument("lb");
    ld.head.innerHTML =
      '<script type="application/ld+json">{"@type":"LiveBlogPosting"}</script>';
    expect(guessEngagementPageType(ld, "https://news.example.com/live")).toBe(
      "article",
    );
  });
});

describe("startEngagementTracker", () => {
  it("no-ops on ineligible origins", () => {
    const onThresholdReached = vi.fn();
    const handle = startEngagementTracker({
      pageType: "article",
      url: "chrome://extensions",
      onThresholdReached,
    });
    expect(handle.getState().active.activeMs).toBe(0);
    handle.stop();
    expect(onThresholdReached).not.toHaveBeenCalled();
  });
});
