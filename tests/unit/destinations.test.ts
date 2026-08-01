import { describe, expect, it, vi } from "vitest";

import {
  DESTINATION_OPEN_URLS,
  copyAndMaybeOpen,
  destinationLabel,
  isBlankChatUrl,
  openUrlForDestination,
} from "../../extension/src/domain/destinations";

describe("destinations", () => {
  it("labels every destination", () => {
    expect(destinationLabel("copy")).toBe("Copy only");
    expect(destinationLabel("chatgpt")).toMatch(/ChatGPT/i);
  });

  it("returns blank chat URLs with no prompt payload", () => {
    expect(openUrlForDestination("copy")).toBeNull();
    for (const [id, url] of Object.entries(DESTINATION_OPEN_URLS)) {
      expect(openUrlForDestination(id as keyof typeof DESTINATION_OPEN_URLS)).toBe(
        url,
      );
      expect(isBlankChatUrl(url)).toBe(true);
      expect(url).not.toMatch(/[?#].+/);
    }
  });

  it("rejects URLs that embed a prompt", () => {
    expect(isBlankChatUrl("https://chatgpt.com/?q=ignore+previous")).toBe(false);
    expect(isBlankChatUrl("https://claude.ai/new#prompt=hi")).toBe(false);
  });

  it("copies then opens without putting the prompt in the URL", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const opened: string[] = [];
    const prompt = "Portable prompt with <SOURCE_DATA>…";

    const result = await copyAndMaybeOpen({
      prompt,
      destination: "claude",
      openTab: (url) => {
        opened.push(url);
      },
    });

    expect(writeText).toHaveBeenCalledWith(prompt);
    expect(opened).toEqual([DESTINATION_OPEN_URLS.claude]);
    expect(result.openedUrl).toBe(DESTINATION_OPEN_URLS.claude);
    expect(opened[0]).not.toContain(prompt);
  });

  it("copy-only skips opening a tab", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const openTab = vi.fn();

    const result = await copyAndMaybeOpen({
      prompt: "only copy",
      destination: "copy",
      openTab,
    });

    expect(writeText).toHaveBeenCalledWith("only copy");
    expect(openTab).not.toHaveBeenCalled();
    expect(result.openedUrl).toBeNull();
  });
});
