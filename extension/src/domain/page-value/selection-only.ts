import {
  PAGE_CONTEXT_SCHEMA_VERSION,
  type PageContext,
} from "../../shared/types/page-context";

/**
 * Keep identity + selection only — drop body sections so listing/home/editor
 * pages do not feed dull page scrapes into prompts.
 */
export function toSelectionOnlyContext(pageContext: PageContext): PageContext {
  const selected = pageContext.selectedText?.trim();
  return {
    schemaVersion: PAGE_CONTEXT_SCHEMA_VERSION,
    pageType: "generic",
    language: pageContext.language,
    title: pageContext.title,
    url: pageContext.url,
    ...(selected ? { selectedText: selected } : {}),
  };
}
