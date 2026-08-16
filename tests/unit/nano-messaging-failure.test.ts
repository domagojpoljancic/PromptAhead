/**
 * DOM-50 — SW ↔ panel Nano messaging failure contracts.
 * Chrome / Prompt API are mocked; no live Nano.
 */
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerBackgroundRouter } from "../../extension/src/background/router";
import {
  didNanoFallBackToCurated,
  nanoPanelNoticeForPreference,
  nanoPanelNoticeFromFailureReason,
  shouldOfferNanoRetry,
  type NanoPanelNotice,
} from "../../extension/src/domain/suggestions";
import { sendToBackground } from "../../extension/src/shared/messaging";
import { STORAGE_KEYS } from "../../extension/src/shared/storage";
import { DEFAULT_SETTINGS } from "../../extension/src/shared/storage/schema";
import {
  initSidePanel,
  type SidePanelController,
} from "../../extension/src/sidepanel/sidepanel";
import { resetOnboardingForTests } from "../../extension/src/sidepanel/onboarding";
import type { PageContext } from "../../extension/src/shared/types/page-context";
import type { BackgroundRequest } from "../../extension/src/shared/messaging";
import type {
  SuggestedAction,
  SuggestionEngine,
  SuggestionResult,
} from "../../extension/src/domain/suggestions";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from "./helpers/chrome-mock";
import {
  click,
  flush,
  isVisible,
  mountExtensionHtml,
  textOf,
} from "./helpers/mount-html";

describe("sendToBackground transport failures", () => {
  afterEach(() => {
    uninstallChromeMock();
  });

  it("maps missing chrome.runtime to unavailable", async () => {
    uninstallChromeMock();
    const response = await sendToBackground({ type: "GET_SETTINGS" });
    expect(response).toEqual({
      ok: false,
      type: "GET_SETTINGS",
      error: "chrome.runtime is unavailable",
    });
  });

  it("maps disconnect (no receiver) to ok:false", async () => {
    installChromeMock();
    // No router registered → Receiving end does not exist.
    const response = await sendToBackground({ type: "GET_SETTINGS" });
    expect(response.ok).toBe(false);
    expect(!response.ok && response.type).toBe("GET_SETTINGS");
    expect(!response.ok && response.error).toMatch(/Receiving end does not exist/i);
  });

  it("maps malformed replies to a typed error", async () => {
    const mock = installChromeMock();
    mock.listeners.push((_message, _sender, sendResponse) => {
      sendResponse({ unexpected: true });
      return false;
    });

    const response = await sendToBackground({ type: "PING" });
    expect(response).toEqual({
      ok: false,
      type: "PING",
      error: "Malformed background response",
    });
  });
});

describe("SW ↔ panel nanoPreference contracts", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          ...DEFAULT_SETTINGS,
          nanoPreference: "skipped",
        },
      },
    });
    registerBackgroundRouter();
  });

  afterEach(() => {
    uninstallChromeMock();
  });

  it("reads and writes nanoPreference through the router", async () => {
    const initial = await sendToBackground({ type: "GET_SETTINGS" });
    expect(initial.ok && initial.settings.nanoPreference).toBe("skipped");

    const saved = await sendToBackground({
      type: "SET_SETTINGS",
      patch: { nanoPreference: "enabled" },
    });
    expect(saved.ok && saved.settings.nanoPreference).toBe("enabled");

    const reread = await sendToBackground({ type: "GET_SETTINGS" });
    expect(reread.ok && reread.settings.nanoPreference).toBe("enabled");
    expect(mock.storage[STORAGE_KEYS.settings]).toMatchObject({
      nanoPreference: "enabled",
    });
  });

  it("returns typed ok:false when SET_SETTINGS fails the receiver", async () => {
    uninstallChromeMock();
    installChromeMock();
    // Router not registered → disconnect path for Nano preference writes.
    const response = await sendToBackground({
      type: "SET_SETTINGS",
      patch: { nanoPreference: "enabled" },
    });
    expect(response.ok).toBe(false);
    expect(!response.ok && response.type).toBe("SET_SETTINGS");
    expect(!response.ok && response.error).toMatch(/Receiving end does not exist/i);
  });
});

