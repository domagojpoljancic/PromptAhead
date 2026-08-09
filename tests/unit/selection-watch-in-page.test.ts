// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installSelectionWatchInPage,
  stopSelectionWatchInPage,
} from "../../extension/src/content/selection-watch-in-page";
import { SELECTION_WATCH_OPTIONS } from "../../extension/src/background/selection-watch";

describe("installSelectionWatchInPage", () => {
  beforeEach(() => {
    stopSelectionWatchInPage();
    document.body.replaceChildren();
    vi.stubGlobal("chrome", {
      runtime: {
        sendMessage: vi.fn(() => Promise.resolve()),
      },
    });
  });

  afterEach(() => {
    stopSelectionWatchInPage();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("notifies after a stable selection above the min length", () => {
    vi.useFakeTimers();
    const sendMessage = chrome.runtime.sendMessage as ReturnType<typeof vi.fn>;
    const result = installSelectionWatchInPage({
      debounceMs: 50,
      minChars: 12,
    });
    expect(result.watching).toBe(true);
    expect(result.already).toBe(false);

    const node = document.createTextNode("enough characters here");
    document.body.append(node);
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    vi.advanceTimersByTime(50);
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "SELECTION_READY", textLength: 22 }),
    );
  });

  it("is idempotent when installed twice", () => {
    const first = installSelectionWatchInPage(SELECTION_WATCH_OPTIONS);
    const second = installSelectionWatchInPage(SELECTION_WATCH_OPTIONS);
    expect(first.already).toBe(false);
    expect(second.already).toBe(true);
  });
});
