import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageContext } from "../../extension/src/shared/types/page-context";
import {
  CuratedSuggestionEngine,
  MockNanoSuggestionEngine,
  NanoSuggestionEngine,
  PRIMARY_ACTION_COUNT,
  SUGGESTION_ENGINE_FLAG,
  createSuggestionEngine,
  parseNanoActionJson,
  probeAvailability,
  selectSuggestionEngine,
  selectSuggestionEngineForPreference,
  textExpectationsForLanguage,
  validateNanoActionOutput,
} from "../../extension/src/domain/suggestions";
import type { LanguageModelLike } from "../../extension/src/domain/suggestions/nano-prompt-api";

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

function validActionsJson(count = 5): string {
  const actions = Array.from({ length: count }, (_, index) => ({
    id: `nano.article.${index}`,
    title: `Research angle ${index + 1} for this page`,
    description: `Useful direction number ${index + 1} about the page topic.`,
    category: index % 2 === 0 ? "critique" : "sources",
    task: `Investigate aspect ${index + 1} of this page with primary sources.`,
    outputFormat: "structured_explanation",
    outputSpec: ["Findings with links.", "Open questions."],
  }));
  return JSON.stringify({ actions });
}

function createFakeModel(options: {
  availability?: "available" | "unavailable" | "downloadable";
  prompts?: string[];
  failCreate?: boolean;
  hangMs?: number;
  hangAvailabilityMs?: number;
}): LanguageModelLike {
  const prompts = [...(options.prompts ?? [validActionsJson()])];
  return {
    availability: async () => {
      if (options.hangAvailabilityMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.hangAvailabilityMs),
        );
      }
      return options.availability ?? "available";
    },
    create: async () => {
      if (options.failCreate) {
        throw new Error("create failed");
      }
      return {
        prompt: async () => {
          if (options.hangMs) {
            await new Promise((resolve) => setTimeout(resolve, options.hangMs));
          }
          const next = prompts.shift();
          if (!next) {
            throw new Error("no more prompt responses");
          }
          return next;
        },
        destroy: () => undefined,
      };
    },
  };
}

describe("probeAvailability", () => {
  it("returns null when availability() hangs past the budget", async () => {
    const model = createFakeModel({ hangAvailabilityMs: 50 });
    const result = await probeAvailability(model, 5);
    expect(result).toBeNull();
  });
});

describe("textExpectationsForLanguage", () => {
  it("includes page language and falls back to en", () => {
    expect(textExpectationsForLanguage("hr").expectedInputs[0]?.languages).toEqual([
      "hr",
      "en",
    ]);
    expect(textExpectationsForLanguage("en-US").expectedInputs[0]?.languages).toEqual([
      "en",
    ]);
  });
});

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
      expect(action.description.length).toBeLessThanOrEqual(90);
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

