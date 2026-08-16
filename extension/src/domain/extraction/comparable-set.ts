/**
 * Detect a small named set (2–10 products / articles / items) from JSON-LD
 * and/or DOM product-card titles. Used so short lists can offer “compare these N”
 * instead of empty or generic article-style directions.
 *
 * When more than 10 named **products** exist, still expose a compact ≤10 set for
 * default compare, plus an expandable pool (≤40) for opt-in (DOM-68).
 */

import {
  ARTICLE_JSON_LD_TYPES,
  PRODUCT_JSON_LD_TYPES,
} from "../classification";
import {
  EXTRACTION_CAPS,
  type ComparableSet,
  type ExpandableNamedSet,
} from "../../shared/types/page-context";
import {
  hasJsonLdType,
  jsonLdString,
  type JsonLdNode,
} from "./json-ld";

const MAX_NAME_CHARS = 120;

export type NamedComparableExtraction = {
  comparableSet?: ComparableSet;
  expandableNamedSet?: ExpandableNamedSet;
};

function clampName(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length > MAX_NAME_CHARS
    ? `${text.slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`
    : text;
}

function uniqueNames(
  values: readonly string[],
  maxNames: number,
): { names: string[]; totalFound: number } {
  const seen = new Set<string>();
  const names: string[] = [];
  let totalFound = 0;
  for (const value of values) {
    const name = clampName(value);
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    totalFound += 1;
    if (names.length < maxNames) {
      names.push(name);
    }
  }
  return { names, totalFound };
}

function collectJsonLdNames(
  nodes: readonly JsonLdNode[],
  types: ReadonlySet<string>,
): string[] {
  const values: string[] = [];
  for (const node of nodes) {
    if (!hasJsonLdType(node, types)) {
      continue;
    }
    const raw = jsonLdString(node.name);
    if (raw) {
      values.push(raw);
    }
  }
  return values;
}

function inComparableWindow(count: number): boolean {
  return (
    count >= EXTRACTION_CAPS.comparableSetMin &&
    count <= EXTRACTION_CAPS.comparableSetMax
  );
}

/**
 * Prefer JSON-LD products, then articles, then DOM product-card titles.
 * Products may also yield an expandable pool when totalFound > 10.
 */
export function extractNamedComparableSets(
  nodes: readonly JsonLdNode[],
  domProductNames: readonly string[] = [],
): NamedComparableExtraction {
  const productRaw = collectJsonLdNames(nodes, PRODUCT_JSON_LD_TYPES);
  const productPool = uniqueNames(
    productRaw,
    EXTRACTION_CAPS.comparableSetExpandMax,
  );
  if (productPool.totalFound >= EXTRACTION_CAPS.comparableSetMin) {
    return buildProductResult(productPool);
  }

  const articleRaw = collectJsonLdNames(nodes, ARTICLE_JSON_LD_TYPES);
  const articlePool = uniqueNames(
    articleRaw,
    EXTRACTION_CAPS.comparableSetMax,
  );
  if (inComparableWindow(articlePool.totalFound)) {
    return {
      comparableSet: { kind: "article", names: articlePool.names },
    };
  }

  const fromDom = uniqueNames(
    domProductNames,
    EXTRACTION_CAPS.comparableSetExpandMax,
  );
  if (fromDom.totalFound >= EXTRACTION_CAPS.comparableSetMin) {
    return buildProductResult(fromDom);
  }

  return {};
}

function buildProductResult(pool: {
  names: string[];
  totalFound: number;
}): NamedComparableExtraction {
  const compact = pool.names.slice(0, EXTRACTION_CAPS.comparableSetMax);
  if (pool.totalFound <= EXTRACTION_CAPS.comparableSetMax) {
    return {
      comparableSet: { kind: "product", names: compact },
    };
  }
  return {
    comparableSet: { kind: "product", names: compact },
    expandableNamedSet: {
      kind: "product",
      names: pool.names,
      totalFound: pool.totalFound,
    },
  };
}

/** @deprecated Prefer extractNamedComparableSets — kept for call-site clarity. */
export function extractComparableSet(
  nodes: readonly JsonLdNode[],
  domProductNames: readonly string[] = [],
): ComparableSet | undefined {
  return extractNamedComparableSets(nodes, domProductNames).comparableSet;
}