describe("Nano failure → notice / Retry contracts", () => {
  it("maps timeout / create / prompt failures to needs-download", () => {
    const reasons = [
      "Gemini Nano timed out",
      "nano.create: create failed",
      "nano.prompt: hung",
      "The signal is aborted.",
    ];
    for (const reason of reasons) {
      expect(nanoPanelNoticeFromFailureReason(reason)).toBe("needs-download");
    }
  });

  it("maps unavailable readiness to unsupported notice", () => {
    expect(
      nanoPanelNoticeForPreference({
        preference: "enabled",
        readiness: {
          state: "unsupported",
          availability: "unavailable",
          apiPresent: false,
        },
      }),
    ).toBe("unsupported");
  });

  it("offers Retry only when Nano is preferred and curated replaced Nano", () => {
    expect(shouldOfferNanoRetry("enabled")).toBe(true);
    expect(shouldOfferNanoRetry("basic")).toBe(false);
    expect(
      didNanoFallBackToCurated({
        selectedEngineId: "nano",
        resultEngineId: "curated",
      }),
    ).toBe(true);
    expect(
      didNanoFallBackToCurated({
        selectedEngineId: "nano",
        resultEngineId: "nano",
      }),
    ).toBe(false);
  });

  it("keeps soft-fallback notice as Retry-eligible (not Settings-only)", () => {
    const notice: NanoPanelNotice = nanoPanelNoticeFromFailureReason(
      "No valid Nano actions",
    );
    expect(notice).toBe("fallback");
    // Panel hides Retry only for needs-download; fallback keeps Retry local AI.
    expect(notice === "needs-download").toBe(false);
  });
});

