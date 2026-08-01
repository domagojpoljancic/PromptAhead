/**
 * Page classification v1 — deterministic, metadata-first, no model involved.
 *
 * Signals are computed by the extraction domain so this stays a pure decision
 * table that is cheap to test against HTML fixtures. When signals disagree the
 * safe answer is `generic`: a wrong `product` on a category page produces
 * confidently wrong suggestions, a `generic` merely produces duller ones.
 */

import type { PageType } from "../../shared/types/page-context";

export type ClassificationSignals = {
  url: string;
  /** Product / ProductGroup nodes found anywhere in the JSON-LD graph. */
  productNodeCount: number;
  hasArticleNode: boolean;
  /** `og:type`, lowercased; empty when absent. */
  ogType: string;
  hasArticleMeta: boolean;
  hasProductMeta: boolean;
  microdataProductCount: number;
  hasArticleElement: boolean;
  articleTextChars: number;
  hasTimeElement: boolean;
};

export type ClassificationResult = {
  pageType: PageType;
  /** Stable identifier for the rule that fired — surfaced in dev logging. */
  reason: string;
};

export const ARTICLE_JSON_LD_TYPES: ReadonlySet<string> = new Set([
  "article",
  "newsarticle",
  "blogposting",
  "techarticle",
  "scholarlyarticle",
  "reportagenewsarticle",
  "analysisnewsarticle",
  "opinionnewsarticle",
  "backgroundnewsarticle",
  "liveblogposting",
  "report",
]);

export const PRODUCT_JSON_LD_TYPES: ReadonlySet<string> = new Set([
  "product",
  "productgroup",
  "productmodel",
  "individualproduct",
  "vehicle",
]);

const LISTING_SEGMENTS: ReadonlySet<string> = new Set([
  "browse",
  "c",
  "catalog",
  "categories",
  "category",
  "collection",
  "collections",
  "search",
  "shop",
]);

const LISTING_QUERY_KEYS = ["q", "query", "search", "k", "keyword", "category"];

/** Blog-ish OG types; `article` covers the vast majority. */
const ARTICLE_OG_TYPES = ["article", "blog", "news", "text"];

/**
 * Category, search and collection pages carry the same Product markup as a
 * detail page, so URL shape is the cheapest reliable separator.
 */
export function looksLikeProductListing(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const segments = parsed.pathname
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0);

  // "…/products" (plural, nothing after it) is a listing; "…/products/sku" is not.
  if (segments.at(-1) === "products" || segments.at(-1) === "items") {
    return true;
  }

  const hasListingSegment = segments.some((segment, index) => {
    if (!LISTING_SEGMENTS.has(segment)) {
      return false;
    }
    // A detail page under a category still ends in a product slug, so only
    // treat the marker as a listing when it is not immediately followed by one.
    const next = segments[index + 1];
    return next === undefined || !/\d{3,}|[a-z0-9]{6,}-[a-z0-9]/.test(next);
  });
  if (hasListingSegment) {
    return true;
  }

  return LISTING_QUERY_KEYS.some((key) => Boolean(parsed.searchParams.get(key)));
}

export function classifyPage(signals: ClassificationSignals): ClassificationResult {
  const productCount = Math.max(
    signals.productNodeCount,
    signals.microdataProductCount,
  );

  if (productCount > 1) {
    return { pageType: "generic", reason: "multiple-product-nodes" };
  }

  if (looksLikeProductListing(signals.url)) {
    return { pageType: "generic", reason: "listing-url-pattern" };
  }

  if (productCount === 1) {
    return { pageType: "product", reason: "product-json-ld" };
  }

  if (signals.hasArticleNode) {
    return { pageType: "article", reason: "article-json-ld" };
  }

  if (signals.ogType === "product" || signals.hasProductMeta) {
    return { pageType: "product", reason: "product-open-graph" };
  }

  if (ARTICLE_OG_TYPES.some((type) => signals.ogType.startsWith(type))) {
    return { pageType: "article", reason: "article-open-graph" };
  }

  if (signals.hasArticleMeta) {
    return { pageType: "article", reason: "article-meta" };
  }

  // Bare blogs publish no metadata at all: a long <article> with a real
  // timestamp is the most conservative stand-in we can justify.
  if (signals.hasArticleElement && signals.articleTextChars >= 1000) {
    if (signals.hasTimeElement) {
      return { pageType: "article", reason: "article-element-with-timestamp" };
    }
  }

  return { pageType: "generic", reason: "no-strong-signal" };
}
