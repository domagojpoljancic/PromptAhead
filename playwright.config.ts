import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  // CI: retry transient Chromium/extension launch flakes (DOM-53).
  retries: isCI ? 2 : 0,
  forbidOnly: isCI,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["list"], ["github"]] : "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium-extension",
      use: {
        // Extensions require Chromium (not plain Chrome channel quirks in CI).
        channel: "chromium",
      },
    },
  ],
});
