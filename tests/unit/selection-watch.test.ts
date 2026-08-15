import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearSelectionWatchState,
  forgetSelectionWatch,
  handleSelectionReady,
  isAwaitingPageUpgrade,
  isSelectionWatchActive,
  startSelectionWatch,
  stopSelectionWatch,
  tryUpgradeAfterNavigation,
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
  let smartGranted = false;

  beforeEach(() => {
    clearPageContextCache();
    clearSelectionWatchState();
    smartGranted = false;
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
        if (details.args[0] === "pa-sensitive") {
          return { blocked: false, category: null, reason: "not_sensitive" };
        }
        return {
          ok: true,
          snapshot: {
            ...snapshotFromFixture(
              "article-jsonld",
              "https://news.example.com/2026/03/eu-ai-act",
            ),
            url: "https://news.example.com/2026/03/eu-ai-act",
            title: "EU AI Act",
          },
        };
      },
    });
    (mock.api as unknown as { permissions: {
      contains: (details: { origins?: string[] }) => Promise<boolean>;
      request: () => Promise<boolean>;
      remove: () => Promise<boolean>;
    } }).permissions = {
      contains: async () => smartGranted,
      request: async () => smartGranted,
      remove: async () => true,
    };
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
    expect(isAwaitingPageUpgrade(9)).toBe(true);

    const outcome = await handleSelectionReady(9, "https://news.example.com/");
    expect(outcome.handled).toBe(true);
    expect(isSelectionWatchActive(9)).toBe(false);
    expect(mock.injections.length).toBeGreaterThan(0);
  });

  it("ignores SELECTION_READY when the tab is not watched", async () => {
    const outcome = await handleSelectionReady(9, "https://news.example.com/");
    expect(outcome.handled).toBe(false);
  });

  it("forgetSelectionWatch drops listener bookkeeping but keeps upgrade await", async () => {
    await startSelectionWatch(9);
    forgetSelectionWatch(9);
    expect(isSelectionWatchActive(9)).toBe(false);
    expect(isAwaitingPageUpgrade(9)).toBe(true);
    const outcome = await handleSelectionReady(9);
    expect(outcome.handled).toBe(false);
  });

  it("stopSelectionWatch clears watch and upgrade await", async () => {
    await startSelectionWatch(9);
    await stopSelectionWatch(9);
    expect(isSelectionWatchActive(9)).toBe(false);
    expect(isAwaitingPageUpgrade(9)).toBe(false);
  });

  it("tryUpgradeAfterNavigation captures when Smart host is granted (DOM-62)", async () => {
    smartGranted = true;
    await startSelectionWatch(9);
    forgetSelectionWatch(9);

    const result = await tryUpgradeAfterNavigation(
      9,
      "https://news.example.com/2026/03/eu-ai-act",
    );
    expect(result).toEqual({ attempted: true, captured: true });
    expect(isAwaitingPageUpgrade(9)).toBe(false);
    expect(mock.injections.length).toBeGreaterThan(0);
  });

  it("tryUpgradeAfterNavigation no-ops without Smart host (DOM-62)", async () => {
    smartGranted = false;
    await startSelectionWatch(9);
    forgetSelectionWatch(9);

    const result = await tryUpgradeAfterNavigation(
      9,
      "https://news.example.com/2026/03/eu-ai-act",
    );
    expect(result).toEqual({ attempted: true, captured: false });
  });
});
