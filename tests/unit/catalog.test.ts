import { describe, expect, it } from "vitest";

import {
  CURATED_CATALOG_IDS,
  curatedActionsFor,
} from "../../extension/src/domain/suggestions/catalog";
import { CuratedSuggestionEngine } from "../../extension/src/domain/suggestions/curated";
import {
  MAX_RANK_CANDIDATES,
  catalogCandidatesForPage,
} from "../../extension/src/domain/suggestions/nano-rank";
import {
  MAX_ACTION_DESCRIPTION_CHARS,
  MAX_ACTION_TITLE_CHARS,
  MORE_ACTION_COUNT,
  PRIMARY_ACTION_COUNT,
} from "../../extension/src/domain/suggestions/types";
import type {
  PageContext,
  PageType,
} from "../../extension/src/shared/types/page-context";

const PAGE_TYPES: PageType[] = ["article", "product", "generic"];

/** Deep enough that ranking has real choices to make (DOM-66). */
const MIN_POOL_PER_PAGE_TYPE = 18;

function pageContext(pageType: PageType): PageContext {
  return {
    schemaVersion: 1,
    url: "https://example.com/thing",
    title: "Example page",
    pageType,
    language: "en",
    capturedAt: "2026-08-16T10:00:00.000Z",
    extraction: { mode: "auto", truncated: false },
  } as unknown as PageContext;
}

describe("curated catalog", () => {
  it("offers a deep pool for every page type", () => {
    for (const pageType of PAGE_TYPES) {
      expect(curatedActionsFor(pageType).length).toBeGreaterThanOrEqual(
        MIN_POOL_PER_PAGE_TYPE,
      );
    }
  });

  it("keeps every entry inside the panel's display caps", () => {
    for (const pageType of PAGE_TYPES) {
      for (const action of curatedActionsFor(pageType, {
        hasSelectedText: true,
      })) {
        expect(action.title.length).toBeLessThanOrEqual(MAX_ACTION_TITLE_CHARS);
        expect(action.description.length).toBeLessThanOrEqual(
          MAX_ACTION_DESCRIPTION_CHARS,
        );
        expect(action.task.trim().length).toBeGreaterThan(20);
        expect(action.outputSpec.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("uses unique ids that are all listed in CURATED_CATALOG_IDS", () => {
    const known = new Set(CURATED_CATALOG_IDS);
    expect(known.size).toBe(CURATED_CATALOG_IDS.length);
    for (const pageType of PAGE_TYPES) {
      const ids = curatedActionsFor(pageType, { hasSelectedText: true }).map(
        (action) => action.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) {
        expect(known.has(id)).toBe(true);
      }
    }
  });

  it("shows a shortlist even though the pool is much deeper", async () => {
    const engine = new CuratedSuggestionEngine();
    for (const pageType of PAGE_TYPES) {
      const result = await engine.suggestActions({
        pageContext: pageContext(pageType),
      });
      expect(result.primary).toHaveLength(PRIMARY_ACTION_COUNT);
      expect(result.more.length).toBeLessThanOrEqual(MORE_ACTION_COUNT);
      expect(result.primary.length + result.more.length).toBeLessThan(
        curatedActionsFor(pageType).length,
      );
    }
  });

  it("caps how many candidates the ranker sees", () => {
    for (const pageType of PAGE_TYPES) {
      const candidates = catalogCandidatesForPage(pageContext(pageType));
      expect(candidates.length).toBeLessThanOrEqual(MAX_RANK_CANDIDATES);
      expect(candidates.length).toBeGreaterThanOrEqual(PRIMARY_ACTION_COUNT);
    }
  });
});
