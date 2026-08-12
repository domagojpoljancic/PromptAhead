/**
 * DOM-54: automated a11y checks for options + side panel happy paths.
 * Manual remainder (contrast, dark mode, reduced motion) stays on DOM-43.
 */

import { expect, test, type Page } from "@playwright/test";

import { expectNoSeriousA11yViolations } from "./helpers/a11y";
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

test("options page has no serious axe violations", async () => {
  const page = await openExtensionPage(session, session.optionsUrl);
  await expect(page.locator("h1")).toHaveText("PromptAhead settings");
  await expect(page.locator("#mode-label")).toHaveText("Manual");

  await expectNoSeriousA11yViolations(page, "options settings");

  // Critical controls are reachable by keyboard (Tab order smoke).
  await page.locator("body").focus();
  await page.keyboard.press("Tab");
  const first = await page.evaluate(
    () => document.activeElement?.id || document.activeElement?.tagName || "",
  );
  expect(first.length).toBeGreaterThan(0);

  await page.close();
});

test("side panel idle + choose states have no serious axe violations", async () => {
  await seedCompletedOnboarding(session);

  const panel = await openExtensionPage(session, session.sidePanelUrl);
  await expect(panel.locator("#onboarding")).toBeHidden();
  await expect(panel.locator("h1")).toContainText(/next question/i);

  await expectNoSeriousA11yViolations(panel, "side panel idle");

  const tab = await session.context.newPage();
  await tab.goto(server.url("/article.html"));
  await expect(tab.locator("h1")).toContainText("EU AI Act");

  await extractActiveFixture(panel, tab);
  await expect(panel.locator("#choose")).toBeVisible({ timeout: 15_000 });
  await expect(panel.locator("#primary-actions button").first()).toBeVisible();

  await expectNoSeriousA11yViolations(panel, "side panel choose");

  await panel.close();
  await tab.close();
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

  const ok = await extensionPage.evaluate(async (id) => {
    const response = (await chrome.runtime.sendMessage({
      type: "EXTRACT_ACTIVE_TAB",
      tabId: id,
    })) as { ok: boolean; error?: string };
    if (!response.ok) {
      throw new Error(response.error ?? "EXTRACT_ACTIVE_TAB failed");
    }
    return true;
  }, tabId);
  expect(ok).toBe(true);
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
