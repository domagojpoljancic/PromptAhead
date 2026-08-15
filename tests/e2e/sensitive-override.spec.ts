/**
 * DOM-39: Manual sensitive override — block on login fixture, force extract.
 * Cap: one thin Playwright path for this push.
 */

import { expect, test, type Page } from "@playwright/test";

import {
  launchExtension,
  openExtensionPage,
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

test("sensitive login blocks until Analyze anyway; FP article does not", async () => {
  await seedCompletedOnboarding(session);

  const tab = await session.context.newPage();
  await tab.goto(server.url("/sensitive-login.html"));
  await expect(tab.locator("h1")).toContainText(/sign in/i);

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  await extractActiveFixture(panel, tab);

  await expect(panel.locator("#sensitive-override")).toBeVisible({
    timeout: 15_000,
  });
  await expect(panel.locator("#sensitive-override-confirm")).toBeVisible();
  await expect(panel.locator("#choose")).toBeHidden();

  await panel.locator("#sensitive-override-confirm").click();
  await expect(panel.locator("#sensitive-override")).toBeHidden();
  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });

  await panel.close();
  await tab.close();

  // False-positive control: article mentioning bank must not show the modal.
  const fpTab = await session.context.newPage();
  await fpTab.goto(server.url("/article-mentions-bank.html"));
  const fpPanel = await openExtensionPage(session, session.sidePanelUrl);
  await extractActiveFixture(fpPanel, fpTab);
  await expect(fpPanel.locator("#sensitive-override")).toBeHidden();
  await expect(fpPanel.locator("#choose")).toBeVisible({ timeout: 15_000 });

  await fpPanel.close();
  await fpTab.close();
});

async function extractActiveFixture(
  extensionPage: Page,
  fixturePage: Page,
): Promise<number> {
  const fixtureUrl = fixturePage.url();
  const tabId = await extensionPage.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    const match = tabs.find((t) => t.url === url);
    if (!match?.id) {
      throw new Error(`No tab for ${url}`);
    }
    return match.id;
  }, fixtureUrl);

  await extensionPage.evaluate(async (id) => {
    await chrome.runtime.sendMessage({
      type: "EXTRACT_ACTIVE_TAB",
      tabId: id,
    });
  }, tabId);
  return tabId;
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
      patch: { defaultDestination: "copy", nanoPreference: "basic" },
    });
  });
  await seed.close();
}