describe("side panel Retry local AI after messaging-backed Nano fallback", () => {
  const samplePage: PageContext = {
    schemaVersion: 1,
    pageType: "article",
    language: "en",
    title: "EU AI Act",
    url: "https://example.com/ai-act",
    description: "Overview.",
    selectedText: "highlighted passage",
    article: {
      publisher: "Example News",
      headings: ["Timeline"],
      excerpts: ["The regulation applies in stages."],
    },
  };

  const primaryAction: SuggestedAction = {
    id: "article.summarize",
    title: "Summarize this article",
    description: "Get the key points quickly.",
    category: "context",
    pageType: "article",
    task: "Summarize the article.",
    outputFormat: "structured_explanation",
    outputSpec: ["Short summary."],
  };

  const moreAction: SuggestedAction = {
    id: "article.critique",
    title: "Critique the argument",
    description: "Find weaknesses.",
    category: "critique",
    pageType: "article",
    task: "Critique the article.",
    outputFormat: "structured_explanation",
    outputSpec: ["Weaknesses."],
  };

  let controller: SidePanelController | undefined;

  beforeEach(() => {
    resetOnboardingForTests();
    mountExtensionHtml("sidepanel/index.html");
  });

  afterEach(() => {
    controller?.dispose();
    controller = undefined;
  });

  it("shows Retry after soft fallback and re-invokes suggest on click", async () => {
    const settings = { ...DEFAULT_SETTINGS, nanoPreference: "enabled" as const };
    let suggestCalls = 0;
    const nanoEngine: SuggestionEngine = {
      id: "nano",
      isAvailable: async () => true,
      suggestActions: async (): Promise<SuggestionResult> => {
        suggestCalls += 1;
        if (suggestCalls === 1) {
          return {
            engineId: "curated",
            primary: [primaryAction],
            more: [moreAction],
            debug: { nanoFailureReason: "No valid Nano actions" },
          };
        }
        return {
          engineId: "nano",
          primary: [primaryAction],
          more: [moreAction],
          debug: { elapsedMs: 12 },
        };
      },
      generatePrompt: async () => "TASK",
    };

    const send = vi.fn(async (request: BackgroundRequest) => {
      switch (request.type) {
        case "GET_SETTINGS":
          return { ok: true as const, type: "GET_SETTINGS" as const, settings };
        case "GET_ONBOARDING":
          return {
            ok: true as const,
            type: "GET_ONBOARDING" as const,
            onboarding: {
              schemaVersion: 1 as const,
              completed: true,
              completedAt: "2026-08-02T00:00:00.000Z",
              modeChosen: true,
              destinationChosen: true,
              nanoStepSkipped: false,
            },
          };
        case "GET_LATEST_PAGE_CONTEXT":
          return {
            ok: true as const,
            type: "GET_LATEST_PAGE_CONTEXT" as const,
            pageContext: samplePage,
            tabId: 7,
          };
        default:
          return {
            ok: false as const,
            type: request.type,
            error: `Unhandled ${request.type}`,
          };
      }
    });

    controller = await initSidePanel({
      sendToBackground: send as unknown as typeof sendToBackground,
      selectSuggestionEngine: async () => nanoEngine,
      probeNanoReadiness: async () => ({
        state: "ready",
        availability: "available",
        apiPresent: true,
      }),
      openOptionsPage: async () => undefined,
      openLLMWithFallback: async () => ({
        copied: true,
        openedUrl: null,
        mode: "copy-only" as const,
        usedModel: null,
      }),
      addMessageListener: () => () => undefined,
      maybeStartOnboarding: async () => false,
    });
    await flush();

    expect(isVisible("#nano-fallback")).toBe(true);
    expect(textOf("#status")).toMatch(/tiny brain/i);
    expect(isVisible("#nano-retry")).toBe(true);
    expect(suggestCalls).toBe(1);

    click("#nano-retry");
    await flush();

    expect(suggestCalls).toBe(2);
    expect(isVisible("#choose")).toBe(true);
    expect(isVisible("#nano-fallback")).toBe(false);
  });

  it("surfaces Background unreachable when GET_SETTINGS disconnects", async () => {
    const send = vi.fn(async (request: BackgroundRequest) => {
      if (request.type === "GET_SETTINGS") {
        return {
          ok: false as const,
          type: "GET_SETTINGS" as const,
          error: "Could not establish connection. Receiving end does not exist.",
        };
      }
      if (request.type === "GET_ONBOARDING") {
        return {
          ok: true as const,
          type: "GET_ONBOARDING" as const,
          onboarding: {
            schemaVersion: 1 as const,
            completed: true,
            completedAt: "2026-08-02T00:00:00.000Z",
            modeChosen: true,
            destinationChosen: true,
            nanoStepSkipped: true,
          },
        };
      }
      if (request.type === "GET_LATEST_PAGE_CONTEXT") {
        return {
          ok: true as const,
          type: "GET_LATEST_PAGE_CONTEXT" as const,
          pageContext: samplePage,
          tabId: 7,
        };
      }
      return {
        ok: false as const,
        type: request.type,
        error: `Unhandled ${request.type}`,
      };
    });

    const curated: SuggestionEngine = {
      id: "curated",
      isAvailable: async () => true,
      suggestActions: async () => ({
        engineId: "curated",
        primary: [primaryAction],
        more: [moreAction],
      }),
      generatePrompt: async () => "TASK",
    };

    controller = await initSidePanel({
      sendToBackground: send as unknown as typeof sendToBackground,
      selectSuggestionEngine: async () => curated,
      openOptionsPage: async () => undefined,
      openLLMWithFallback: async () => ({
        copied: true,
        openedUrl: null,
        mode: "copy-only" as const,
        usedModel: null,
      }),
      addMessageListener: () => () => undefined,
      maybeStartOnboarding: async () => false,
    });
    await flush();

    // Prefer an extra flush so the fire-and-forget renderDebugLine settles.
    await flush();
    expect(textOf("#debug-line")).toMatch(/Background unreachable/i);
    expect(isVisible("#choose")).toBe(true);
  });
});
