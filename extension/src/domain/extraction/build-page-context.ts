/**
 * Pure `RawPageSnapshot` → `PageContext` (handoff §31, schemaVersion 1).
 *
 * Everything here is deterministic and DOM-free so it can run in the service
 * worker and be tested against HTML fixtures. Missing fields stay absent
 * instead of being guessed, and the compactness caps are enforced here rather
 * than in the page so a hostile page cannot inflate what Nano later sees.
 */

import {
  ARTICLE_JSON_LD_TYPES,
  PRODUCT_JSON_LD_TYPES,
  classifyPage,
  type ClassificationResult,
} from "../classification";
import {
  EXTRACTION_CAPS,
  PAGE_CONTEXT_SCHEMA_VERSION,
  type ArticleContext,
  type GenericContext,
  type PageContext,
  type ProductContext,
  type ProductSpecification,
} from "../../shared/types/page-context";
import { extractComparableSet } from "./comparable-set";
import {
  hasJsonLdType,
  jsonLdNumber,
  jsonLdObject,
  jsonLdString,
  parseJsonLdNodes,
  type JsonLdNode,
} from "./json-ld";
import type { RawPageSnapshot } from "./snapshot";

const MAX_EXCERPT_CHARS = 600;
const MAX_HEADING_CHARS = 140;
const MAX_DESCRIPTION_CHARS = 400;
const MAX_SPEC_NAME_CHARS = 60;
const MAX_SPEC_VALUE_CHARS = 160;
const MAX_SELECTED_TEXT_CHARS = 1200;
/** Below this there is no room left for a useful fragment. */
const MIN_USEFUL_CHARS = 60;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Truncates on a word boundary when possible and marks the cut. */
function clampText(value: string, maxChars: number): string {
  const text = normalizeWhitespace(value);
  if (text.length <= maxChars) {
    return text;
  }
  const head = text.slice(0, maxChars - 1);
  const lastSpace = head.lastIndexOf(" ");
  return `${(lastSpace > maxChars * 0.6 ? head.slice(0, lastSpace) : head).trimEnd()}…`;
}

/**
 * One shared character budget for every piece of page text we keep, so the
 * total stays inside the 4–6k window regardless of which section is populated.
 */
function createTextBudget(total: number) {
  let remaining = total;
  return {
    take(value: string, maxChars: number): string | null {
      if (remaining < MIN_USEFUL_CHARS) {
        return null;
      }
      const text = clampText(value, Math.min(maxChars, remaining));
      if (!text) {
        return null;
      }
      remaining -= text.length;
      return text;
    },
    get remaining(): number {
      return remaining;
    },
  };
}

type TextBudget = ReturnType<typeof createTextBudget>;

function metaLookup(snapshot: RawPageSnapshot): (...keys: string[]) => string {
  const byKey = new Map(snapshot.metaTags.map((tag) => [tag.key, tag.content]));
  return (...keys: string[]) => {
    for (const key of keys) {
      const value = byKey.get(key);
      if (value) {
        return value;
      }
    }
    return "";
  };
}

function findNode(
  nodes: readonly JsonLdNode[],
  types: ReadonlySet<string>,
): JsonLdNode | undefined {
  return nodes.find((node) => hasJsonLdType(node, types));
}

function countNodes(nodes: readonly JsonLdNode[], types: ReadonlySet<string>): number {
  return nodes.filter((node) => hasJsonLdType(node, types)).length;
}

function resolveLanguage(snapshot: RawPageSnapshot, meta: (...k: string[]) => string) {
  const candidate =
    snapshot.documentLang || meta("og:locale", "language", "content-language");
  const normalized = candidate.replace("_", "-").trim();
  // `en` keeps prompts in a usable language when a page declares nothing.
  return normalized || "en";
}

function takeHeadings(snapshot: RawPageSnapshot, budget: TextBudget): string[] {
  const headings: string[] = [];
  for (const heading of snapshot.headings) {
    if (headings.length >= EXTRACTION_CAPS.headings) {
      break;
    }
    const text = budget.take(heading.text, MAX_HEADING_CHARS);
    if (text) {
      headings.push(text);
    }
  }
  return headings;
}

