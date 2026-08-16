/**
 * Context inclusion controls (handoff §15 / PRD): users can drop title/URL,
 * page body, selected text, or their note before the prompt is built.
 */

import type { PageContext } from "../shared/types/page-context";

export type ContextInclusion = {
  titleUrl: boolean;
  pageBody: boolean;
  selectedText: boolean;
  userNote: boolean;
  /** DOM-68: expand comparable SOURCE_DATA to the full named product pool. */
  expandNamedProducts?: boolean;
};

export const DEFAULT_CONTEXT_INCLUSION: ContextInclusion = {
  titleUrl: true,
  pageBody: true,
  selectedText: true,
  userNote: true,
  expandNamedProducts: false,
};

/** Apply inclusion flags to a captured page — empty strings omit via the renderer. */
export function applyContextInclusion(
  pageContext: PageContext,
  inclusion: ContextInclusion,
): PageContext {
  const next: PageContext = {
    schemaVersion: pageContext.schemaVersion,
    pageType: pageContext.pageType,
    language: pageContext.language,
    title: inclusion.titleUrl ? pageContext.title : "",
    url: inclusion.titleUrl ? pageContext.url : "",
  };

  if (inclusion.pageBody) {
    if (pageContext.description) {
      next.description = pageContext.description;
    }
    if (pageContext.article) {
      next.article = pageContext.article;
    }
    if (pageContext.product) {
      next.product = pageContext.product;
    }
    if (pageContext.generic) {
      next.generic = pageContext.generic;
    }
    if (
      inclusion.expandNamedProducts === true &&
      pageContext.expandableNamedSet &&
      pageContext.expandableNamedSet.names.length >= 2
    ) {
      next.comparableSet = {
        kind: pageContext.expandableNamedSet.kind,
        names: [...pageContext.expandableNamedSet.names],
      };
      next.expandableNamedSet = pageContext.expandableNamedSet;
    } else if (pageContext.comparableSet) {
      next.comparableSet = pageContext.comparableSet;
    }
  }

  if (inclusion.selectedText && pageContext.selectedText) {
    next.selectedText = pageContext.selectedText;
  }

  return next;
}

export function applyUserNoteInclusion(
  userNote: string,
  inclusion: ContextInclusion,
): string {
  return inclusion.userNote ? userNote : "";
}

/** Whether a capture has content for a given inclusion toggle. */
export function inclusionAvailability(pageContext: PageContext): {
  titleUrl: boolean;
  pageBody: boolean;
  selectedText: boolean;
} {
  const hasBody = Boolean(
    pageContext.description ||
      pageContext.article ||
      pageContext.product ||
      pageContext.generic ||
      pageContext.comparableSet,
  );
  return {
    titleUrl: Boolean(pageContext.title || pageContext.url),
    pageBody: hasBody,
    selectedText: Boolean(pageContext.selectedText),
  };
}

/**
 * At least one page-sourced toggle must stay on. A note alone (or nothing)
 * yields a useless `<SOURCE_DATA>` with only PAGE_TYPE / LANGUAGE.
 */
export function hasUsableSourceInclusion(
  inclusion: ContextInclusion,
  availability: ReturnType<typeof inclusionAvailability>,
): boolean {
  return (
    (inclusion.titleUrl && availability.titleUrl) ||
    (inclusion.pageBody && availability.pageBody) ||
    (inclusion.selectedText && availability.selectedText)
  );
}

export const EMPTY_SOURCE_INCLUSION_MESSAGE =
  "Select at least Title & URL, Page context, or Selected text before building.";
