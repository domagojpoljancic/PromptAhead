/**
 * Pure JSON-LD normalization. Page markup is untrusted input, so every access
 * is defensive: malformed blocks are dropped, not repaired, and traversal is
 * bounded so a hostile graph cannot blow up the service worker.
 */

export type JsonLdNode = Record<string, unknown>;

const MAX_NODES = 80;
/** Containers that hold further entities rather than describing one. */
const NESTED_KEYS = ["@graph", "mainEntity", "itemListElement", "item"] as const;

const SCHEMA_PREFIX = /^https?:\/\/(www\.)?schema\.org\//i;

function isPlainObject(value: unknown): value is JsonLdNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Flattens `@graph`, `mainEntity` and `ItemList` members into one node list. */
export function parseJsonLdNodes(blocks: readonly string[]): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const queue: unknown[] = [];

  for (const block of blocks) {
    try {
      queue.push(JSON.parse(block));
    } catch {
      // A single broken block must not lose the others.
    }
  }

  while (queue.length > 0 && nodes.length < MAX_NODES) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, MAX_NODES));
      continue;
    }
    if (!isPlainObject(current)) {
      continue;
    }

    nodes.push(current);
    for (const key of NESTED_KEYS) {
      const nested = current[key];
      if (nested !== undefined) {
        queue.push(nested);
      }
    }
  }

  return nodes;
}

/** `@type` values, lowercased and stripped of the schema.org prefix. */
export function jsonLdTypes(node: JsonLdNode): string[] {
  const raw = node["@type"];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(SCHEMA_PREFIX, "").trim().toLowerCase());
}

export function hasJsonLdType(node: JsonLdNode, wanted: ReadonlySet<string>): boolean {
  return jsonLdTypes(node).some((type) => wanted.has(type));
}

/**
 * Schema.org values arrive as strings, `{ name }` objects, `{ "@value" }`
 * wrappers or arrays of any of those.
 */
export function jsonLdString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed || undefined;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const resolved = jsonLdString(entry);
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  }
  if (isPlainObject(value)) {
    return jsonLdString(value.name ?? value["@value"] ?? value["@id"]);
  }
  return undefined;
}

export function jsonLdNumber(value: unknown): number | undefined {
  const asString = jsonLdString(value);
  if (asString === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(asString.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** First nested object (or object in an array) under `key`. */
export function jsonLdObject(value: unknown): JsonLdNode | undefined {
  if (Array.isArray(value)) {
    return value.find(isPlainObject);
  }
  return isPlainObject(value) ? value : undefined;
}
