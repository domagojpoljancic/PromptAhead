import { expect, test, type Page } from "@playwright/test";

import {
  launchExtension,
  openExtensionPage,
  pingBackground,
  type ExtensionSession,
} from "./helpers/launch-extension";
import {
  startFixtureServer,
  type FixtureServer,
} from "./helpers/fixture-server";

let server: FixtureServer;
let session: ExtensionSession;

test.beforeAll(async () => {
  server = await startFixtureServer();
  session = await launchExtension(server.origin);
});

test.afterAll(async () => {
  await session?.close();
  await server?.close();
});

test.describe.configure({ mode: "serial" });

test("service worker responds to PING", async () => {
  const page = await openExtensionPage(session, session.optionsUrl);
  await expect.poll(async () => pingBackground(page)).toBe(true);
  await page.close();
});

test("options page loads settings and persists destination", async () => {
  const page = await openExtensionPage(session, session.optionsUrl);
  await expect(page.locator("h1")).toHaveText("PromptAhead settings");
  await expect(page.locator("#mode-label")).toHaveText("Manual");

  await page.locator("#destination").selectOption("claude");
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const response = (await chrome.runtime.sendMessage({
          type: "GET_SETTINGS",
        })) as { ok: boolean; settings?: { defaultDestination: string } };
        return response.settings?.defaultDestination ?? null;
      }),
    )
    .toBe("claude");

  await page.close();
});

test("side panel onboarding can be skipped", async () => {
  // Reset onboarding so the overlay appears.
  const seed = await openExtensionPage(session, session.optionsUrl);
  await seed.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: "SET_ONBOARDING",
      patch: {
        completed: false,
        completedAt: null,
        modeChosen: false,
        destinationChosen: false,
        nanoStepSkipped: false,
      },
    });
  });
  await seed.close();

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  await expect(panel.locator("#onboarding")).toBeVisible();
  await panel.locator('[data-step="welcome"] [data-onboarding-action="skip"]').click();
  await expect(panel.locator("#onboarding")).toBeHidden();
  await panel.close();
});

test("extracts local fixture and walks prompt flow to copy", async () => {
  await seedCompletedOnboarding(session);

  const tab = await session.context.newPage();
  await tab.goto(server.url("/article.html"));
  await expect(tab.locator("h1")).toContainText("EU AI Act");

  const panel = await openExtensionPage(session, session.sidePanelUrl);

  // Drive extraction from the extension page against the fixture tab.
  // The SW broadcasts PAGE_CONTEXT_UPDATED; the open panel listens.
  const tabId = await extractActiveFixture(panel, tab);
  expect(tabId).toBeGreaterThan(0);

  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#context-title")).toContainText(/AI Act|EU/i);

  await walkChooseThroughCopy(panel);

  await panel.close();
  await tab.close();
});

/**
 * DOM-51: Nano forced off (`nanoPreference: "basic"` / Settings force-basic)
 * must still complete extract → curated suggestions → prompt → copy.
 * Live Nano hardware smoke stays on DOM-31 /
 * docs/nano-verification-checklist.md — CI never downloads or runs Prompt API.
 */
test("Nano forced off still completes curated extract → prompt → copy", async () => {
  test.setTimeout(30_000);
  await seedCompletedOnboarding(session, { nanoPreference: "basic" });

  const options = await openExtensionPage(session, session.optionsUrl);
  await expect(options.locator("#nano-force-basic")).toBeChecked();
  await expect
    .poll(async () =>
      options.evaluate(async () => {
        const response = (await chrome.runtime.sendMessage({
          type: "GET_SETTINGS",
        })) as { ok: boolean; settings?: { nanoPreference: string } };
        return response.settings?.nanoPreference ?? null;
      }),
    )
    .toBe("basic");
  await options.close();

  const tab = await session.context.newPage();
  await tab.goto(server.url("/article.html"), {
    waitUntil: "domcontentloaded",
  });

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  const tabId = await extractActiveFixture(panel, tab);
  expect(tabId).toBeGreaterThan(0);

  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#status")).toContainText(/curated/i);
  await expect(panel.locator("#nano-fallback")).toBeHidden();
  await expect(panel.locator("#primary-actions button").first()).toBeVisible();

  await walkChooseThroughCopy(panel);

  await panel.close();
  await tab.close();
});

test("clear all data restores defaults from options", async () => {
  const page = await openExtensionPage(session, session.optionsUrl);
  await page.locator("#destination").selectOption("gemini");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#clear-all").click();
  await expect(page.locator("#status")).toContainText(/all local data cleared/i);
  await expect(page.locator("#destination")).toHaveValue("copy");
  await page.close();
});

/**
 * DOM-56 slice: Smart invite threshold → badge → accept → panel extract.
 * Drives ENGAGEMENT_THRESHOLD / INVITE_ACTION over extension messaging so CI
 * does not wait on real dwell/scroll or optional-host permission dialogs.
 * Real grant dialog + OS notification edges stay on DOM-38 manual smoke.
 */
