import { describe, expect, it } from "vitest";

import {
  EXTRACTION_CAPS,
  PAGE_CONTEXT_SCHEMA_VERSION,
  isPageContext,
  type PageContext,
} from "../../extension/src/shared/types/page-context";
import type { PageContext as DomainPageContext } from "../../extension/src/domain/extraction";

describe("PageContext contract", () => {
  const article: PageContext = {
    schemaVersion: 1,
    pageType: "article",
    language: "en",
    title: "EU AI Act enters force",
    url: "https://example.com/ai-act",
    description: "Overview of the regulation.",
    article: {
      publisher: "Example News",
      headings: ["Timeline", "Who is affected"],
      excerpts: ["The regulation applies in stages."],
    },
  };

  it("matches handoff §31 schemaVersion 1", () => {
    expect(PAGE_CONTEXT_SCHEMA_VERSION).toBe(1);
    expect(isPageContext(article)).toBe(true);
  });

  it("is re-exported from the extraction domain", () => {
    const sameShape: DomainPageContext = article;
    expect(sameShape.pageType).toBe("article");
  });

  it("rejects values that are not a v1 PageContext", () => {
    expect(isPageContext(null)).toBe(false);
    expect(isPageContext({ ...article, schemaVersion: 2 })).toBe(false);
    expect(isPageContext({ ...article, pageType: "recipe" })).toBe(false);
    expect(isPageContext({ schemaVersion: 1, pageType: "generic" })).toBe(false);
  });

  it("documents the compactness caps extraction must honour", () => {
    expect(EXTRACTION_CAPS).toMatchObject({
      headings: 8,
      articleExcerpts: 6,
      productSpecifications: 12,
      productExcerpts: 4,
    });
  });
});
