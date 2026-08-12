/**
 * Thin axe helpers for extension pages (DOM-54).
 * Serious/critical violations fail CI; color-contrast is deferred to DOM-43.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const DEFERRED_RULES = [
  // Visual polish / theme contrast stays on DOM-43 manual a11y pass.
  "color-contrast",
];

export async function expectNoSeriousA11yViolations(
  page: Page,
  label: string,
): Promise<void> {
  const results = await new AxeBuilder({ page })
    .disableRules(DEFERRED_RULES)
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );

  const summary = serious
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help} — ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(" "))
          .join("; ")}`,
    )
    .join("\n");

  expect(serious, `${label}\n${summary}`).toEqual([]);
}
