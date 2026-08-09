import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearSelectionWatchState,
  forgetSelectionWatch,
  handleSelectionReady,
  isSelectionWatchActive,
  startSelectionWatch,
  stopSelectionWatch,
} from "../../extension/src/background/selection-watch";
import { clearPageContextCache } from "../../extension/src/background/page-context-store";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
  type InjectionDetails,
} from "./helpers/chrome-mock";
import { snapshotFromFixture } from "./helpers/fixture-dom";

describe("selection-watch SW helpers", () => {
  let mock: ChromeMock;

  beforeEach(() => {
    clearPageContextCache();
    clearSelectionWatchState();
    mock = installChromeMock({
      activeTab: { id: 9, url: "https://news.example.com/" },
      senderTabId: 9,
      executeScript: (details: InjectionDetails) => {
        const arg = details.args?.[0];
        if (
          arg &&
          typeof arg === "object" &&
          "debounceMs" in arg &&
          "minChars" in arg
        ) {
          return { watching: true, already: false };
        }
        if (!details.args || details.args.length === 0) {
          return { stopped: true };
        }
        // Snapshot collection limits → return a selected homepage capture.
        return {
          ok: true,
          snapshot: {
            ...snapshotFromFixture("homepage-thin", "https://news.example.com/"),
            selectedText: "selected passage long enough",
            url: "https://news.example.com/",
            title: "Example News",
          },
        };
      },
    });
  });

  afterEach(() => {
    clearPageContextCache();
    clearSelectionWatchState();
    uninstallChromeMock();
  });

  it("tracks watched tabs and re-extracts on SELECTION_READY", async () => {
    const started = await startSelectionWatch(9);
    expect(started).toBe(true);
    expect(isSelectionWatchActive(9)).toBe(true);

    const outcome = await handleSelectionReady(9, "https://news.example.com/");
    expect(outcome.handled).toBe(true);
    expect(isSelectionWatchActive(9)).toBe(false);
    expect(mock.injections.length).toBeGreaterThan(1);
  });

  it("ignores SELECTION_READY when the tab is not watched", async () => {
    const outcome = await handleSelectionReady(9, "https://news.example.com/");
    expect(outcome.handled).toBe(false);
  });

  it("forgetSelectionWatch drops bookkeeping without requiring injection", async () => {
    await startSelectionWatch(9);
    forgetSelectionWatch(9);
    expect(isSelectionWatchActive(9)).toBe(false);
    const outcome = await handleSelectionReady(9);
    expect(outcome.handled).toBe(false);
  });

  it("stopSelectionWatch clears the active set", async () => {
    await startSelectionWatch(9);
    await stopSelectionWatch(9);
    expect(isSelectionWatchActive(9)).toBe(false);
  });
});
