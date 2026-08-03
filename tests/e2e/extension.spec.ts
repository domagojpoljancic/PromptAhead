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

/**
 * Find the fixture tab id and ask the background to extract it.
 * Runs inside an extension page so `chrome.runtime` / `chrome.tabs` are available.
 */
async function extractActiveFixture(
  extensionPage: Page,
  fixturePage: Page,
): Promise<number> {
  const fixtureUrl = fixturePage.url();
  return extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((tab) => tab.url === url);
    if (!match?.id) {
      throw new Error(`Fixture tab not found for ${url}`);
    }
    const response = (await chrome.runtime.sendMessage({
      type: "EXTRACT_ACTIVE_TAB",
      tabId: match.id,
    })) as {
      ok: boolean;
      pageContext?: { title: string };
      tabId?: number;
      error?: string;
    };
    if (!response.ok) {
      throw new Error(response.error ?? "EXTRACT_ACTIVE_TAB failed");
    }
    return match.id;
  }, fixtureUrl);
}

async function seedCompletedOnboarding(
  target: ExtensionSession,
): Promise<void> {
  const seed = await openExtensionPage(target, target.optionsUrl);
  await seed.evaluate(async () => {
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
      patch: { defaultDestination: "copy" },
    });
  });
  await seed.close();
}
