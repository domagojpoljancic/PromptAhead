import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { registerBackgroundRouter } from "../../extension/src/background/router";
import {
  ACCESS_LOST_ERROR,
  RESTRICTED_PAGE_ERROR,
} from "../../extension/src/background/extraction";
import {
  captureTabContext,
  clearPageContextCache,
  forgetPageContext,
  readLatestPageContext,
} from "../../extension/src/background/page-context-store";
import { sendToBackground } from "../../extension/src/shared/messaging";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
  type ChromeMockOptions,
} from "./helpers/chrome-mock";
import { snapshotFromFixture } from "./helpers/fixture-dom";

const PRODUCT_URL = "https://shop.example.com/products/aurora-14";
const TAB_ID = 42;

function mockWithPage(overrides: Partial<ChromeMockOptions> = {}): ChromeMock {
  const snapshotResult = {
    ok: true as const,
    snapshot: snapshotFromFixture("product-jsonld", PRODUCT_URL),
  };
  return installChromeMock({
    activeTab: { id: TAB_ID, url: PRODUCT_URL },
    executeScript: (details) => {
      // Sensitive DOM probe (`pa-sensitive`) vs snapshot collect (limits arg).
      if (details.args?.[0] === "pa-sensitive") {
        return { blocked: false, category: null, reason: "not_sensitive" };
      }
      return snapshotResult;
    },
    ...overrides,
  });
}

describe("Manual-mode extraction path", () => {
  afterEach(() => {
    clearPageContextCache();
    uninstallChromeMock();
  });

  beforeEach(() => {
    clearPageContextCache();
  });

  it("extracts on demand and remembers the result for the tab", async () => {
    const mock = mockWithPage();
    registerBackgroundRouter();

    const extracted = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });
    expect(extracted.ok && extracted.pageContext.pageType).toBe("product");
    expect(mock.injections).toEqual([TAB_ID, TAB_ID]);

    const latest = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });
    expect(latest.ok && latest.pageContext?.title).toBe("Aurora 14 Laptop");
    // The cached read must not cost another injection.
    expect(mock.injections).toEqual([TAB_ID, TAB_ID]);
  });

  it("answers a read that arrives while the gesture extraction is still running", async () => {
    mockWithPage();

    const capture = captureTabContext(TAB_ID, PRODUCT_URL);
    const latest = await readLatestPageContext(TAB_ID);
    await capture;

    expect(latest.pageContext?.pageType).toBe("product");
  });

  it("prefers the last gesture tab when the panel asks without tabId", async () => {
    mockWithPage({
      activeTab: { id: 99, url: "https://other.example/" },
    });
    registerBackgroundRouter();

    await captureTabContext(TAB_ID, PRODUCT_URL);
    const latest = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });

    expect(latest.ok && latest.tabId).toBe(TAB_ID);
    expect(latest.ok && latest.pageContext?.title).toBe("Aurora 14 Laptop");
  });

  it("EXTRACT without tabId uses the focused tab, not lastGesture (DOM-74)", async () => {
    const focusedId = 99;
    const focusedUrl = "https://shop.example.com/products/other-widget";
    const mock = mockWithPage({
      activeTab: { id: focusedId, url: focusedUrl },
      executeScript: (details) => {
        if (details.args?.[0] === "pa-sensitive") {
          return { blocked: false, category: null, reason: "not_sensitive" };
        }
        return {
          ok: true as const,
          snapshot: snapshotFromFixture("product-jsonld", focusedUrl),
        };
      },
    });
    registerBackgroundRouter();

    // Seed last-gesture on a different tab (bound/gesture page before a switch).
    await captureTabContext(TAB_ID, PRODUCT_URL);
    mock.injections.length = 0;

    const extracted = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });
    expect(extracted.ok).toBe(true);
    expect(extracted.ok && extracted.tabId).toBe(focusedId);
    expect(mock.injections.length).toBeGreaterThan(0);
    expect(mock.injections.every((id) => id === focusedId)).toBe(true);
    expect(mock.injections).not.toContain(TAB_ID);
  });

  it("forgets a tab once it navigates or closes", async () => {
    mockWithPage();

    await captureTabContext(TAB_ID, PRODUCT_URL);
    forgetPageContext(TAB_ID);

    expect(await readLatestPageContext(TAB_ID)).toEqual({ pageContext: null });
  });

  it("does not let a superseded run repopulate a forgotten tab", async () => {
    mockWithPage();

    const capture = captureTabContext(TAB_ID, PRODUCT_URL);
    forgetPageContext(TAB_ID);
    await capture;

    expect(await readLatestPageContext(TAB_ID)).toEqual({ pageContext: null });
  });

  it("refuses restricted pages without attempting injection", async () => {
    const mock = mockWithPage({
      activeTab: { id: TAB_ID, url: "chrome://extensions" },
    });
    registerBackgroundRouter();

    const response = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });

    expect(response.ok).toBe(false);
    expect(!response.ok && response.error).toBe(RESTRICTED_PAGE_ERROR);
    expect(mock.injections).toEqual([]);
  });

  it("turns a revoked activeTab grant into an actionable message", async () => {
    mockWithPage({ executeScript: undefined });
    registerBackgroundRouter();

    const response = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });
    expect(!response.ok && response.error).toBe(ACCESS_LOST_ERROR);
    expect(!response.ok && response.tabId).toBe(TAB_ID);

    const latest = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });
    expect(latest.ok && latest.pageContext).toBeNull();
    expect(latest.ok && latest.error).toBe(ACCESS_LOST_ERROR);
  });

  it("reports in-page extraction failures instead of guessing", async () => {
    mockWithPage({
      executeScript: (details) => {
        if (details.args?.[0] === "pa-sensitive") {
          return { blocked: false, category: null, reason: "not_sensitive" };
        }
        return { ok: false, error: "boom" };
      },
    });
    registerBackgroundRouter();

    const response = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });

    expect(!response.ok && response.error).toMatch(/boom/);
  });

  it("blocks Manual extract on sensitive URL until force override", async () => {
    const events: unknown[] = [];
    mockWithPage({
      activeTab: { id: TAB_ID, url: "https://bank.example.com/accounts" },
      executeScript: (details) => {
        if (details.args?.[0] === "pa-sensitive") {
          return { blocked: false, category: null, reason: "not_sensitive" };
        }
        return {
          ok: true,
          snapshot: snapshotFromFixture(
            "product-jsonld",
            "https://bank.example.com/accounts",
          ),
        };
      },
    });
    chrome.runtime.onMessage.addListener((message) => {
      events.push(message);
      return undefined;
    });
    registerBackgroundRouter();

    const blocked = await sendToBackground({ type: "EXTRACT_ACTIVE_TAB" });
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.error).toMatch(/sensitive/i);
    expect(
      events.some(
        (e) =>
          typeof e === "object" &&
          e !== null &&
          (e as { type?: string }).type === "SENSITIVE_PAGE_BLOCKED",
      ),
    ).toBe(true);

    const latest = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });
    expect(latest.ok && latest.sensitiveBlock?.category).toBe("banking");
    expect(latest.ok && latest.pageContext).toBeNull();

    const forced = await sendToBackground({
      type: "EXTRACT_ACTIVE_TAB",
      force: true,
    });
    expect(forced.ok).toBe(true);

    const afterForce = await sendToBackground({ type: "GET_LATEST_PAGE_CONTEXT" });
    expect(afterForce.ok && afterForce.sensitiveBlock).toBeUndefined();
    expect(afterForce.ok && afterForce.pageContext).not.toBeNull();
  });
});
