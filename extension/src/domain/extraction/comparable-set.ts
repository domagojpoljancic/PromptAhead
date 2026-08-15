/**
 * Detect a small named set (2–10 products / articles / items) from JSON-LD
 * and/or DOM product-card titles. Used so short lists can offer “compare these N”
 * instead of empty or generic article-style directions.
 */

import {
  ARTICLE_JSON_LD_TYPES,
  PRODUCT_JSON_LD_TYPES,
} from "../classification";
import { EXTRACTION_CAPS, type ComparableSet } from "../../shared/types/page-context";
import {
  hasJsonLdType,
  jsonLdString,
  type JsonLdNode,
} from "./json-ld";

const MAX_NAME_CHARS = 120;

function clampName(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  return text.length > MAX_NAME_CHARS
    ? `${text.slice(0, MAX_NAME_CHARS - 1).trimEnd()}…`
    : text;
}

function uniqueNames(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
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
    names.push(name);
    if (names.length > EXTRACTION_CAPS.comparableSetMax) {
      break;
    }
  }
  return names;
}

function uniqueJsonLdNames(
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
  return uniqueNames(values);
}

function inComparableWindow(names: readonly string[]): boolean {
  return (
    names.length >= EXTRACTION_CAPS.comparableSetMin &&
    names.length <= EXTRACTION_CAPS.comparableSetMax
  );
}

/**
 * Prefer JSON-LD products, then articles, then DOM product-card titles.
 * Returns undefined when the count is outside the comparable window.
 */
export function extractComparableSet(
  nodes: readonly JsonLdNode[],
  domProductNames: readonly string[] = [],
): ComparableSet | undefined {
  const productNames = uniqueJsonLdNames(nodes, PRODUCT_JSON_LD_TYPES);
  if (inComparableWindow(productNames)) {
    return { kind: "product", names: productNames };
  }

  const articleNames = uniqueJsonLdNames(nodes, ARTICLE_JSON_LD_TYPES);
  if (inComparableWindow(articleNames)) {
    return { kind: "article", names: articleNames };
  }

  const fromDom = uniqueNames(domProductNames);
  if (inComparableWindow(fromDom)) {
    return { kind: "product", names: fromDom };
  }

  return undefined;
}
