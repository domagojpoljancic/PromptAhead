// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";

import {
  buildPageFingerprint,
  catalogCandidatesForPage,
  parseNanoRankOrderedIds,
  suggestionResultFromRankedIds,
} from "../../extension/src/domain/suggestions/nano-rank";
import { curatedActionsFor } from "../../extension/src/domain/suggestions/catalog";
import {
  NanoSuggestionEngine,
  resetNanoSharedSessionForTests,
} from "../../extension/src/domain/suggestions/nano";
import type { PageContext } from "../../extension/src/shared/types/page-context";
import type { LanguageModelLike } from "../../extension/src/domain/suggestions/nano-prompt-api";

const samplePage: PageContext = {
  schemaVersion: 1,
  pageType: "article",
  language: "en",
  title: "EU AI Act explained",
  url: "https://example.com/ai-act",
  description: "A guide to the new rules.",
  article: {
    headings: ["Background"],
    excerpts: ["Lawmakers agreed on a risk-based framework for AI systems."],
  },
};

function createFakeModel(options: {
  prompts: string[];
  availability?: "available" | "downloadable" | "unavailable";
}): LanguageModelLike {
  const queue = [...options.prompts];
  return {
    availability: async () => options.availability ?? "available",
    create: async () => ({
      prompt: async () => {
        const next = queue.shift();
        if (next === undefined) {
          throw new Error("no more prompts");
        }
        return next;
      },
      destroy: () => undefined,
    }),
  };
}

describe("nano rank path (DOM-66)", () => {
  afterEach(() => {
    resetNanoSharedSessionForTests();
  });

  it("parses orderedIds from JSON (and loose variants)", () => {
    expect(
      parseNanoRankOrderedIds(
        '{"orderedIds":["article.background","article.perspectives","article.developments"]}',
      ),
    ).toEqual([
      "article.background",
      "article.perspectives",
      "article.developments",
    ]);
    expect(
      parseNanoRankOrderedIds(
        '```json\n{"ids":[{"id":"article.timeline"},{"id":"article.challenge"},{"id":"article.background"}]}\n```',
      ),
    ).toEqual([
      "article.timeline",
      "article.challenge",
      "article.background",
    ]);
  });

  it("maps ranked ids onto catalog actions", () => {
    const catalog = curatedActionsFor("article");
    const result = suggestionResultFromRankedIds(
      ["article.challenge", "article.background", "article.timeline", "nope"],
      catalog,
    );
    expect(result?.engineId).toBe("nano");
    expect(result?.primary.map((a) => a.id)).toEqual([
      "article.challenge",
      "article.background",
      "article.timeline",
    ]);
    expect(result?.debug?.nanoPath).toBe("rank");
  });

  it("builds a compact fingerprint and catalog candidates", () => {
    const fp = buildPageFingerprint(samplePage);
    expect(fp).toContain("pageType: article");
    expect(fp).toContain("example.com");
    expect(fp.length).toBeLessThan(1200);
    const candidates = catalogCandidatesForPage(samplePage);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates[0]?.id).toBeTruthy();
  });

  it("ranks via NanoSuggestionEngine mode=rank", async () => {
    const catalog = curatedActionsFor("article");
    const ordered = catalog.slice(0, 4).map((a) => a.id);
    const engine = new NanoSuggestionEngine({
      mode: "rank",
      reuseSession: false,
      getModel: () =>
        createFakeModel({
          prompts: [JSON.stringify({ orderedIds: ordered })],
        }),
      createTimeoutMs: 1_000,
      promptTimeoutMs: 1_000,
      suggestBudgetMs: 2_000,
    });
    const result = await engine.suggestActions({ pageContext: samplePage });
    expect(result.engineId).toBe("nano");
    expect(result.debug?.nanoPath).toBe("rank");
    expect(result.primary.map((a) => a.id)).toEqual(ordered.slice(0, 3));
  });

  it("falls back to curated when rank JSON is unusable", async () => {
    const engine = new NanoSuggestionEngine({
      mode: "rank",
      reuseSession: false,
      getModel: () => createFakeModel({ prompts: ["not-json"] }),
      createTimeoutMs: 1_000,
      promptTimeoutMs: 1_000,
      suggestBudgetMs: 2_000,
    });
    const result = await engine.suggestActions({ pageContext: samplePage });
    expect(result.engineId).toBe("curated");
    expect(result.debug?.nanoPath).toBe("curated-fallback");
    expect(result.debug?.nanoFailureReason).toMatch(/rank|valid/i);
  });
});
