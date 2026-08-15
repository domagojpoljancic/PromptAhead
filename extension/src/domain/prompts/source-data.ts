/**
 * Renders a `PageContext` into the `<SOURCE_DATA>` block (handoff §14 / §30).
 *
 * Page text is hostile input, so the block is built to make breaking out of it
 * impossible rather than unlikely:
 *
 * 1. Invisible characters (control, zero-width, bidi overrides) are dropped —
 *    they are how "hidden" instructions are smuggled past a human reviewer.
 * 2. Every value is collapsed onto a single line, so the closing delimiter is
 *    the only line in the block that can look like a delimiter.
 * 3. Tag-shaped tokens that mimic a delimiter or a chat role are escaped with a
 *    backslash (`</SOURCE_DATA>` → `<\/SOURCE_DATA>`), which breaks the literal
 *    token while keeping every original character visible to the reader.
 *
 * Nothing here paraphrases the page: facts are preserved verbatim, only the
 * framing characters change.
 */

import { EXTRACTION_CAPS, type PageContext } from "../../shared/types/page-context";

export const SOURCE_DATA_OPEN = "<SOURCE_DATA>";
export const SOURCE_DATA_CLOSE = "</SOURCE_DATA>";

/** Per-value ceiling; extraction already clamps, this covers foreign input. */
const MAX_VALUE_CHARS = 800;

/** Total page text inside the block, matching the extraction budget. */
const MAX_BLOCK_CHARS = EXTRACTION_CAPS.totalCharacters;

/** Control characters, minus tab/newline which whitespace collapsing handles. */
const INVISIBLE_CHARS =
  // eslint-disable-next-line no-control-regex -- stripping them is the point
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u206A-\u206F\uFEFF]/g;

/**
 * Tag-shaped tokens that could be read as structure rather than content:
 * our own delimiters plus the role markers chat models are trained on.
 */
const RESERVED_TAG =
  /<(\/?)((?:source_data|end_source_data|source|system_prompt|system|instructions?|prompt|user|assistant|developer|tool|function_call|function)\b[^>]*)>/gi;

export function neutralizeSourceText(value: string): string {
  const withoutInvisibles = value.replace(INVISIBLE_CHARS, "");
  const singleLine = withoutInvisibles.replace(/\s+/g, " ").trim();
  return singleLine.replace(RESERVED_TAG, "<\\$1$2>");
}

function clamp(value: string): string {
  return value.length > MAX_VALUE_CHARS
    ? `${value.slice(0, MAX_VALUE_CHARS - 1).trimEnd()}…`
    : value;
}

export type SourceDataBlock = {
  /** Includes the opening and closing delimiter lines. */
  text: string;
  /** Body lines only, in emission order. */
  lines: string[];
  truncated: boolean;
};

/**
 * Accumulates `KEY: value` lines under a shared character budget so a long
 * page cannot push the useful fields (identity, price, metadata) out.
 */
function createLineWriter() {
  const lines: string[] = [];
  let remaining = MAX_BLOCK_CHARS;
  let truncated = false;

  return {
    add(key: string, rawValue: string | number | undefined): void {
      if (rawValue === undefined || rawValue === "") {
        return;
      }
      const value = clamp(neutralizeSourceText(String(rawValue)));
      if (!value) {
        return;
      }
      if (value.length > remaining) {
        truncated = true;
        return;
      }
      remaining -= value.length;
      lines.push(`${key}: ${value}`);
    },
    get lines(): string[] {
      return lines;
    },
    get truncated(): boolean {
      return truncated;
    },
  };
}

export function renderSourceData(pageContext: PageContext): SourceDataBlock {
  const writer = createLineWriter();

  writer.add("PAGE_TYPE", pageContext.pageType);
  writer.add("LANGUAGE", pageContext.language);
  writer.add("URL", pageContext.url);
  writer.add("TITLE", pageContext.title);
  writer.add("DESCRIPTION", pageContext.description);

  if (pageContext.comparableSet) {
    writer.add("COMPARABLE_KIND", pageContext.comparableSet.kind);
    for (const name of pageContext.comparableSet.names) {
      writer.add("COMPARABLE_ITEM", name);
    }
  }

  const { article, product, generic } = pageContext;

  if (article) {
    writer.add("PUBLISHER", article.publisher);
    writer.add("AUTHOR", article.author);
    writer.add("PUBLISHED", article.publishedAt);
    for (const heading of article.headings) {
      writer.add("HEADING", heading);
    }
    for (const excerpt of article.excerpts) {
      writer.add("EXCERPT", excerpt);
    }
  }

  if (product) {
    writer.add("BRAND", product.brand);
    writer.add("MODEL", product.model);
    writer.add("CATEGORY", product.category);
    writer.add(
      "PRICE",
      [product.price, product.currency].filter(Boolean).join(" ") || undefined,
    );
    writer.add("AVAILABILITY", product.availability);
    writer.add("RATING", product.rating);
    writer.add("REVIEW_COUNT", product.reviewCount);
    for (const spec of product.specifications) {
      writer.add("SPEC", `${spec.name} — ${spec.value}`);
    }
    for (const excerpt of product.excerpts) {
      writer.add("EXCERPT", excerpt);
    }
  }

  if (generic) {
    for (const heading of generic.headings) {
      writer.add("HEADING", heading);
    }
    for (const excerpt of generic.excerpts) {
      writer.add("EXCERPT", excerpt);
    }
  }

  writer.add("SELECTED_TEXT", pageContext.selectedText);

  const { lines, truncated } = writer;
  return {
    text: [SOURCE_DATA_OPEN, ...lines, SOURCE_DATA_CLOSE].join("\n"),
    lines,
    truncated,
  };
}

/**
 * Last line of defence: proves the rendered block has exactly one opening and
 * one closing delimiter, both on their own line. Used by tests and by the
 * builder itself so a future field cannot quietly reintroduce a breakout.
 */
export function isSealedSourceBlock(block: string): boolean {
  const lines = block.split("\n");
  const opens = lines.filter((line) => line.includes(SOURCE_DATA_OPEN)).length;
  const closes = lines.filter((line) => line.includes(SOURCE_DATA_CLOSE)).length;
  return (
    opens === 1 &&
    closes === 1 &&
    lines[0] === SOURCE_DATA_OPEN &&
    lines.at(-1) === SOURCE_DATA_CLOSE
  );
}
