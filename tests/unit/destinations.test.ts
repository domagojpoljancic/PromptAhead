import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEEP_LINK_URL_BUDGET,
  DESTINATION_OPEN_URLS,
  copyAndMaybeOpen,
  destinationLabel,
  generateLLMDeepLink,
  isSafeHandoffUrl,
  openLLMWithFallback,
  openUrlForDestination,
  PROVIDER_REGISTRY,
  resolveDefaultModel,
  suggestedModelsFor,
} from "../../extension/src/domain/destinations";

describe("destinations registry", () => {
  it("labels every destination", () => {
    expect(destinationLabel("copy")).toBe("Copy only");
    expect(destinationLabel("chatgpt")).toMatch(/ChatGPT/i);
  });

  it("exposes base open URLs for every provider", () => {
    expect(openUrlForDestination("copy")).toBeNull();
    for (const [id, url] of Object.entries(DESTINATION_OPEN_URLS)) {
      expect(openUrlForDestination(id as keyof typeof DESTINATION_OPEN_URLS)).toBe(
        url,
      );
      expect(url).toMatch(/^https:\/\//);
    }
  });

  it("stores suggested models without forcing a single hardcoded call-site option", () => {
    expect(suggestedModelsFor("chatgpt").length).toBeGreaterThan(1);
    expect(resolveDefaultModel("chatgpt")).toBe(
      PROVIDER_REGISTRY.chatgpt.defaultModel,
    );
    expect(resolveDefaultModel("chatgpt", "o3")).toBe("o3");
    expect(resolveDefaultModel("claude")).toBeNull(); // no modelParamKey
    expect(resolveDefaultModel("gemini")).toBeNull();
  });
});

describe("generateLLMDeepLink", () => {
  it("builds ChatGPT web + app URLs with q and default model", () => {
    const result = generateLLMDeepLink({
      provider: "chatgpt",
      prompt: "hello world",
    });
    expect(result.strategy).toBe("query");
    expect(result.usedModel).toBe("gpt-4o");
    expect(result.webUrl).toContain("https://chatgpt.com/?");
    expect(result.webUrl).toContain("q=hello");
    expect(result.webUrl).toContain("model=gpt-4o");
    expect(result.appUrl).toMatch(/^com\.openai\.chat:\/\//);
    expect(result.appUrl).toContain("q=hello");
    expect(isSafeHandoffUrl(result.webUrl)).toBe(true);
  });

  it("builds Claude web + app URLs with q and no model param", () => {
    const result = generateLLMDeepLink({
      provider: "claude",
      prompt: "analyze this",
    });
    expect(result.strategy).toBe("query");
    expect(result.webUrl).toBe(
      `https://claude.ai/new?${new URLSearchParams({ q: "analyze this" })}`,
    );
    expect(result.appUrl).toBe(
      `claude://claude.ai/new?${new URLSearchParams({ q: "analyze this" })}`,
    );
    expect(result.usedModel).toBeNull();
  });

  it("builds Perplexity search URL without an app scheme", () => {
    const result = generateLLMDeepLink({
      provider: "perplexity",
      prompt: "latest news",
    });
    expect(result.strategy).toBe("query");
    expect(result.webUrl).toBe(
      `https://www.perplexity.ai/search?${new URLSearchParams({ q: "latest news" })}`,
    );
    expect(result.appUrl).toBeNull();
  });

  it("forces clipboard strategy for Gemini", () => {
    const result = generateLLMDeepLink({
      provider: "gemini",
      prompt: "anything",
    });
    expect(result.strategy).toBe("clipboard");
    expect(result.reason).toBe("unsupported");
    expect(result.webUrl).toBe(DESTINATION_OPEN_URLS.gemini);
    expect(result.appUrl).toBeNull();
  });

  it("falls back to clipboard when the encoded URL exceeds the budget", () => {
    const prompt = "x".repeat(DEEP_LINK_URL_BUDGET);
    const result = generateLLMDeepLink({
      provider: "chatgpt",
      prompt,
    });
    expect(result.strategy).toBe("clipboard");
    expect(result.reason).toBe("oversize");
    expect(result.webUrl).toBe(DESTINATION_OPEN_URLS.chatgpt);
    expect(result.appUrl).toBeNull();
  });

  it("rejects auto-submit style params in safety helper", () => {
    expect(isSafeHandoffUrl("https://chatgpt.com/?q=hi")).toBe(true);
    expect(isSafeHandoffUrl("https://chatgpt.com/?q=hi&submit=1")).toBe(false);
    expect(isSafeHandoffUrl("https://claude.ai/new?send=true")).toBe(false);
  });
});

describe("openLLMWithFallback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copy-only skips opening a tab", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const openTab = vi.fn();

    const result = await openLLMWithFallback({
      prompt: "only copy",
      destination: "copy",
      deps: { openTab, copy },
    });

    expect(copy).toHaveBeenCalledWith("only copy");
    expect(openTab).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      mode: "copy-only",
      openedUrl: null,
      copied: true,
    });
  });

  it("Gemini always copies then opens the base URL", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    const opened: string[] = [];

    const result = await openLLMWithFallback({
      prompt: "paste me",
      destination: "gemini",
      deps: {
        copy,
        openTab: (url) => {
          opened.push(url);
        },
      },
    });

    expect(copy).toHaveBeenCalledWith("paste me");
    expect(opened).toEqual([DESTINATION_OPEN_URLS.gemini]);
    expect(result.mode).toBe("clipboard");
    expect(result.copied).toBe(true);
  });

  it("opens Perplexity web deep link directly (no app scheme)", async () => {
    const opened: string[] = [];
    const copy = vi.fn();

    const result = await openLLMWithFallback({
      prompt: "search this",
      destination: "perplexity",
      deps: {
        copy,
        openTab: (url) => {
          opened.push(url);
        },
      },
    });

    expect(copy).not.toHaveBeenCalled();
    expect(opened[0]).toContain("perplexity.ai/search?q=");
    expect(result.mode).toBe("deeplink");
    expect(result.copied).toBe(false);
    expect(isSafeHandoffUrl(opened[0]!)).toBe(true);
  });

  it("opens ChatGPT web deep link by default (no app-scheme flash)", async () => {
    const opened: string[] = [];

    const result = await openLLMWithFallback({
      prompt: "short",
      destination: "chatgpt",
      deps: {
        openTab: (url) => {
          opened.push(url);
        },
        getTab: async () => {
          throw new Error("should not probe tabs");
        },
        updateTab: async () => {
          throw new Error("should not update tabs");
        },
      },
    });

    expect(opened).toHaveLength(1);
    expect(opened[0]).toContain("https://chatgpt.com/?");
    expect(opened[0]).toContain("q=short");
    expect(result.mode).toBe("deeplink");
  });

  it("opens Claude web deep link by default", async () => {
    const opened: string[] = [];

    const result = await openLLMWithFallback({
      prompt: "analyze",
      destination: "claude",
      deps: {
        openTab: (url) => {
          opened.push(url);
        },
      },
    });

    expect(opened[0]).toContain("https://claude.ai/new?q=");
    expect(result.mode).toBe("deeplink");
  });

  it("falls back to web when preferAppScheme and the protocol tab stalls", async () => {
    const tabs = new Map<number, { id: number; url: string }>();
    let nextId = 1;

    const result = await openLLMWithFallback({
      prompt: "short",
      destination: "claude",
      preferAppScheme: true,
      deps: {
        fallbackMs: 1,
        delay: async () => undefined,
        openTab: async (url) => {
          const id = nextId++;
          tabs.set(id, { id, url });
          return { id, url };
        },
        getTab: async (id) => tabs.get(id) ?? null,
        updateTab: async (id, url) => {
          const existing = tabs.get(id);
          if (existing) {
            tabs.set(id, { ...existing, url });
          }
        },
      },
    });

    expect(result.mode).toBe("fallback-web");
    expect(result.openedUrl).toContain("https://claude.ai/new?q=");
    expect([...tabs.values()][0]?.url).toContain("https://claude.ai/new?q=");
  });

  it("treats a missing tab after preferAppScheme open as a successful deeplink", async () => {
    const result = await openLLMWithFallback({
      prompt: "short",
      destination: "chatgpt",
      preferAppScheme: true,
      deps: {
        fallbackMs: 1,
        delay: async () => undefined,
        openTab: async (url) => ({ id: 42, url }),
        getTab: async () => null,
        updateTab: async () => {
          throw new Error("should not update");
        },
      },
    });

    expect(result.mode).toBe("deeplink");
    expect(result.openedUrl).toMatch(/^com\.openai\.chat:\/\//);
    expect(result.copied).toBe(false);
  });

  it("copyAndMaybeOpen remains a thin wrapper over the new flow", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const opened: string[] = [];
    const result = await copyAndMaybeOpen({
      prompt: "legacy",
      destination: "gemini",
      openTab: (url) => {
        opened.push(url);
      },
    });

    expect(writeText).toHaveBeenCalledWith("legacy");
    expect(opened).toEqual([DESTINATION_OPEN_URLS.gemini]);
    expect(result.mode).toBe("clipboard");
    expect(result.copied).toBe(true);
  });
});
