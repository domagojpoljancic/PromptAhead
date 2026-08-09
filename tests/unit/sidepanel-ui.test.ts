// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initOptions } from "../../extension/src/options/options";
import {
  initSidePanel,
  type SidePanelController,
} from "../../extension/src/sidepanel/sidepanel";
import { resetOnboardingForTests } from "../../extension/src/sidepanel/onboarding";
import { EMPTY_SOURCE_INCLUSION_MESSAGE } from "../../extension/src/sidepanel/context-inclusion";
import { STALE_CONTEXT_MESSAGE } from "../../extension/src/sidepanel/workflow";
import type { PageContext } from "../../extension/src/shared/types/page-context";
import {
  DEFAULT_ONBOARDING,
  DEFAULT_SETTINGS,
  type OnboardingState,
  type Settings,
} from "../../extension/src/shared/storage/schema";
import type { BackgroundRequest } from "../../extension/src/shared/messaging";
import type {
  SuggestedAction,
  SuggestionEngine,
  SuggestionResult,
} from "../../extension/src/domain/suggestions";
import {
  click,
  flush,
  isVisible,
  mountExtensionHtml,
  textOf,
} from "./helpers/mount-html";

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

function mockEngine(result?: Partial<SuggestionResult>): SuggestionEngine {
  const suggestions: SuggestionResult = {
    engineId: "curated",
    primary: [primaryAction],
    more: [moreAction],
    ...result,
  };
  return {
    id: "curated",
    isAvailable: async () => true,
    suggestActions: async () => suggestions,
    generatePrompt: async () =>
      "TASK: Summarize\n\n<SOURCE_DATA>\nEU AI Act\n</SOURCE_DATA>",
  };
}

type Store = {
  settings: Settings;
  onboarding: OnboardingState;
  history: Array<{
    title: string;
    url: string;
    prompt: string;
    destination: string;
  }>;
  latest: { pageContext: PageContext | null; tabId?: number; error?: string };
  extractError?: string;
};

function createSend(store: Store) {
  const listeners: Array<(message: unknown) => void> = [];

  const send = vi.fn(async (request: BackgroundRequest) => {
    switch (request.type) {
      case "PING":
        return { ok: true as const, type: "PING" as const, pong: true };
      case "GET_SETTINGS":
        return { ok: true as const, type: "GET_SETTINGS" as const, settings: store.settings };
      case "SET_SETTINGS":
        store.settings = { ...store.settings, ...request.patch };
        return {
          ok: true as const,
          type: "SET_SETTINGS" as const,
          settings: store.settings,
        };
      case "GET_ONBOARDING":
        return {
          ok: true as const,
          type: "GET_ONBOARDING" as const,
          onboarding: store.onboarding,
        };
      case "SET_ONBOARDING":
        store.onboarding = { ...store.onboarding, ...request.patch };
        return {
          ok: true as const,
          type: "SET_ONBOARDING" as const,
          onboarding: store.onboarding,
        };
      case "GET_LATEST_PAGE_CONTEXT":
        return {
          ok: true as const,
          type: "GET_LATEST_PAGE_CONTEXT" as const,
          pageContext: store.latest.pageContext,
          tabId: store.latest.tabId,
          error: store.latest.error,
        };
      case "EXTRACT_ACTIVE_TAB":
        if (store.extractError) {
          return {
            ok: false as const,
            type: "EXTRACT_ACTIVE_TAB" as const,
            error: store.extractError,
          };
        }
        return {
          ok: true as const,
          type: "EXTRACT_ACTIVE_TAB" as const,
          pageContext: store.latest.pageContext ?? samplePage,
          tabId: store.latest.tabId ?? 7,
        };
      case "ADD_RECENT_PROMPT":
        store.history.unshift(request.entry);
        return {
          ok: true as const,
          type: "ADD_RECENT_PROMPT" as const,
          entry: {
            id: "h1",
            createdAt: "2026-08-02T00:00:00.000Z",
            ...request.entry,
          },
          history: {
            schemaVersion: 1 as const,
            entries: store.history.map((e, i) => ({
              id: `h${i}`,
              createdAt: "2026-08-02T00:00:00.000Z",
              ...e,
              destination: e.destination as Settings["defaultDestination"],
            })),
          },
        };
      case "CLEAR_RECENT_HISTORY":
        store.history = [];
        return {
          ok: true as const,
          type: "CLEAR_RECENT_HISTORY" as const,
          history: { schemaVersion: 1 as const, entries: [] },
        };
      case "CLEAR_LEARNED_PREFS":
        return { ok: true as const, type: "CLEAR_LEARNED_PREFS" as const, cleared: true };
      case "CLEAR_ALL_DATA":
        store.settings = { ...DEFAULT_SETTINGS };
        store.onboarding = { ...DEFAULT_ONBOARDING };
        store.history = [];
        store.latest = { pageContext: null };
        for (const listener of listeners) {
          listener({ type: "PAGE_CONTEXT_CLEARED", tabId: -1, reason: "cleared" });
        }
        return {
          ok: true as const,
          type: "CLEAR_ALL_DATA" as const,
          cleared: true,
          settings: store.settings,
          onboarding: store.onboarding,
        };
      default:
        return {
          ok: false as const,
          type: request.type,
          error: `Unhandled ${request.type}`,
        };
    }
  });

  return {
    send: send as unknown as typeof import("../../extension/src/shared/messaging").sendToBackground,
    listeners,
    pushEvent(message: unknown) {
      for (const listener of listeners) {
        listener(message);
      }
    },
  };
}

