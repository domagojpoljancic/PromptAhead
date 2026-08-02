import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerBackgroundRouter } from "../../extension/src/background/router";
import {
  isBackgroundEvent,
  isBackgroundRequest,
  isBackgroundResponse,
  sendToBackground,
} from "../../extension/src/shared/messaging";
import { STORAGE_KEYS } from "../../extension/src/shared/storage";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from "./helpers/chrome-mock";

describe("isBackgroundRequest", () => {
  it("accepts declared requests", () => {
    expect(isBackgroundRequest({ type: "PING" })).toBe(true);
    expect(isBackgroundRequest({ type: "GET_SETTINGS" })).toBe(true);
    expect(
      isBackgroundRequest({ type: "SET_SETTINGS", patch: { developerMode: true } }),
    ).toBe(true);
    expect(isBackgroundRequest({ type: "OPEN_SIDE_PANEL", tabId: 7 })).toBe(true);
    expect(isBackgroundRequest({ type: "GET_LATEST_PAGE_CONTEXT" })).toBe(true);
    expect(isBackgroundRequest({ type: "CLEAR_RECENT_HISTORY" })).toBe(true);
    expect(isBackgroundRequest({ type: "CLEAR_LEARNED_PREFS" })).toBe(true);
  });

  it("rejects foreign or malformed messages", () => {
    expect(isBackgroundRequest(null)).toBe(false);
    expect(isBackgroundRequest("PING")).toBe(false);
    expect(isBackgroundRequest({})).toBe(false);
    expect(isBackgroundRequest({ type: "RUN_SPIKE" })).toBe(false);
    expect(isBackgroundRequest({ type: "SET_SETTINGS" })).toBe(false);
    expect(isBackgroundRequest({ type: "SET_SETTINGS", patch: "manual" })).toBe(false);
    expect(isBackgroundRequest({ type: "OPEN_SIDE_PANEL", tabId: "7" })).toBe(false);
    expect(isBackgroundRequest({ type: "ADD_RECENT_PROMPT" })).toBe(false);
    expect(
      isBackgroundRequest({
        type: "ADD_RECENT_PROMPT",
        entry: { title: "t", url: "u", prompt: "p", destination: "fax" },
      }),
    ).toBe(false);
  });
});

describe("isBackgroundResponse", () => {
  it("distinguishes responses from arbitrary values", () => {
    expect(isBackgroundResponse({ ok: true, type: "PING", pong: true })).toBe(true);
    expect(isBackgroundResponse({ ok: false, type: "UNKNOWN", error: "nope" })).toBe(
      true,
    );
    expect(isBackgroundResponse({ ok: true, type: "NOT_A_REQUEST" })).toBe(false);
    expect(isBackgroundResponse({ ok: false, type: "PING" })).toBe(false);
    expect(isBackgroundResponse(undefined)).toBe(false);
  });
});

describe("isBackgroundEvent", () => {
  it("accepts PAGE_CONTEXT_CLEARED pushes", () => {
    expect(
      isBackgroundEvent({
        type: "PAGE_CONTEXT_CLEARED",
        tabId: 7,
        reason: "navigated",
      }),
    ).toBe(true);
    expect(
      isBackgroundEvent({
        type: "PAGE_CONTEXT_CLEARED",
        tabId: 7,
        reason: "closed",
      }),
    ).toBe(true);
  });

  it("accepts PAGE_CONTEXT_UPDATED pushes", () => {
    expect(
      isBackgroundEvent({
        type: "PAGE_CONTEXT_UPDATED",
        tabId: 7,
        pageContext: {
          schemaVersion: 1,
          pageType: "generic",
          language: "en",
          title: "Hello",
          url: "https://example.com",
        },
      }),
    ).toBe(true);
  });

  it("rejects request-shaped or malformed values", () => {
    expect(isBackgroundEvent({ type: "PING" })).toBe(false);
    expect(
      isBackgroundEvent({ type: "PAGE_CONTEXT_CLEARED", tabId: "7", reason: "navigated" }),
    ).toBe(false);
    expect(
      isBackgroundEvent({ type: "PAGE_CONTEXT_CLEARED", tabId: 7, reason: "reload" }),
    ).toBe(false);
    expect(
      isBackgroundEvent({
        type: "PAGE_CONTEXT_UPDATED",
        tabId: 7,
        pageContext: { title: "nope" },
      }),
    ).toBe(false);
  });
});

