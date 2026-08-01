import { describe, expect, it } from "vitest";

import {
  buildPageContext,
  buildPageContextWithReason,
  collectPageSnapshotInPage,
  countContextCharacters,
  parseJsonLdNodes,
  EXTRACTION_CAPS,
  isPageContext,
  type PageType,
} from "../../extension/src/domain/extraction";
import { looksLikeProductListing } from "../../extension/src/domain/classification";
import {
  readFixture,
  snapshotFromFixture,
  snapshotFromHtml,
} from "./helpers/fixture-dom";

type FixtureCase = {
  fixture: string;
  url: string;
  expected: PageType;
};

/** Subset of handoff §34 — one page shape per classification branch. */
const FIXTURES: FixtureCase[] = [
  {
    fixture: "article-jsonld",
    url: "https://news.example.com/2026/03/eu-ai-act",
    expected: "article",
  },
  {
    fixture: "blog-no-metadata",
    url: "https://blog.example.dev/posts/no-bundler",
    expected: "article",
  },
  {
    fixture: "product-jsonld",
    url: "https://shop.example.com/products/aurora-14",
    expected: "product",
  },
  {
    fixture: "product-open-graph",
    url: "https://gear.example.com/p/trailhead-40l",
    expected: "product",
  },
  {
    fixture: "product-list",
    url: "https://shop.example.com/category/laptops",
    expected: "generic",
  },
  {
    fixture: "docs-generic",
    url: "https://developer.example.com/docs/extensions/reference/scripting",
    expected: "generic",
  },
];

function contextFor(fixtureCase: FixtureCase) {
  return buildPageContext(snapshotFromFixture(fixtureCase.fixture, fixtureCase.url));
}

describe("classification on HTML fixtures", () => {
  it.each(FIXTURES)("classifies $fixture as $expected", (fixtureCase) => {
    expect(contextFor(fixtureCase).pageType).toBe(fixtureCase.expected);
  });

  it("meets the DOM-13 ≥90% bar on this fixture set", () => {
    const correct = FIXTURES.filter(
      (fixtureCase) => contextFor(fixtureCase).pageType === fixtureCase.expected,
    ).length;

    expect(correct / FIXTURES.length).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps a product-list page generic rather than one product", () => {
    const listing = FIXTURES[4];
    const { pageContext, classification } = buildPageContextWithReason(
      snapshotFromFixture(listing.fixture, listing.url),
    );

    expect(pageContext.pageType).toBe("generic");
    expect(pageContext.product).toBeUndefined();
    expect(classification.reason).toBe("multiple-product-nodes");
  });

  it("recognises listing URLs without help from markup", () => {
    expect(looksLikeProductListing("https://shop.example.com/category/laptops")).toBe(
      true,
    );
    expect(looksLikeProductListing("https://shop.example.com/search?q=laptop")).toBe(
      true,
    );
    expect(looksLikeProductListing("https://shop.example.com/collections/new")).toBe(
      true,
    );
    expect(looksLikeProductListing("https://shop.example.com/products")).toBe(true);
    expect(looksLikeProductListing("https://shop.example.com/products/aurora-14")).toBe(
      false,
    );
    expect(looksLikeProductListing("https://news.example.com/2026/03/eu-ai-act")).toBe(
      false,
    );
    expect(looksLikeProductListing("not-a-url")).toBe(false);
  });
});

describe("article extraction", () => {
  const pageContext = contextFor(FIXTURES[0]);

  it("produces a valid v1 PageContext", () => {
    expect(isPageContext(pageContext)).toBe(true);
    expect(pageContext).toMatchObject({
      schemaVersion: 1,
      pageType: "article",
      language: "en",
      title: "EU AI Act enters force",
      url: "https://news.example.com/2026/03/eu-ai-act",
    });
  });

  it("carries publication metadata from JSON-LD", () => {
    expect(pageContext.article).toMatchObject({
      publisher: "Example News",
      author: "Ana Kovač",
      publishedAt: "2026-03-02T08:00:00Z",
    });
  });

  it("honours the heading and excerpt caps", () => {
    expect(pageContext.article?.headings.length).toBe(EXTRACTION_CAPS.headings);
    expect(pageContext.article?.excerpts.length).toBe(EXTRACTION_CAPS.articleExcerpts);
  });

  it("drops navigation, sidebars, footers and hidden text", () => {
    const serialized = JSON.stringify(pageContext);

    expect(serialized).not.toContain("HIDDEN-TRACKER-TEXT");
    expect(serialized).not.toContain("Sponsored");
    expect(serialized).not.toContain("All rights reserved");
    expect(serialized).not.toContain("World news and international politics");
  });

  it("normalizes whitespace in everything it keeps", () => {
    const texts = [
      ...(pageContext.article?.headings ?? []),
      ...(pageContext.article?.excerpts ?? []),
    ];

    expect(texts.length).toBeGreaterThan(0);
    for (const text of texts) {
      expect(text).toBe(text.trim());
      expect(text).not.toMatch(/\s{2,}|\n/);
    }
  });
});

