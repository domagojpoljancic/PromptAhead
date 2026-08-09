/**
 * Lightweight page-type guess for engagement (no full extraction).
 * Wrong guesses fall back to `generic`, which never meets thresholds.
 */

import type { PageType } from "../../shared/types/page-context";
import { looksLikeProductListing } from "../classification";

function metaContent(doc: Document, key: string): string {
  const byProperty = doc.querySelector(`meta[property="${key}"]`);
  if (byProperty) {
    return (byProperty.getAttribute("content") ?? "").trim().toLowerCase();
  }
  const byName = doc.querySelector(`meta[name="${key}"]`);
  return (byName?.getAttribute("content") ?? "").trim().toLowerCase();
}

function jsonLdHints(doc: Document): { product: boolean; article: boolean } {
  let product = false;
  let article = false;
  for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = node.textContent ?? "";
    const lower = raw.toLowerCase();
    if (
      lower.includes('"@type":"product"') ||
      lower.includes('"@type": "product"') ||
      lower.includes('"@type":"productgroup"')
    ) {
      product = true;
    }
    if (
      lower.includes('"@type":"article"') ||
      lower.includes('"@type": "article"') ||
      lower.includes('"@type":"newsarticle"') ||
      lower.includes('"@type":"blogposting"') ||
      lower.includes('"@type":"liveblogposting"')
    ) {
      article = true;
    }
  }
  return { product, article };
}

/**
 * Cheap DOM/meta heuristic for Smart engagement bars.
 * Does not build a PageContext and does not call Nano.
 */
export function guessEngagementPageType(
  doc: Document,
  url: string,
): PageType {
  const ogType = metaContent(doc, "og:type");
  const ld = jsonLdHints(doc);
  const microProduct = Boolean(
    doc.querySelector('[itemtype*="Product"], [itemtype*="product"]'),
  );
  const productMeta =
    Boolean(doc.querySelector('meta[property="product:price:amount"]')) ||
    metaContent(doc, "og:type") === "product";

  const productish =
    ld.product ||
    microProduct ||
    productMeta ||
    ogType === "product" ||
    ogType.startsWith("product.");

  if (productish && !looksLikeProductListing(url)) {
    return "product";
  }

  const articleish =
    ld.article ||
    ogType === "article" ||
    ogType === "blog" ||
    ogType === "news" ||
    Boolean(doc.querySelector("article")) ||
    Boolean(doc.querySelector('meta[property="article:published_time"]')) ||
    /\/live-news\//i.test(url);

  if (articleish) {
    return "article";
  }

  return "generic";
}
