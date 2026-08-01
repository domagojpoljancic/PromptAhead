import { describe, expect, it } from "vitest";

import type { PageContext } from "../../extension/src/shared/types/page-context";
import {
  CuratedSuggestionEngine,
  MockNanoSuggestionEngine,
  PRIMARY_ACTION_COUNT,
  SUGGESTION_ENGINE_FLAG,
  createSuggestionEngine,
  selectSuggestionEngine,
} from "../../extension/src/domain/suggestions";

const article: PageContext = {
  schemaVersion: 1,
  pageType: "article",
  language: "en",
  title: "EU AI Act enters force",
  url: "https://example.com/ai-act",
  description: "Overview of the regulation.",
  article: {
    publisher: "Example News",
    headings: ["Timeline"],
    excerpts: ["The regulation applies in stages."],
  },
};

const product: PageContext = {
  schemaVersion: 1,
  pageType: "product",
  language: "en",
  title: "Noise-cancelling headphones",
  url: "https://shop.example/headphones",
  product: {
    brand: "Acme",
    price: "249",
    currency: "USD",
    excerpts: ["40-hour battery."],
    specifications: [{ name: "Weight", value: "250 g" }],
  },
};

const generic: PageContext = {
  schemaVersion: 1,
  pageType: "generic",
  language: "hr",
  title: "Gradski portal",
  url: "https://example.hr/portal",
  generic: {
    headings: ["Novosti"],
    excerpts: ["Najave događanja."],
  },
};

describe("CuratedSuggestionEngine", () => {
  const engine = new CuratedSuggestionEngine();

  it("is always available and flagged as curated", async () => {
    expect(engine.id).toBe("curated");
    expect(await engine.isAvailable()).toBe(true);
  });

  it.each([
    ["article", article],
    ["product", product],
    ["generic", generic],
  ] as const)("returns 3 primary + more for %s", async (_label, pageContext) => {
    const result = await engine.suggestActions({ pageContext });
    expect(result.engineId).toBe("curated");
    expect(result.primary).toHaveLength(PRIMARY_ACTION_COUNT);
    expect(result.more.length).toBeGreaterThan(0);
    for (const action of [...result.primary, ...result.more]) {
      expect(action.pageType).toBe(pageContext.pageType);
      expect(action.title.length).toBeGreaterThan(0);
      expect(action.title.length).toBeLessThanOrEqual(60);
      expect(action.description.length).toBeLessThanOrEqual(140);
      expect(action.task.length).toBeGreaterThan(0);
      expect(action.outputSpec.length).toBeGreaterThan(0);
    }
  });

  it("builds a prompt containing sealed source data", async () => {
    const { primary } = await engine.suggestActions({ pageContext: article });
    const prompt = await engine.generatePrompt({
      pageContext: article,
      action: primary[0]!,
      userNote: "Focus on SMEs.",
    });
    expect(prompt).toContain("<SOURCE_DATA>");
    expect(prompt).toContain("</SOURCE_DATA>");
    expect(prompt).toContain(article.title);
    expect(prompt).toContain("Focus on SMEs.");
  });
});

describe("MockNanoSuggestionEngine", () => {
  it("is available and returns fixture-shaped actions", async () => {
    const engine = new MockNanoSuggestionEngine();
    expect(engine.id).toBe("mock-nano");
    expect(await engine.isAvailable()).toBe(true);
    const result = await engine.suggestActions({ pageContext: article });
    expect(result.engineId).toBe("mock-nano");
    expect(result.primary).toHaveLength(PRIMARY_ACTION_COUNT);
  });
});

describe("engine selection", () => {
  it("defaults the product flag to curated", () => {
    expect(SUGGESTION_ENGINE_FLAG).toBe("curated");
    expect(createSuggestionEngine().id).toBe("curated");
  });

  it("falls back to curated when nano is unavailable", async () => {
    const selected = await selectSuggestionEngine("nano");
    expect(selected.id).toBe("curated");
  });

  it("keeps mock-nano when requested and available", async () => {
    const selected = await selectSuggestionEngine("mock-nano");
    expect(selected.id).toBe("mock-nano");
  });
});