describe("side panel click-through", () => {
  let controller: SidePanelController | undefined;
  let store: Store;

  beforeEach(() => {
    resetOnboardingForTests();
    mountExtensionHtml("sidepanel/index.html");
    store = {
      settings: { ...DEFAULT_SETTINGS },
      onboarding: { ...DEFAULT_ONBOARDING, completed: true },
      history: [],
      latest: { pageContext: samplePage, tabId: 7 },
    };
  });

  afterEach(() => {
    controller?.dispose();
    controller = undefined;
  });

  async function boot(overrides: {
    onboardingIncomplete?: boolean;
    engine?: SuggestionEngine;
    openLLM?: SidePanelDepsOpen;
    nanoReadiness?: "ready" | "download" | "unsupported";
  } = {}) {
    if (overrides.onboardingIncomplete) {
      store.onboarding = { ...DEFAULT_ONBOARDING };
    }
    const { send, listeners, pushEvent } = createSend(store);
    const openOptionsPage = vi.fn();
    const openLLM =
      overrides.openLLM ??
      (async () => ({
        copied: true,
        openedUrl: null,
        mode: "copy-only" as const,
        usedModel: null,
      }));
    const readinessState = overrides.nanoReadiness ?? "ready";

    controller = await initSidePanel({
      sendToBackground: send,
      selectSuggestionEngine: async () => overrides.engine ?? mockEngine(),
      openLLMWithFallback: openLLM,
      openOptionsPage,
      probeNanoReadiness: async () => ({
        state: readinessState,
        availability:
          readinessState === "ready"
            ? "available"
            : readinessState === "download"
              ? "downloadable"
              : "unavailable",
        apiPresent: readinessState !== "unsupported",
      }),
      addMessageListener: (listener) => {
        listeners.push(listener);
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        };
      },
    });
    await flush();
    return { send, pushEvent, openOptionsPage };
  }

  it("walks Choose → Refine → Review → Prompt → Copy success", async () => {
    await boot();
    expect(isVisible("#choose")).toBe(true);
    expect(textOf("#context-title")).toBe("EU AI Act");

    click('#primary-actions button[data-action-id="article.summarize"]');
    await flush();
    expect(isVisible("#refine")).toBe(true);

    const note = document.getElementById("user-note") as HTMLTextAreaElement;
    note.value = "focus on timeline";
    click("#continue-to-review");
    await flush();
    expect(isVisible("#review")).toBe(true);

    click("#build-prompt");
    await flush();
    expect(isVisible("#prompt")).toBe(true);
    expect(
      (document.getElementById("prompt-text") as HTMLTextAreaElement).value,
    ).toContain("SOURCE_DATA");

    click("#destination-actions button");
    await flush();
    expect(isVisible("#success")).toBe(true);
    expect(textOf("#success-message")).toMatch(/copied/i);
    expect(store.history).toHaveLength(1);
  });

  it("blocks Build prompt when all source inclusions are off", async () => {
    await boot();
    click('#primary-actions button[data-action-id="article.summarize"]');
    await flush();
    click("#continue-to-review");
    await flush();

    (document.getElementById("include-title-url") as HTMLInputElement).checked =
      false;
    (document.getElementById("include-page-body") as HTMLInputElement).checked =
      false;
    (document.getElementById("include-selected-text") as HTMLInputElement).checked =
      false;
    document.getElementById("include-title-url")?.dispatchEvent(
      new Event("change", { bubbles: true }),
    );
    await flush();

    const build = document.getElementById("build-prompt") as HTMLButtonElement;
    expect(build.disabled).toBe(true);
    expect(textOf("#status")).toBe(EMPTY_SOURCE_INCLUSION_MESSAGE);
  });

  it("shows stale state on PAGE_CONTEXT_CLEARED for the bound tab", async () => {
    const { pushEvent } = await boot();
    expect(isVisible("#choose")).toBe(true);

    pushEvent({
      type: "PAGE_CONTEXT_CLEARED",
      tabId: 7,
      reason: "navigated",
    });
    await flush();

    expect(isVisible("#stale")).toBe(true);
    expect(textOf("#stale-message")).toBe(STALE_CONTEXT_MESSAGE);
    expect(textOf("#status")).toBe("");
  });

  it("shows empty state when no page is captured", async () => {
    store.latest = { pageContext: null };
    await boot();
    expect(isVisible("#empty")).toBe(true);
    expect(textOf("#empty-message")).toMatch(/no page captured/i);
  });

  it("shows stale state when refresh fails because access was revoked", async () => {
    store.extractError =
      "PromptAhead no longer has access to this tab. Chrome revokes it when the page navigates — click the PromptAhead icon on the page again.";
    await boot();
    click("#refresh-context");
    await flush();
    expect(isVisible("#stale")).toBe(true);
    expect(isVisible("#fallback")).toBe(false);
    expect(textOf("#stale-message")).toMatch(/no longer has access/i);
    expect(textOf("#status")).toBe("");
  });

  it("shows extraction fallback when refresh fails for other reasons", async () => {
    store.extractError = "The page returned no content to extract.";
    await boot();
    click("#refresh-context");
    await flush();
    expect(isVisible("#fallback")).toBe(true);
    expect(textOf("#fallback-message")).toMatch(/no content/i);
  });

  it("completes onboarding with basic private mode and then shows the workflow", async () => {
    await boot({ onboardingIncomplete: true });
    expect(isVisible("#onboarding")).toBe(true);
    expect(document.body.classList.contains("onboarding-active")).toBe(true);
    // Workflow must not warm under the overlay (DOM-31 hang).
    expect(isVisible("#choose")).toBe(false);

    click('[data-step="welcome"] [data-onboarding-action="next"]');
    await flush();
    expect(isVisible('[data-step="mode"]')).toBe(true);

    click('[data-mode-choice="manual"]');
    click('[data-step="mode"] [data-onboarding-action="mode-continue"]');
    await flush();
    const dest = document.getElementById(
      "onboarding-destination",
    ) as HTMLSelectElement;
    dest.value = "chatgpt";
    dest.dispatchEvent(new Event("change", { bubbles: true }));

    click('[data-step="destination"] [data-onboarding-action="next"]');
    await flush();
    expect(isVisible('[data-step="nano"]')).toBe(true);
    await flush();
    click('[data-step="nano"] [data-onboarding-action="nano-basic"]');
    await flush();

    expect(isVisible("#onboarding")).toBe(false);
    expect(store.onboarding.completed).toBe(true);
    expect(store.settings.defaultDestination).toBe("chatgpt");
    expect(store.settings.nanoPreference).toBe("basic");
    expect(store.settings.mode).toBe("manual");
    expect(store.onboarding.nanoStepSkipped).toBe(true);
    expect(isVisible("#choose")).toBe(true);
  });

  it("grants Smart host permission from onboarding before leaving the mode step", async () => {
    resetOnboardingForTests();
    mountExtensionHtml("sidepanel/index.html");
    store = {
      settings: { ...DEFAULT_SETTINGS },
      onboarding: { ...DEFAULT_ONBOARDING },
      history: [],
      latest: { pageContext: samplePage, tabId: 7 },
    };
    const { send, listeners } = createSend(store);
    const state = { granted: false };
    const permissionsApi = {
      contains: async () => state.granted,
      request: async () => {
        state.granted = true;
        return true;
      },
      remove: async () => {
        state.granted = false;
        return true;
      },
    };

    controller = await initSidePanel({
      sendToBackground: send,
      selectSuggestionEngine: async () => mockEngine(),
      openLLMWithFallback: async () => ({
        copied: true,
        openedUrl: null,
        mode: "copy-only",
        usedModel: null,
      }),
      openOptionsPage: vi.fn(),
      addMessageListener: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
      maybeStartOnboarding: async (afterComplete, deps) => {
        const { maybeStartOnboarding } = await import(
          "../../extension/src/sidepanel/onboarding"
        );
        return maybeStartOnboarding(afterComplete, {
          ...deps,
          permissionsApi,
        });
      },
    });
    await flush();

    click('[data-step="welcome"] [data-onboarding-action="next"]');
    await flush();
    expect(isVisible("#onboarding-smart-education")).toBe(true);
    expect(textOf("#onboarding-smart-honesty")).toMatch(/badge first/i);
    expect(textOf("#onboarding-mode-continue")).toMatch(/website access/i);

    click('[data-step="mode"] [data-onboarding-action="mode-continue"]');
    await flush();
    await flush();
    expect(isVisible('[data-step="destination"]')).toBe(true);

    click('[data-step="destination"] [data-onboarding-action="next"]');
    await flush();
    expect(isVisible('[data-step="nano"]')).toBe(true);
    await flush();
    click('[data-step="nano"] [data-onboarding-action="nano-basic"]');
    await flush();

    expect(store.onboarding.completed).toBe(true);
    expect(store.settings.mode).toBe("smart");
    expect(store.settings.smartModeAvailable).toBe(true);
  });

  it("enables Nano from onboarding when LanguageModel is ready", async () => {
    resetOnboardingForTests();
    mountExtensionHtml("sidepanel/index.html");
    store = {
      settings: { ...DEFAULT_SETTINGS },
      onboarding: { ...DEFAULT_ONBOARDING },
      history: [],
      latest: { pageContext: samplePage, tabId: 7 },
    };
    const { send, listeners } = createSend(store);
    const fakeModel = {
      availability: async () => "available" as const,
      create: async () => ({
        prompt: async () => "{}",
        destroy: () => undefined,
      }),
    };

    controller = await initSidePanel({
      sendToBackground: send,
      selectSuggestionEngine: async () => mockEngine(),
      openLLMWithFallback: async () => ({
        copied: true,
        openedUrl: null,
        mode: "copy-only",
        usedModel: null,
      }),
      openOptionsPage: vi.fn(),
      probeNanoReadiness: async () => ({
        state: "ready",
        availability: "available",
        apiPresent: true,
      }),
      addMessageListener: (listener) => {
        listeners.push(listener);
        return () => undefined;
      },
      maybeStartOnboarding: async (afterComplete, deps) => {
        const { maybeStartOnboarding } = await import(
          "../../extension/src/sidepanel/onboarding"
        );
        return maybeStartOnboarding(afterComplete, {
          ...deps,
          getLanguageModel: () => fakeModel,
        });
      },
    });
    await flush();

    click('[data-step="welcome"] [data-onboarding-action="next"]');
    await flush();
    click('[data-mode-choice="manual"]');
    click('[data-step="mode"] [data-onboarding-action="mode-continue"]');
    await flush();
    click('[data-step="destination"] [data-onboarding-action="next"]');
    await flush();
    await flush();

    expect(textOf("#onboarding-nano-heading")).toMatch(/ready/i);
    click('[data-step="nano"] [data-onboarding-action="nano-primary"]');
    await flush();

    expect(store.settings.nanoPreference).toBe("enabled");
    expect(store.onboarding.nanoStepSkipped).toBe(false);
    expect(isVisible("#onboarding")).toBe(false);
  });

  it("shows Retry local AI when Nano falls back to curated", async () => {
    store.settings = { ...DEFAULT_SETTINGS, nanoPreference: "enabled" };
    const nanoThenCurated: SuggestionEngine = {
      id: "nano",
      isAvailable: async () => true,
      suggestActions: async () => ({
        engineId: "curated",
        primary: [primaryAction],
        more: [moreAction],
      }),
      generatePrompt: async () => "TASK",
    };
    await boot({ engine: nanoThenCurated, nanoReadiness: "ready" });
    expect(isVisible("#choose")).toBe(true);
    expect(isVisible("#nano-fallback")).toBe(true);
    expect(textOf("#nano-fallback-copy")).toMatch(/tiny brain/i);
    expect(textOf("#status")).toMatch(/tiny brain/i);
  });

  it("points to Settings when Nano model needs download after uninstall", async () => {
    store.settings = { ...DEFAULT_SETTINGS, nanoPreference: "enabled" };
    const { openOptionsPage } = await boot({ nanoReadiness: "download" });
    expect(isVisible("#choose")).toBe(true);
    expect(isVisible("#nano-fallback")).toBe(true);
    expect(textOf("#nano-fallback-copy")).toMatch(/isn.t ready|isn.t installed|stuck/i);
    expect(isVisible("#nano-open-settings")).toBe(true);
    expect(isVisible("#nano-retry")).toBe(false);
    click("#nano-open-settings");
    expect(openOptionsPage).toHaveBeenCalled();
  });

  it("points to Settings when Nano times out despite a ready probe", async () => {
    store.settings = { ...DEFAULT_SETTINGS, nanoPreference: "enabled" };
    const timedOutNano: SuggestionEngine = {
      id: "nano",
      isAvailable: async () => true,
      suggestActions: async () => ({
        engineId: "curated",
        primary: [primaryAction],
        more: [moreAction],
        debug: { nanoFailureReason: "Gemini Nano timed out" },
      }),
      generatePrompt: async () => "TASK",
    };
    const { openOptionsPage } = await boot({
      engine: timedOutNano,
      nanoReadiness: "ready",
    });
    expect(isVisible("#choose")).toBe(true);
    expect(isVisible("#nano-fallback")).toBe(true);
    expect(textOf("#nano-fallback-copy")).toMatch(/isn.t ready|stuck/i);
    expect(isVisible("#nano-open-settings")).toBe(true);
    expect(isVisible("#nano-retry")).toBe(false);
    click("#nano-open-settings");
    expect(openOptionsPage).toHaveBeenCalled();
  });

  it("re-shows onboarding after clear-all event", async () => {
    const { pushEvent } = await boot();
    store.onboarding = { ...DEFAULT_ONBOARDING };
    pushEvent({ type: "PAGE_CONTEXT_CLEARED", tabId: -1, reason: "cleared" });
    await flush();
    expect(isVisible("#onboarding")).toBe(true);
  });

  it("ignores PAGE_CONTEXT_UPDATED while first-run onboarding is active", async () => {
    const { pushEvent } = await boot({ onboardingIncomplete: true });
    expect(isVisible("#onboarding")).toBe(true);
    expect(isVisible("#choose")).toBe(false);

    pushEvent({
      type: "PAGE_CONTEXT_UPDATED",
      tabId: 7,
      pageContext: samplePage,
    });
    await flush();

    expect(isVisible("#choose")).toBe(false);
    expect(isVisible("#onboarding")).toBe(true);
  });
});

