/**
 * Launch Chromium with a copy of `extension/dist/` plus a test-only
 * `host_permissions` grant for the local fixture origin. Production
 * `extension/dist/manifest.json` is never modified.
 */

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DIST_DIR = join(REPO_ROOT, "extension", "dist");

export type ExtensionSession = {
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  extensionDir: string;
  optionsUrl: string;
  sidePanelUrl: string;
  close: () => Promise<void>;
};

function patchManifest(extensionDir: string, fixtureOrigin: string): void {
  const manifestPath = join(extensionDir, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    host_permissions?: string[];
  };
  const pattern = `${fixtureOrigin}/*`;
  const existing = manifest.host_permissions ?? [];
  if (!existing.includes(pattern)) {
    manifest.host_permissions = [...existing, pattern];
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function waitForServiceWorker(
  context: BrowserContext,
): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing[0]) {
    return existing[0];
  }
  return context.waitForEvent("serviceworker");
}

function extensionIdFromWorker(worker: Worker): string {
  const match = /chrome-extension:\/\/([^/]+)\//.exec(worker.url());
  if (!match?.[1]) {
    throw new Error(`Could not parse extension id from ${worker.url()}`);
  }
  return match[1];
}

export async function launchExtension(
  fixtureOrigin: string,
): Promise<ExtensionSession> {
  const extensionDir = mkdtempSync(join(tmpdir(), "promptahead-e2e-"));
  cpSync(DIST_DIR, extensionDir, { recursive: true });
  patchManifest(extensionDir, fixtureOrigin);

  const userDataDir = mkdtempSync(join(tmpdir(), "promptahead-profile-"));
  const headed = process.env.HEADED === "1" || process.env.PWDEBUG === "1";

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: !headed,
    args: [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const serviceWorker = await waitForServiceWorker(context);
  // Give the worker a beat to register message listeners.
  await new Promise((resolve) => setTimeout(resolve, 250));
  const extensionId = extensionIdFromWorker(serviceWorker);
  const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`;
  const sidePanelUrl = `chrome-extension://${extensionId}/src/sidepanel/index.html`;

  return {
    context,
    extensionId,
    serviceWorker,
    extensionDir,
    optionsUrl,
    sidePanelUrl,
    close: async () => {
      await context.close();
      rmSync(extensionDir, { recursive: true, force: true });
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

export async function openExtensionPage(
  session: ExtensionSession,
  url: string,
): Promise<Page> {
  const page = await session.context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

/** Typed ping through an open extension page (options / side panel). */
export async function pingBackground(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const response = (await chrome.runtime.sendMessage({ type: "PING" })) as {
      ok?: boolean;
      pong?: boolean;
    };
    return Boolean(response?.ok && response.pong);
  });
}
