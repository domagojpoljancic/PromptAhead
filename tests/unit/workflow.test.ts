import { describe, expect, it } from "vitest";

import type { PageContext } from "../../extension/src/shared/types/page-context";
import {
  applyContextInclusion,
  applyUserNoteInclusion,
  DEFAULT_CONTEXT_INCLUSION,
  hasUsableSourceInclusion,
  inclusionAvailability,
} from "../../extension/src/sidepanel/context-inclusion";
import {
  previousStep,
  STALE_CONTEXT_MESSAGE,
} from "../../extension/src/sidepanel/workflow";
import { buildPrompt } from "../../extension/src/domain/prompts";
import type { PromptTask } from "../../extension/src/domain/prompts";

const task: PromptTask = {
  id: "test.task",
  title: "Summarize",
  task: "Summarize the page.",
  outputFormat: "structured_explanation",
  outputSpec: ["Short summary."],
};

function samplePage(): PageContext {
  return {
    schemaVersion: 1,
    pageType: "article",
    language: "en",
    title: "EU AI Act",
    url: "https://example.com/ai-act",
    description: "Overview.",
    selectedText: "highlighted passage",
    article: {
      publisher: "Example News",
      headings: ["Timeline"],
      excerpts: ["The regulation applies in stages."],
    },
  };
}

describe("workflow previousStep", () => {
  it("walks the happy path backwards", () => {
    expect(previousStep("refine")).toBe("choose");
    expect(previousStep("review")).toBe("refine");
    expect(previousStep("prompt")).toBe("review");
    expect(previousStep("success")).toBe("prompt");
    expect(previousStep("choose")).toBeNull();
    expect(previousStep("stale")).toBeNull();
  });

  it("exposes the stale copy used by the panel", () => {
    expect(STALE_CONTEXT_MESSAGE).toMatch(/page changed/i);
  });
});

describe("context inclusion", () => {
  it("defaults to including everything", () => {
    expect(DEFAULT_CONTEXT_INCLUSION).toEqual({
      titleUrl: true,
      pageBody: true,
      selectedText: true,
      userNote: true,
    });
  });

  it("reports which toggles have content", () => {
    expect(inclusionAvailability(samplePage())).toEqual({
      titleUrl: true,
      pageBody: true,
      selectedText: true,
    });
    expect(
      inclusionAvailability({
        schemaVersion: 1,
        pageType: "generic",
        language: "en",
        title: "Bare",
        url: "https://example.com",
      }),
    ).toEqual({
      titleUrl: true,
      pageBody: false,
      selectedText: false,
    });
  });

  it("strips title/url, body, and selection independently", () => {
    const filtered = applyContextInclusion(samplePage(), {
      titleUrl: false,
      pageBody: false,
      selectedText: false,
      userNote: true,
    });

    expect(filtered.title).toBe("");
    expect(filtered.url).toBe("");
    expect(filtered.description).toBeUndefined();
    expect(filtered.article).toBeUndefined();
    expect(filtered.selectedText).toBeUndefined();
    expect(filtered.pageType).toBe("article");
  });

  it("keeps selected text when page body is off", () => {
    const filtered = applyContextInclusion(samplePage(), {
      titleUrl: true,
      pageBody: false,
      selectedText: true,
      userNote: true,
    });
    expect(filtered.selectedText).toBe("highlighted passage");
    expect(filtered.article).toBeUndefined();
  });

  it("omits the user note when toggled off", () => {
    expect(applyUserNoteInclusion("focus on costs", { ...DEFAULT_CONTEXT_INCLUSION, userNote: false })).toBe(
      "",
    );
    expect(
      applyUserNoteInclusion("focus on costs", DEFAULT_CONTEXT_INCLUSION),
    ).toBe("focus on costs");
  });

  it("rejects builds with no page-sourced inclusions", () => {
    const availability = inclusionAvailability(samplePage());
    expect(
      hasUsableSourceInclusion(
        {
          titleUrl: false,
          pageBody: false,
          selectedText: false,
          userNote: true,
        },
        availability,
      ),
    ).toBe(false);
    expect(
      hasUsableSourceInclusion(
        {
          titleUrl: false,
          pageBody: true,
          selectedText: false,
          userNote: false,
        },
        availability,
      ),
    ).toBe(true);
  });

  it("changes the built prompt when inclusions change", () => {
    const page = samplePage();
    const full = buildPrompt({
      pageContext: applyContextInclusion(page, DEFAULT_CONTEXT_INCLUSION),
      task,
      userNote: applyUserNoteInclusion("note-alpha", DEFAULT_CONTEXT_INCLUSION),
    });
    const slim = buildPrompt({
      pageContext: applyContextInclusion(page, {
        titleUrl: false,
        pageBody: true,
        selectedText: false,
        userNote: false,
      }),
      task,
      userNote: applyUserNoteInclusion("note-alpha", {
        titleUrl: false,
        pageBody: true,
        selectedText: false,
        userNote: false,
      }),
    });

    expect(full.text).toContain("EU AI Act");
    expect(full.text).toContain("highlighted passage");
    expect(full.text).toContain("note-alpha");
    expect(slim.text).not.toContain("EU AI Act");
    expect(slim.text).not.toContain("highlighted passage");
    expect(slim.text).not.toContain("note-alpha");
    expect(slim.text).toContain("The regulation applies in stages.");
  });
});