type SidePanelDepsOpen = (options: {
  prompt: string;
  destination: Settings["defaultDestination"];
}) => Promise<{
  copied: boolean;
  openedUrl: string | null;
  mode: "deeplink" | "fallback-web" | "clipboard" | "copy-only";
  usedModel: string | null;
}>;

describe("options click-through", () => {
  let store: Store;

  beforeEach(() => {
    mountExtensionHtml("options/index.html");
    store = {
      settings: { ...DEFAULT_SETTINGS },
      onboarding: { ...DEFAULT_ONBOARDING, completed: true },
      history: [
        {
          title: "EU AI Act",
          url: "https://example.com/ai-act",
          prompt: "hello",
          destination: "copy",
        },
      ],
      latest: { pageContext: null },
    };
  });

  it("saves destination and language overrides", async () => {
    const { send } = createSend(store);
    initOptions({ sendToBackground: send, confirm: () => true });
    await flush();

    const destination = document.getElementById(
      "destination",
    ) as HTMLSelectElement;
    destination.value = "claude";
    destination.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(store.settings.defaultDestination).toBe("claude");

    const language = document.getElementById(
      "language-preset",
    ) as HTMLSelectElement;
    language.value = "hr";
    language.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(store.settings.languageOverride).toBe("hr");
  });

  it("toggles global proactive pause from Settings", async () => {
    const { send } = createSend(store);
    initOptions({ sendToBackground: send, confirm: () => true });
    await flush();

    const pause = document.getElementById(
      "proactive-pause",
    ) as HTMLInputElement;
    expect(pause).toBeTruthy();
    expect(pause.checked).toBe(false);

    pause.checked = true;
    pause.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(store.settings.proactivePaused).toBe(true);
    expect(textOf("#status")).toMatch(/proactive.*paused/i);

    pause.checked = false;
    pause.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(store.settings.proactivePaused).toBe(false);
    expect(textOf("#status")).toMatch(/resumed/i);
  });

  it("toggles force basic private mode for Nano", async () => {
    const { send } = createSend(store);
    initOptions({
      sendToBackground: send,
      confirm: () => true,
      getLanguageModel: () => ({
        availability: async () => "available",
        create: async () => ({
          prompt: async () => "{}",
          destroy: () => undefined,
        }),
      }),
    });
    await flush();
    await flush();

    const forceBasic = document.getElementById(
      "nano-force-basic",
    ) as HTMLInputElement;
    expect(forceBasic).toBeTruthy();
    forceBasic.checked = true;
    forceBasic.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(store.settings.nanoPreference).toBe("basic");
    expect(textOf("#nano-status")).toMatch(/Basic private mode/i);
  });

  it("enables Nano from settings when the model is already ready", async () => {
    store.settings = { ...DEFAULT_SETTINGS, nanoPreference: "skipped" };
    const { send } = createSend(store);
    initOptions({
      sendToBackground: send,
      confirm: () => true,
      getLanguageModel: () => ({
        availability: async () => "available",
        create: async () => ({
          prompt: async () => "{}",
          destroy: () => undefined,
        }),
      }),
    });
    await flush();
    await flush();

    expect(isVisible("#nano-enable")).toBe(true);
    click("#nano-enable");
    await flush();
    expect(store.settings.nanoPreference).toBe("enabled");
    expect(textOf("#status")).toMatch(/enabled/i);
  });

  it("grants then revokes Smart host permission from Settings", async () => {
    const { send } = createSend(store);
    const state = { granted: false };
    const permissionsApi = {
      contains: async () => state.granted,
      request: async () => {
        state.granted = true;
        return true;
      },
      remove: async () => {
        state.granted = false;
        return true;
      },
    };
    initOptions({
      sendToBackground: send,
      confirm: () => true,
      permissionsApi,
    });
    await flush();
    await flush();

    expect(textOf("#smart-education-summary")).toMatch(/optional access/i);
    expect(textOf("#smart-education-honesty")).toMatch(/badge first/i);
    expect(isVisible("#smart-enable")).toBe(true);

    click("#smart-enable");
    await flush();
    await flush();
    expect(store.settings.mode).toBe("smart");
    expect(store.settings.smartModeAvailable).toBe(true);
    expect(isVisible("#smart-revoke")).toBe(true);
    expect(textOf("#mode-label")).toBe("Smart");

    click("#smart-revoke");
    await flush();
    await flush();
    expect(store.settings.mode).toBe("manual");
    expect(store.settings.smartModeAvailable).toBe(false);
    expect(isVisible("#smart-enable")).toBe(true);
    expect(textOf("#status")).toMatch(/revoked/i);
  });

  it("clears history when confirmed", async () => {
    const { send } = createSend(store);
    initOptions({ sendToBackground: send, confirm: () => true });
    await flush();

    click("#clear-history");
    await flush();
    expect(store.history).toHaveLength(0);
    expect(textOf("#status")).toMatch(/history cleared/i);
  });

  it("clears all data and restores defaults", async () => {
    store.settings.developerMode = true;
    store.settings.defaultDestination = "gemini";
    store.settings.nanoPreference = "enabled";
    const { send } = createSend(store);
    initOptions({ sendToBackground: send, confirm: () => true });
    await flush();

    click("#clear-all");
    await flush();
    expect(store.settings.defaultDestination).toBe("copy");
    expect(store.settings.developerMode).toBe(false);
    expect(store.settings.nanoPreference).toBe("skipped");
    expect(store.onboarding.completed).toBe(false);
    expect(textOf("#status")).toMatch(/all local data cleared/i);
  });

  it("skips clear-all when confirm is cancelled", async () => {
    store.settings.defaultDestination = "gemini";
    const { send } = createSend(store);
    initOptions({ sendToBackground: send, confirm: () => false });
    await flush();

    click("#clear-all");
    await flush();
    expect(store.settings.defaultDestination).toBe("gemini");
  });
});
