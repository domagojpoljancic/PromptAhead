import { defineConfig } from "vitest/config";

/**
 * Coverage gates (DOM-55): modest floors on critical packages only.
 * Raise gradually; do not set so high that feature work is blocked.
 * Interpret / update: docs/test-plan.md § coverage gates.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text", "html"],
      include: [
        "extension/src/domain/**/*.{ts,tsx}",
        "extension/src/shared/messaging/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.d.ts",
        "**/types.ts",
        // Barrel re-exports — thin; not a useful gate signal.
        "**/index.ts",
      ],
      // Floors are below current measured coverage so small refactors don't
      // flake CI; raise after the suite stabilizes further.
      thresholds: {
        lines: 75,
        functions: 75,
        branches: 65,
        statements: 75,
      },
    },
  },
});