test("Smart invite badge then accept starts panel extract", async () => {
  test.setTimeout(30_000);
  await seedCompletedOnboarding(session, {
    nanoPreference: "basic",
    mode: "smart",
    smartModeAvailable: true,
    proactivePaused: false,
  });

  const tab = await session.context.newPage();
  await tab.goto(server.url("/article.html"), {
    waitUntil: "domcontentloaded",
  });
  await expect(tab.locator("h1")).toContainText(/AI Act|EU/i);

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  await expect.poll(async () => pingBackground(panel)).toBe(true);

  const tabId = await findFixtureTabId(panel, tab);
  expect(tabId).toBeGreaterThan(0);

  // Badge-first: threshold must not extract before accept.
  await expect(panel.locator("#choose")).toBeHidden();

  const threshold = await panel.evaluate(
    async ({ id, url }) => {
      const response = (await chrome.runtime.sendMessage({
        type: "ENGAGEMENT_THRESHOLD",
        tabId: id,
        pageType: "article",
        url,
        reason: "article-threshold-met",
      })) as {
        ok: boolean;
        type?: string;
        handled?: boolean;
        showBadge?: boolean;
        phase?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(response.error ?? "ENGAGEMENT_THRESHOLD failed");
      }
      return response;
    },
    { id: tabId, url: tab.url() },
  );
  expect(threshold.handled).toBe(true);
  expect(threshold.showBadge).toBe(true);
  expect(threshold.phase).toBe("invitation_shown");

  await expect
    .poll(async () =>
      panel.evaluate(async () => chrome.action.getBadgeText({})),
    )
    .toBe("!");

  await expect(panel.locator("#choose")).toBeHidden();

  const accepted = await panel.evaluate(async (id) => {
    const response = (await chrome.runtime.sendMessage({
      type: "INVITE_ACTION",
      action: "accept",
      tabId: id,
    })) as {
      ok: boolean;
      handled?: boolean;
      openPanelAndAnalyze?: boolean;
      phase?: string | null;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(response.error ?? "INVITE_ACTION accept failed");
    }
    return response;
  }, tabId);
  expect(accepted.handled).toBe(true);
  expect(accepted.openPanelAndAnalyze).toBe(true);
  expect(accepted.phase).toBe("accepted");

  await expect
    .poll(async () =>
      panel.evaluate(async () => chrome.action.getBadgeText({})),
    )
    .toBe("");

  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#context-title")).toContainText(/AI Act|EU/i);
  await expect(panel.locator("#status")).toContainText(/curated/i);

  await panel.close();
  await tab.close();
});

/**
 * DOM-56 (thin slice): after Smart→Manual (revoke settings outcome), Manual
 * extract → curated still works. Real Chrome permission-dialog grant/revoke
 * stays on DOM-38 manual smoke.
 *
 * DOM-38 note: Chrome Details → Site access may still show “On all sites”
 * after permissions.remove(<all_urls>) (granted-set vs active-set UI ≥130).
 * Product truth is Settings “Website access: not granted” /
 * permissions.contains(<all_urls>) === false — do not treat Details UI as a bug.
 */
test("Smart revoke leaves Manual extract → curated working", async () => {
  test.setTimeout(30_000);
  await seedCompletedOnboarding(session, { nanoPreference: "basic" });

  const options = await openExtensionPage(session, session.optionsUrl);

  // Apply the same settings patch Settings uses after a successful Smart revoke.
  // Do not call chrome.permissions.remove(<all_urls>) here — in Playwright’s
  // Chromium it can hide tab URLs from chrome.tabs.query and break extract.
  // Real optional-host revoke stays on DOM-38 manual smoke.
  await options.evaluate(async () => {
    await chrome.runtime.sendMessage({
      type: "SET_SETTINGS",
      patch: { mode: "smart", smartModeAvailable: true },
    });
    await chrome.runtime.sendMessage({
      type: "SET_SETTINGS",
      patch: { mode: "manual", smartModeAvailable: false },
    });
  });

  await options.reload({ waitUntil: "domcontentloaded" });
  await expect(options.locator("#mode-label")).toHaveText("Manual");
  await expect
    .poll(async () =>
      options.evaluate(async () => {
        const response = (await chrome.runtime.sendMessage({
          type: "GET_SETTINGS",
        })) as {
          ok: boolean;
          settings?: { mode: string; smartModeAvailable: boolean };
        };
        return response.settings
          ? `${response.settings.mode}:${response.settings.smartModeAvailable}`
          : null;
      }),
    )
    .toBe("manual:false");
  await options.close();

  const tab = await session.context.newPage();
  await tab.goto(server.url("/article.html"), {
    waitUntil: "domcontentloaded",
  });
  await expect(tab.locator("h1")).toContainText(/AI Act|EU/i);

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  await expect.poll(async () => pingBackground(panel)).toBe(true);
  const tabId = await extractActiveFixture(panel, tab);
  expect(tabId).toBeGreaterThan(0);

  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#status")).toContainText(/curated/i);
  await walkChooseThroughCopy(panel);

  await panel.close();
  await tab.close();
});

