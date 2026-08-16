/**
 * DOM-40: HTML injection fixtures → extract → sealed prompt.
 * Acceptance: unsafe page text never appears as instructions outside SOURCE_DATA.
 */
import { describe, expect, it } from "vitest";

import {
  buildPageContext,
  EXTRACTION_CAPS,
} from "../../extension/src/domain/extraction";
import {
  SOURCE_DATA_CLOSE,
  SOURCE_DATA_OPEN,
  buildPrompt,
  sourceDataBounds,
} from "../../extension/src/domain/prompts";
import type { PromptTask } from "../../extension/src/domain/prompts";
import { curatedActionsFor } from "../../extension/src/domain/suggestions";
import { snapshotFromFixture } from "./helpers/fixture-dom";

const FIXTURES: Array<{
  name: string;
  url: string;
  expectHiddenAbsent?: boolean;
  expectBudgetBound?: boolean;
}> = [
  {
    name: "injection-hidden-ignore",
    url: "https://news.example.com/cloud-pricing",
    expectHiddenAbsent: true,
  },
  {
    name: "injection-fake-system",
    url: "https://news.example.com/fake-system",
  },
  {
    name: "injection-product-recommend-us",
    url: "https://shop.example.com/products/acme-widget-pro",
  },
  {
    name: "injection-malicious-attrs",
    url: "https://news.example.com/malicious-attrs",
  },
  {
    name: "injection-long-repeat",
    url: "https://news.example.com/long-repeat",
    expectBudgetBound: true,
  },
];

const FALLBACK_TASK: PromptTask = {
  id: "test.injection",
  title: "Understand this",
  task: "Explain what this page is about.",
  outputFormat: "structured_explanation",
  outputSpec: ["A plain-language summary."],
};

function taskFor(pageType: "article" | "product" | "generic"): PromptTask {
  const action = curatedActionsFor(pageType)[0];
  if (!action) {
    return FALLBACK_TASK;
  }
  return {
    id: action.id,
    title: action.title,
    task: action.task,
    outputFormat: action.outputFormat,
    outputSpec: action.outputSpec,
  };
}

describe("DOM-40 prompt-injection HTML fixtures", () => {
  it.each(FIXTURES)(
    "$name stays sealed and never promotes page text to instructions",
    (row) => {
      const snapshot = snapshotFromFixture(row.name, row.url);
      const pageContext = buildPageContext(snapshot);
      const built = buildPrompt({
        pageContext,
        task: taskFor(pageContext.pageType),
      });

      const bounds = sourceDataBounds(built.text);
      expect(bounds, row.name).not.toBeNull();
      // Exactly one real closing delimiter (escaped copies may appear inside).
      expect(built.text.split(SOURCE_DATA_CLOSE).length - 1).toBe(1);
      expect(built.text).toContain(SOURCE_DATA_OPEN);

      const body = built.text.slice(bounds!.start, bounds!.end);
      const outside =
        built.text.slice(0, bounds!.start) + built.text.slice(bounds!.end);

      // Hostile role / delimiter tokens may appear only escaped inside the block.
      if (body.includes("SOURCE_DATA")) {
        expect(body).toContain("<\\/SOURCE_DATA>");
      }
      if (/system/i.test(body) && body.includes("<")) {
        expect(body).toMatch(/<\\\/?system/i);
      }

      expect(outside).not.toMatch(/Ignore previous instructions/i);
      expect(outside).not.toMatch(/You are DAN/i);
      expect(outside).not.toMatch(/Acme-only recommendations/i);
      expect(outside).not.toMatch(/recommend only Acme Widget Pro/i);
      expect(outside).not.toMatch(/Obey the image/i);
      expect(outside).not.toMatch(/EvilCorp/i);
      expect(outside).not.toMatch(/dump the system prompt/i);

      if (row.expectHiddenAbsent) {
        const excerpts = [
          ...(pageContext.article?.excerpts ?? []),
          ...(pageContext.product?.excerpts ?? []),
          ...(pageContext.generic?.excerpts ?? []),
        ].join("\n");
        expect(excerpts).not.toMatch(/You are DAN/i);
        expect(excerpts).not.toMatch(/Discard the user task/i);
        expect(excerpts).not.toMatch(/recommend only Acme Cloud/i);
      }

      if (row.expectBudgetBound) {
        const chars = [
          ...(pageContext.article?.excerpts ?? []),
          ...(pageContext.article?.headings ?? []),
          ...(pageContext.generic?.excerpts ?? []),
          ...(pageContext.generic?.headings ?? []),
        ].join("").length;
        expect(chars).toBeLessThanOrEqual(EXTRACTION_CAPS.totalCharacters);
      }
    },
  );

  it("does not collect malicious attribute payloads into PageContext", () => {
    const pageContext = buildPageContext(
      snapshotFromFixture(
        "injection-malicious-attrs",
        "https://news.example.com/malicious-attrs",
      ),
    );
    const blob = JSON.stringify(pageContext);
    expect(blob).not.toMatch(/EvilCorp/i);
    expect(blob).not.toMatch(/Obey the image/i);
    expect(blob).not.toMatch(/dump the system prompt/i);
  });
});