function takeExcerpts(
  snapshot: RawPageSnapshot,
  budget: TextBudget,
  max: number,
): string[] {
  const excerpts: string[] = [];
  for (const block of snapshot.textBlocks) {
    if (excerpts.length >= max) {
      break;
    }
    const text = budget.take(block, MAX_EXCERPT_CHARS);
    if (text) {
      excerpts.push(text);
    }
  }
  return excerpts;
}

/** `https://schema.org/InStock` → `InStock`. */
function shortSchemaValue(value: string | undefined): string | undefined {
  return value?.replace(/^https?:\/\/(www\.)?schema\.org\//i, "");
}

function buildArticleContext(
  snapshot: RawPageSnapshot,
  node: JsonLdNode | undefined,
  meta: (...keys: string[]) => string,
  budget: TextBudget,
): ArticleContext {
  const publisher =
    jsonLdString(node?.publisher) || meta("og:site_name", "application-name");
  const author = jsonLdString(node?.author) || meta("author", "article:author");
  const publishedAt =
    jsonLdString(node?.datePublished) ||
    meta("article:published_time", "datepublished", "date");

  return {
    ...(publisher ? { publisher: clampText(publisher, 120) } : {}),
    ...(author ? { author: clampText(author, 120) } : {}),
    ...(publishedAt ? { publishedAt: clampText(publishedAt, 40) } : {}),
    headings: takeHeadings(snapshot, budget),
    excerpts: takeExcerpts(snapshot, budget, EXTRACTION_CAPS.articleExcerpts),
  };
}

function collectSpecifications(
  snapshot: RawPageSnapshot,
  node: JsonLdNode | undefined,
  budget: TextBudget,
): ProductSpecification[] {
  const specs: ProductSpecification[] = [];
  const seen = new Set<string>();

  const add = (rawName: unknown, rawValue: unknown): void => {
    if (specs.length >= EXTRACTION_CAPS.productSpecifications) {
      return;
    }
    const name = jsonLdString(rawName);
    const value = jsonLdString(rawValue);
    if (!name || !value || seen.has(name.toLowerCase())) {
      return;
    }
    const budgetedValue = budget.take(value, MAX_SPEC_VALUE_CHARS);
    if (!budgetedValue) {
      return;
    }
    seen.add(name.toLowerCase());
    specs.push({ name: clampText(name, MAX_SPEC_NAME_CHARS), value: budgetedValue });
  };

  const additional = node?.additionalProperty;
  const properties = Array.isArray(additional) ? additional : [additional];
  for (const property of properties) {
    const propertyNode = jsonLdObject(property);
    if (propertyNode) {
      add(propertyNode.name, propertyNode.value);
    }
  }

  for (const candidate of snapshot.specCandidates) {
    add(candidate.name, candidate.value);
  }

  return specs;
}

function buildProductContext(
  snapshot: RawPageSnapshot,
  node: JsonLdNode | undefined,
  meta: (...keys: string[]) => string,
  budget: TextBudget,
): ProductContext {
  const offer = jsonLdObject(node?.offers);
  const rating = jsonLdObject(node?.aggregateRating);

  const brand = jsonLdString(node?.brand) || meta("product:brand", "og:brand");
  const model = jsonLdString(node?.model ?? node?.mpn ?? node?.sku);
  const category = jsonLdString(node?.category) || meta("product:category");
  const price =
    jsonLdString(offer?.price ?? offer?.lowPrice) ||
    meta("product:price:amount", "og:price:amount");
  const currency =
    jsonLdString(offer?.priceCurrency) ||
    meta("product:price:currency", "og:price:currency");
  const availability =
    shortSchemaValue(jsonLdString(offer?.availability)) ||
    shortSchemaValue(meta("product:availability", "og:availability"));
  const ratingValue = jsonLdNumber(rating?.ratingValue);
  const reviewCount = jsonLdNumber(rating?.reviewCount ?? rating?.ratingCount);

  // Specs before excerpts: on a product page the table is the useful part.
  const specifications = collectSpecifications(snapshot, node, budget);

  return {
    ...(brand ? { brand: clampText(brand, 80) } : {}),
    ...(model ? { model: clampText(model, 80) } : {}),
    ...(category ? { category: clampText(category, 80) } : {}),
    ...(price ? { price: clampText(price, 40) } : {}),
    ...(currency ? { currency: clampText(currency, 10) } : {}),
    ...(availability ? { availability: clampText(availability, 40) } : {}),
    ...(ratingValue !== undefined ? { rating: ratingValue } : {}),
    ...(reviewCount !== undefined ? { reviewCount } : {}),
    specifications,
    excerpts: takeExcerpts(snapshot, budget, EXTRACTION_CAPS.productExcerpts),
  };
}

function buildGenericContext(
  snapshot: RawPageSnapshot,
  budget: TextBudget,
): GenericContext {
  return {
    headings: takeHeadings(snapshot, budget),
    excerpts: takeExcerpts(snapshot, budget, EXTRACTION_CAPS.articleExcerpts),
  };
}

export type PageContextBuild = {
  pageContext: PageContext;
  classification: ClassificationResult;
};

export function buildPageContextWithReason(
  snapshot: RawPageSnapshot,
): PageContextBuild {
  const meta = metaLookup(snapshot);
  const nodes = parseJsonLdNodes(snapshot.jsonLdBlocks);
  const productNode = findNode(nodes, PRODUCT_JSON_LD_TYPES);
  const articleNode = findNode(nodes, ARTICLE_JSON_LD_TYPES);
  const ogType = meta("og:type").toLowerCase();

  const classification = classifyPage({
    url: snapshot.url,
    productNodeCount: countNodes(nodes, PRODUCT_JSON_LD_TYPES),
    hasArticleNode: Boolean(articleNode),
    ogType,
    hasArticleMeta: Boolean(meta("article:published_time", "article:section")),
    hasProductMeta: Boolean(meta("product:price:amount", "og:price:amount")),
    microdataProductCount: snapshot.microdataProductCount,
    hasArticleElement: snapshot.hasArticleElement,
    articleTextChars: snapshot.articleTextChars,
    hasTimeElement: snapshot.hasTimeElement,
  });

  const budget = createTextBudget(EXTRACTION_CAPS.totalCharacters);

  const title =
    meta("og:title") ||
    snapshot.title ||
    jsonLdString(articleNode?.headline ?? productNode?.name) ||
    snapshot.url;

  const description =
    meta("og:description", "description", "twitter:description") ||
    jsonLdString(articleNode?.description ?? productNode?.description) ||
    "";

  const selectedText = snapshot.selectedText
    ? clampText(snapshot.selectedText, MAX_SELECTED_TEXT_CHARS)
    : "";

  const comparableSet = extractComparableSet(nodes, snapshot.productNameCandidates);

  const pageContext: PageContext = {
    schemaVersion: PAGE_CONTEXT_SCHEMA_VERSION,
    pageType: classification.pageType,
    language: resolveLanguage(snapshot, meta),
    title: clampText(title, 200),
    url: snapshot.url,
    ...(description
      ? { description: clampText(description, MAX_DESCRIPTION_CHARS) }
      : {}),
    ...(selectedText ? { selectedText } : {}),
    ...(comparableSet ? { comparableSet } : {}),
  };

  switch (classification.pageType) {
    case "article":
      pageContext.article = buildArticleContext(snapshot, articleNode, meta, budget);
      break;
    case "product":
      pageContext.product = buildProductContext(snapshot, productNode, meta, budget);
      break;
    case "generic":
      pageContext.generic = buildGenericContext(snapshot, budget);
      break;
  }

  return { pageContext, classification };
}

export function buildPageContext(snapshot: RawPageSnapshot): PageContext {
  return buildPageContextWithReason(snapshot).pageContext;
}

/** Total page-derived text, used by tests to police the 4–6k budget. */
export function countContextCharacters(pageContext: PageContext): number {
  const section = pageContext.article ?? pageContext.generic;
  const parts: string[] = [
    ...(section?.headings ?? []),
    ...(section?.excerpts ?? []),
    ...(pageContext.product?.excerpts ?? []),
    ...(pageContext.product?.specifications ?? []).map((spec) => spec.value),
  ];
  return parts.reduce((total, part) => total + part.length, 0);
}
