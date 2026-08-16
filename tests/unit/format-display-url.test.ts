import { describe, expect, it } from "vitest";

import { formatDisplayUrl } from "../../extension/src/shared/format-display-url";

describe("formatDisplayUrl", () => {
  it("shows hostname + path without scheme for short URLs", () => {
    expect(formatDisplayUrl("https://www.example.com/posts/ai-act")).toBe(
      "example.com/posts/ai-act",
    );
  });

  it("truncates long paths with an ellipsis while keeping the host", () => {
    const raw =
      "https://www.ad-hoc-news.de/boerse/news/unternehmensnachrichten/broadcom-s-370-billion-shadow-the-off-balance-sheet-debate-reshaping-its/69955804";
    const display = formatDisplayUrl(raw);
    expect(display.startsWith("ad-hoc-news.de/")).toBe(true);
    expect(display).toContain("…");
    expect(display.length).toBeLessThanOrEqual(52);
    expect(display.endsWith("69955804")).toBe(true);
  });

  it("returns empty for blank input and falls back for non-URLs", () => {
    expect(formatDisplayUrl("")).toBe("");
    expect(formatDisplayUrl("not a url but somewhat long ".repeat(4)).length).toBeLessThanOrEqual(
      52,
    );
  });
});
