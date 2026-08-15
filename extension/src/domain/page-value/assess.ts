/**
 * Usefulness gate: is this page worth prompting from?
 *
 * Separate from sensitive-page privacy (DOM-37 / DOM-39). Low-value pages
 * still allow a selection-only Manual workflow when the user highlights text.
 */

import { looksLikeProductListing } from "../classification";
import {
  EXTRACTION_CAPS,
  type PageContext,
} from "../../shared/types/page-context";
import { isAppOrEditorHost } from "./hosts";

export type PromptValueReason =
  | "app-or-editor"
  | "site-home"
  | "listing-or-search"
  | "thin-content"
  | "worth-prompting";

export type PromptValueAssessment = {
  worthPrompting: boolean;
  reason: PromptValueReason;
};

const NEWS_SECTION_SEGMENTS: ReadonlySet<string> = new Set([
  "section",
  "sections",
  "topic",
  "topics",
  "tag",
  "tags",
  "archive",
  "latest",
]);

/** Detail slug under a section — same heuristic as product listings. */
const DETAIL_SLUG = /\d{3,}|[a-z0-9]{6,}-[a-z0-9]/;

const THIN_EXCERPT_CHARS = 200;

function looksLikeNewsSectionListing(url: string): boolean {
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

  return segments.some((segment, index) => {
    if (!NEWS_SECTION_SEGMENTS.has(segment)) {
      return false;
    }
    const next = segments[index + 1];
    return next === undefined || !DETAIL_SLUG.test(next);
  });
}

function isSiteHome(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  return path === "/" && parsed.search === "";
}

function isListingOrSearch(url: string): boolean {
  return looksLikeProductListing(url) || looksLikeNewsSectionListing(url);
}

function excerptCharCount(pageContext: PageContext): number {
  const section = pageContext.article ?? pageContext.generic;
  const excerpts = [
    ...(section?.excerpts ?? []),
    ...(pageContext.product?.excerpts ?? []),
  ];
  return excerpts.reduce((total, part) => total + part.length, 0);
}

function headingCount(pageContext: PageContext): number {
  const section = pageContext.article ?? pageContext.generic;
  return section?.headings.length ?? 0;
}

function isThinContent(pageContext: PageContext): boolean {
  if (pageContext.pageType !== "generic") {
    return false;
  }
  return (
    headingCount(pageContext) === 0 &&
    excerptCharCount(pageContext) < THIN_EXCERPT_CHARS
  );
}

/**
 * URL-only assessment — safe before extraction and from the content script.
 * Does not apply the thin-content rule (needs PageContext).
 */
export function assessUrlPromptValue(url: string): PromptValueAssessment {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { worthPrompting: false, reason: "thin-content" };
  }

  if (isAppOrEditorHost(parsed.hostname)) {
    return { worthPrompting: false, reason: "app-or-editor" };
  }
  if (isSiteHome(url)) {
    return { worthPrompting: false, reason: "site-home" };
  }
  if (isListingOrSearch(url)) {
    return { worthPrompting: false, reason: "listing-or-search" };
  }
  return { worthPrompting: true, reason: "worth-prompting" };
}

/** Full assessment after extraction — URL rules, thin-content, comparable sets. */
export function assessPagePromptValue(
  pageContext: PageContext,
): PromptValueAssessment {
  // Small named lists (2–10) are worth prompting even on listing URLs (DOM-64).
  if (hasComparableSet(pageContext)) {
    return { worthPrompting: true, reason: "worth-prompting" };
  }

  const fromUrl = assessUrlPromptValue(pageContext.url);
  if (!fromUrl.worthPrompting) {
    return fromUrl;
  }
  if (isThinContent(pageContext)) {
    return { worthPrompting: false, reason: "thin-content" };
  }
  return { worthPrompting: true, reason: "worth-prompting" };
}

function hasComparableSet(pageContext: PageContext): boolean {
  const set = pageContext.comparableSet;
  if (!set) {
    return false;
  }
  const { comparableSetMin, comparableSetMax } = EXTRACTION_CAPS;
  return (
    set.names.length >= comparableSetMin && set.names.length <= comparableSetMax
  );
}