describe("product extraction", () => {
  const pageContext = contextFor(FIXTURES[2]);

  it("reads offer, rating and language details", () => {
    expect(pageContext.language).toBe("de");
    expect(pageContext.product).toMatchObject({
      brand: "Aurora",
      model: "AUR-14-2026",
      category: "Computers > Laptops",
      price: "1299.00",
      currency: "EUR",
      availability: "InStock",
      rating: 4.4,
      reviewCount: 218,
    });
  });

  it("merges JSON-LD properties with on-page spec tables", () => {
    const specNames = pageContext.product?.specifications.map((spec) => spec.name);

    expect(specNames).toContain("Display");
    expect(specNames).toContain("Processor");
    expect(specNames).toContain("Charger");
    expect(pageContext.product?.specifications.length).toBeLessThanOrEqual(
      EXTRACTION_CAPS.productSpecifications,
    );
  });

  it("caps product excerpts", () => {
    expect(pageContext.product?.excerpts.length).toBeLessThanOrEqual(
      EXTRACTION_CAPS.productExcerpts,
    );
  });

  it("falls back to Open Graph product metadata", () => {
    const openGraph = contextFor(FIXTURES[3]);

    expect(openGraph.product).toMatchObject({
      brand: "Trailhead",
      price: "149.95",
      currency: "USD",
      availability: "in stock",
    });
  });
});

describe("compactness and safety", () => {
  it.each(FIXTURES)("never extracts form values from $fixture", (fixtureCase) => {
    expect(JSON.stringify(contextFor(fixtureCase))).not.toContain("SECRET-");
  });

  it.each(FIXTURES)("stays inside the text budget on $fixture", (fixtureCase) => {
    expect(countContextCharacters(contextFor(fixtureCase))).toBeLessThanOrEqual(
      EXTRACTION_CAPS.totalCharacters,
    );
  });

  it("truncates a page that would blow the 4–6k budget", () => {
    const sections = [...Array(30).keys()].map((index) => {
      const paragraph =
        `Finding ${index}: ` +
        `lorem ipsum dolor sit amet consectetur adipiscing elit ${index}. `.repeat(40);
      return `<h2>Section ${index} of the very long report</h2><p>${paragraph}</p>`;
    });
    const html = `<!doctype html><html lang="en"><head><title>Huge</title></head><body><main>${sections.join(
      "",
    )}</main></body></html>`;

    const pageContext = buildPageContext(
      snapshotFromHtml(html, "https://example.com/report"),
    );
    const total = countContextCharacters(pageContext);

    expect(pageContext.generic?.headings.length).toBe(EXTRACTION_CAPS.headings);
    expect(total).toBeLessThanOrEqual(EXTRACTION_CAPS.totalCharacters);
    expect(total).toBeGreaterThan(2000);
    expect(pageContext.generic?.excerpts.some((text) => text.endsWith("…"))).toBe(true);
  });

  it("caps specifications at twelve", () => {
    const rows = [...Array(20).keys()]
      .map((index) => `<tr><th>Property ${index}</th><td>Value ${index}</td></tr>`)
      .join("");
    const html = `<!doctype html><html lang="en"><head><title>Widget</title>
      <meta property="og:type" content="product" />
      <script type="application/ld+json">{"@type":"Product","name":"Widget"}</script>
      </head><body><main><table>${rows}</table></main></body></html>`;

    const pageContext = buildPageContext(
      snapshotFromHtml(html, "https://example.com/p/widget"),
    );

    expect(pageContext.product?.specifications.length).toBe(
      EXTRACTION_CAPS.productSpecifications,
    );
  });

  /**
   * `chrome.scripting.executeScript` injects the function's source text, not a
   * closure. Rebuilding it in global scope fails loudly if anyone gives the
   * collector an import or a module-scope constant.
   */
  it("still runs after being stringified the way executeScript injects it", () => {
    const injected = new Function(
      `return (${collectPageSnapshotInPage.toString()})`,
    )() as typeof collectPageSnapshotInPage;

    const snapshot = snapshotFromHtml(
      readFixture("product-jsonld"),
      "https://shop.example.com/products/aurora-14",
      injected,
    );

    expect(buildPageContext(snapshot).pageType).toBe("product");
  });

  it("survives malformed JSON-LD instead of failing extraction", () => {
    const nodes = parseJsonLdNodes(['{"@type":"Product"', '{"@type":"NewsArticle"}']);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.["@type"]).toBe("NewsArticle");
  });
});