describe("panel ⇄ service worker round trip", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    mock = installChromeMock();
    registerBackgroundRouter();
  });

  afterEach(() => {
    uninstallChromeMock();
  });

  it("answers PING", async () => {
    const response = await sendToBackground({ type: "PING" });

    expect(response.ok).toBe(true);
    expect(response).toMatchObject({ type: "PING", pong: true });
  });

  it("reads and writes settings without touching chrome.storage directly", async () => {
    const initial = await sendToBackground({ type: "GET_SETTINGS" });
    expect(initial.ok && initial.settings.defaultDestination).toBe("copy");

    const saved = await sendToBackground({
      type: "SET_SETTINGS",
      patch: { defaultDestination: "chatgpt" },
    });
    expect(saved.ok && saved.settings.defaultDestination).toBe("chatgpt");

    const reread = await sendToBackground({ type: "GET_SETTINGS" });
    expect(reread.ok && reread.settings.defaultDestination).toBe("chatgpt");
    expect(mock.storage[STORAGE_KEYS.settings]).toMatchObject({
      defaultDestination: "chatgpt",
    });
  });

  it("returns an empty history and clears all data", async () => {
    await sendToBackground({ type: "SET_SETTINGS", patch: { developerMode: true } });

    const history = await sendToBackground({ type: "GET_RECENT_HISTORY" });
    expect(history.ok && history.history.entries).toEqual([]);

    const cleared = await sendToBackground({ type: "CLEAR_ALL_DATA" });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) {
      return;
    }
    expect(cleared.settings.developerMode).toBe(false);
    expect(cleared.settings.defaultDestination).toBe("copy");
    expect(cleared.onboarding.completed).toBe(false);
    expect(mock.storage[STORAGE_KEYS.settings]).toMatchObject({
      developerMode: false,
      mode: "manual",
    });
    expect(mock.storage[STORAGE_KEYS.onboarding]).toMatchObject({
      completed: false,
    });
  });

  it("persists onboarding completion through the router", async () => {
    const before = await sendToBackground({ type: "GET_ONBOARDING" });
    expect(before.ok && before.onboarding.completed).toBe(false);

    const saved = await sendToBackground({
      type: "SET_ONBOARDING",
      patch: {
        completed: true,
        completedAt: "2026-08-02T12:00:00.000Z",
        modeChosen: true,
        destinationChosen: true,
        nanoStepSkipped: true,
      },
    });
    expect(saved.ok && saved.onboarding.completed).toBe(true);
    expect(saved.ok && saved.onboarding.nanoStepSkipped).toBe(true);

    const reread = await sendToBackground({ type: "GET_ONBOARDING" });
    expect(reread.ok && reread.onboarding).toMatchObject({
      completed: true,
      modeChosen: true,
      destinationChosen: true,
      nanoStepSkipped: true,
    });
  });

  it("clears recent history and learned prefs without wiping settings", async () => {
    await sendToBackground({
      type: "SET_SETTINGS",
      patch: { defaultDestination: "claude", developerMode: true },
    });
    await sendToBackground({
      type: "ADD_RECENT_PROMPT",
      entry: {
        title: "Keep settings",
        url: "https://example.com",
        prompt: "hello",
        destination: "copy",
      },
    });
    mock.storage[STORAGE_KEYS.learningAggregates] = {
      schemaVersion: 1,
      actionCategoryCounts: { summarize: 2 },
      invitationsAccepted: 1,
      invitationsDismissed: 0,
    };

    const clearedHistory = await sendToBackground({ type: "CLEAR_RECENT_HISTORY" });
    expect(clearedHistory.ok && clearedHistory.history.entries).toEqual([]);

    const clearedLearned = await sendToBackground({ type: "CLEAR_LEARNED_PREFS" });
    expect(clearedLearned.ok).toBe(true);
    expect(mock.storage[STORAGE_KEYS.learningAggregates]).toBeUndefined();

    const settings = await sendToBackground({ type: "GET_SETTINGS" });
    expect(settings.ok && settings.settings.defaultDestination).toBe("claude");
    expect(settings.ok && settings.settings.developerMode).toBe(true);
  });

  it("appends a recent prompt through the router", async () => {
    const added = await sendToBackground({
      type: "ADD_RECENT_PROMPT",
      entry: {
        title: "EU AI Act",
        url: "https://example.com/ai-act",
        prompt: "Portable prompt",
        destination: "chatgpt",
      },
    });

    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(added.entry.prompt).toBe("Portable prompt");
    expect(added.entry.destination).toBe("chatgpt");
    expect(added.history.entries).toHaveLength(1);
    expect(mock.storage[STORAGE_KEYS.recentHistory]).toMatchObject({
      entries: [{ prompt: "Portable prompt", destination: "chatgpt" }],
    });
  });

  it("reports no cached page context yet", async () => {
    const response = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });

    expect(response.ok && response.pageContext).toBeNull();
    expect(response.ok && response.tabId).toBe(1);
  });

  it("ignores PAGE_CONTEXT_CLEARED push events in the router", async () => {
    await expect(
      chrome.runtime.sendMessage({
        type: "PAGE_CONTEXT_CLEARED",
        tabId: 1,
        reason: "navigated",
      }),
    ).rejects.toThrow(/Receiving end does not exist/i);
  });

  it("explains EXTRACT_ACTIVE_TAB when Chrome refuses injection", async () => {
    const response = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });

    expect(response.ok).toBe(false);
    expect(!response.ok && response.error).toMatch(/no longer has access/i);
  });

  it("opens the side panel for the active tab", async () => {
    const response = await sendToBackground({ type: "OPEN_SIDE_PANEL" });

    expect(response.ok).toBe(true);
    expect(mock.sidePanelOpens).toEqual([1]);
  });

  it("rejects messages that are not background requests", async () => {
    const response: unknown = await chrome.runtime.sendMessage({ type: "RUN_SPIKE" });

    expect(response).toEqual({
      ok: false,
      type: "UNKNOWN",
      error: "Unrecognized message",
    });
  });
});