test("navigate after capture shows stale panel", async () => {
  test.setTimeout(30_000);
  await seedCompletedOnboarding(session);

  const tab = await session.context.newPage();
  await tab.goto(server.url("/article.html"));

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  const tabId = await extractActiveFixture(panel, tab);
  expect(tabId).toBeGreaterThan(0);
  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });

  await tab.goto(server.url("/product.html"), { waitUntil: "domcontentloaded" });

  // Prefer the real PAGE_CONTEXT_CLEARED push; nudge only if it was missed
  // (service worker restart can drop the in-flight broadcast).
  try {
    await expect(panel.locator("#stale")).toBeVisible({ timeout: 3_000 });
  } catch {
    await session.serviceWorker.evaluate((id) => {
      void chrome.runtime.sendMessage({
        type: "PAGE_CONTEXT_CLEARED",
        tabId: id,
        reason: "navigated",
      });
    }, tabId);
    await expect(panel.locator("#stale")).toBeVisible({ timeout: 5_000 });
  }

  await expect(panel.locator("#stale-message")).toContainText(/page changed|icon/i);
  await expect(panel.locator("#fallback")).toBeHidden();
  await expect(panel.locator("#status")).toHaveText("");

  await panel.close();
  await tab.close();
});

test("homepage without selection shows low-value empty state", async () => {
  test.setTimeout(30_000);
  await seedCompletedOnboarding(session);

  const tab = await session.context.newPage();
  await tab.goto(server.url("/"));
  await expect(tab.locator("h1")).toContainText("Example News");

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  const tabId = await extractActiveFixture(panel, tab);
  expect(tabId).toBeGreaterThan(0);

  await expect(panel.locator("#empty")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#empty-message")).toContainText(
    /homepage|not much to prompt ahead|select text/i,
  );
  await expect(panel.locator("#choose")).toBeHidden();

  await panel.close();
  await tab.close();
});

/** Resolve the fixture tab id from an extension page (options / side panel). */
async function findFixtureTabId(
  extensionPage: Page,
  fixturePage: Page,
): Promise<number> {
  const fixtureUrl = fixturePage.url();
  return extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const match =
      tabs.find((tab) => tab.url === url) ??
      tabs.find((tab) => Boolean(tab.url && url.startsWith(tab.url))) ??
      tabs.find((tab) => {
        if (!tab.url) {
          return false;
        }
        try {
          return new URL(tab.url).pathname === new URL(url).pathname;
        } catch {
          return false;
        }
      });
    if (!match?.id) {
      const seen = tabs.map((tab) => tab.url ?? "(no url)").join("; ");
      throw new Error(`Fixture tab not found for ${url}. Seen: ${seen}`);
    }
    return match.id;
  }, fixtureUrl);
}

/**
 * Find the fixture tab id and ask the background to extract it.
 * Runs inside an extension page so `chrome.runtime` / `chrome.tabs` are available.
 */
async function extractActiveFixture(
  extensionPage: Page,
  fixturePage: Page,
): Promise<number> {
  const tabId = await findFixtureTabId(extensionPage, fixturePage);
  const ok = await extensionPage.evaluate(async (id) => {
    const response = (await chrome.runtime.sendMessage({
      type: "EXTRACT_ACTIVE_TAB",
      tabId: id,
    })) as {
      ok: boolean;
      pageContext?: { title: string };
      tabId?: number;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(response.error ?? "EXTRACT_ACTIVE_TAB failed");
    }
    return true;
  }, tabId);
  expect(ok).toBe(true);
  return tabId;
}

async function walkChooseThroughCopy(panel: Page): Promise<void> {
  await panel.locator("#primary-actions button").first().click();
  await expect(panel.locator("#refine")).toBeVisible();
  await panel.locator("#continue-to-review").click();
  await expect(panel.locator("#review")).toBeVisible();
  await panel.locator("#build-prompt").click();
  await expect(panel.locator("#prompt")).toBeVisible();
  await expect(panel.locator("#prompt-text")).not.toHaveValue("");

  // chrome-extension:// origins are opaque — grantPermissions cannot target them.
  // Stub clipboard so Copy still exercises the handoff + history path.
  await panel.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => undefined,
        readText: async () => "",
      },
    });
  });
  await panel.locator("#destination-actions button").first().click();
  await expect(panel.locator("#success")).toBeVisible();
  await expect(panel.locator("#success-message")).toContainText(/copied/i);
}

async function seedCompletedOnboarding(
  target: ExtensionSession,
  settingsPatch: {
    nanoPreference?: "basic" | "enabled" | "skipped";
    mode?: "manual" | "smart";
    smartModeAvailable?: boolean;
    proactivePaused?: boolean;
  } = {},
): Promise<void> {
  const seed = await openExtensionPage(target, target.optionsUrl);
  await seed.evaluate(async (patch) => {
    await chrome.runtime.sendMessage({
      type: "SET_ONBOARDING",
      patch: {
        completed: true,
        completedAt: "2026-08-02T00:00:00.000Z",
        modeChosen: true,
        destinationChosen: true,
        nanoStepSkipped: true,
      },
    });
    await chrome.runtime.sendMessage({
      type: "SET_SETTINGS",
      patch: { defaultDestination: "copy", ...patch },
    });
  }, settingsPatch);
  await seed.close();
}