describe("validateNanoActionOutput", () => {
  it("accepts well-formed actions and caps primary to three", () => {
    const validated = validateNanoActionOutput(validActionsJson(5), {
      pageType: "article",
      pageTitle: article.title,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.result.primary).toHaveLength(3);
    expect(validated.result.more).toHaveLength(2);
    expect(validated.result.engineId).toBe("nano");
  });

  it("rejects invalid JSON", () => {
    const validated = validateNanoActionOutput("not-json", {
      pageType: "article",
      pageTitle: article.title,
    });
    expect(validated.ok).toBe(false);
  });

  it("deduplicates near-duplicate titles and drops page-title restates", () => {
    const raw = {
      actions: [
        {
          id: "a1",
          title: "EU AI Act enters force",
          description: "Restates the title.",
          category: "context",
          task: "Summarize the page.",
          outputFormat: "other",
          outputSpec: ["Summary."],
        },
        {
          id: "a2",
          title: "Check primary sources behind the claims",
          description: "Find filings and original documents.",
          category: "sources",
          task: "Find primary sources for the main claims.",
          outputFormat: "source_map",
          outputSpec: ["Source list with links."],
        },
        {
          id: "a3",
          title: "Check primary sources behind the claims",
          description: "Duplicate title.",
          category: "sources",
          task: "Different task but same title.",
          outputFormat: "source_map",
          outputSpec: ["Sources."],
        },
      ],
    };
    const validated = validateNanoActionOutput(raw, {
      pageType: "article",
      pageTitle: article.title,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.result.primary).toHaveLength(1);
    expect(validated.result.primary[0]?.id).toBe("a2");
  });

  it("clips overlong titles and descriptions", () => {
    const raw = {
      actions: [
        {
          id: "long",
          title: "T".repeat(80),
          description: "D".repeat(200),
          category: "critique",
          task: "Do something useful with this page.",
          outputFormat: "other",
          outputSpec: ["Result."],
        },
      ],
    };
    const validated = validateNanoActionOutput(raw, {
      pageType: "article",
      pageTitle: article.title,
    });
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      return;
    }
    expect(validated.result.primary[0]!.title.length).toBeLessThanOrEqual(60);
    expect(validated.result.primary[0]!.description.length).toBeLessThanOrEqual(
      90,
    );
  });
});

describe("NanoSuggestionEngine", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports unavailable when force-disabled", async () => {
    const engine = new NanoSuggestionEngine({
      forceDisabled: true,
      getModel: () => createFakeModel({}),
    });
    expect(await engine.isAvailable()).toBe(false);
  });

  it("reports unavailable when NANO_FORCE_DISABLED=1", async () => {
    vi.stubEnv("NANO_FORCE_DISABLED", "1");
    const engine = new NanoSuggestionEngine({
      getModel: () => createFakeModel({}),
    });
    expect(await engine.isAvailable()).toBe(false);
  });

  it("returns validated nano actions on happy path", async () => {
    const engine = new NanoSuggestionEngine({
      getModel: () => createFakeModel({ prompts: [validActionsJson(4)] }),
      createTimeoutMs: 1_000,
      promptTimeoutMs: 1_000,
    });
    expect(await engine.isAvailable()).toBe(true);
    const result = await engine.suggestActions({ pageContext: article });
    expect(result.engineId).toBe("nano");
    expect(result.primary).toHaveLength(3);
    expect(result.more.length).toBeGreaterThan(0);
  });

  it("repairs once then accepts valid JSON", async () => {
    const engine = new NanoSuggestionEngine({
      getModel: () =>
        createFakeModel({
          prompts: ["{not-json", validActionsJson(3)],
        }),
      createTimeoutMs: 1_000,
      promptTimeoutMs: 1_000,
    });
    const result = await engine.suggestActions({ pageContext: article });
    expect(result.engineId).toBe("nano");
    expect(result.primary).toHaveLength(3);
  });

  it("falls back to curated after invalid JSON and failed repair", async () => {
    const engine = new NanoSuggestionEngine({
      getModel: () =>
        createFakeModel({
          // unconstrained + repair + optional constrained pass
          prompts: ["nope", "still-nope", "also-nope"],
        }),
      createTimeoutMs: 1_000,
      promptTimeoutMs: 1_000,
    });
    const result = await engine.suggestActions({ pageContext: article });
    expect(result.engineId).toBe("curated");
    expect(result.primary).toHaveLength(PRIMARY_ACTION_COUNT);
  });

  it("falls back to curated on timeout without hanging", async () => {
    const engine = new NanoSuggestionEngine({
      getModel: () =>
        createFakeModel({
          hangMs: 50,
          prompts: [validActionsJson()],
        }),
      createTimeoutMs: 1_000,
      promptTimeoutMs: 5,
    });
    const started = Date.now();
    const result = await engine.suggestActions({ pageContext: article });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result.engineId).toBe("curated");
  });

  it("generatePrompt seals SOURCE_DATA via the deterministic builder", async () => {
    const engine = new NanoSuggestionEngine({
      getModel: () => createFakeModel({}),
    });
    const curated = new CuratedSuggestionEngine();
    const { primary } = await curated.suggestActions({ pageContext: article });
    const prompt = await engine.generatePrompt({
      pageContext: article,
      action: primary[0]!,
    });
    expect(prompt).toContain("<SOURCE_DATA>");
    expect(prompt).toContain(article.title);
  });
});

describe("parseNanoActionJson", () => {
  it("parses JSON embedded in surrounding commentary", () => {
    const raw = `Sure! Here you go:
\`\`\`json
${validActionsJson(4)}
\`\`\`
Thanks!`;
    expect(parseNanoActionJson(raw)).toEqual(
      JSON.parse(validActionsJson(4)),
    );
  });
});

describe("engine selection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it("selects curated when NANO_FORCE_DISABLED even if id is nano", async () => {
    vi.stubEnv("NANO_FORCE_DISABLED", "1");
    const selected = await selectSuggestionEngine("nano");
    expect(selected.id).toBe("curated");
  });

  it("honors nanoPreference for product selection", async () => {
    expect((await selectSuggestionEngineForPreference("basic")).id).toBe(
      "curated",
    );
    expect((await selectSuggestionEngineForPreference("skipped")).id).toBe(
      "curated",
    );
    // Nano unavailable in unit env → curated floor when preference is enabled.
    expect((await selectSuggestionEngineForPreference("enabled")).id).toBe(
      "curated",
    );
  });
});
