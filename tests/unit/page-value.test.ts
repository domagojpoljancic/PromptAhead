import { describe, expect, it } from "vitest";

import {
  assessPagePromptValue,
  assessUrlPromptValue,
  isAppOrEditorHost,
  lowValueMessageFor,
  toSelectionOnlyContext,
} from "../../extension/src/domain/page-value";
import type { PageContext } from "../../extension/src/shared/types/page-context";

function articleContext(url: string): PageContext {
  return {
    schemaVersion: 1,
    pageType: "article",
    language: "en",
    title: "EU AI Act",
    url,
    description: "Overview.",
    article: {
      headings: ["Timeline"],
      excerpts: ["The regulation applies in stages across the union."],
    },
  };
}

function thinGeneric(url: string): PageContext {
  return {
    schemaVersion: 1,
    pageType: "generic",
    language: "en",
    title: "Sparse",
    url,
    generic: { headings: [], excerpts: ["Hi."] },
  };
}

describe("isAppOrEditorHost", () => {
  it("matches listed hosts and subdomains", () => {
    expect(isAppOrEditorHost("docs.google.com")).toBe(true);
    expect(isAppOrEditorHost("mail.google.com")).toBe(true);
    expect(isAppOrEditorHost("www.notion.so")).toBe(true);
    expect(isAppOrEditorHost("acme.sharepoint.com")).toBe(true);
    expect(isAppOrEditorHost("jira.atlassian.net")).toBe(true);
  });

  it("rejects ordinary content hosts", () => {
    expect(isAppOrEditorHost("news.example.com")).toBe(false);
    expect(isAppOrEditorHost("google.com")).toBe(false);
    expect(isAppOrEditorHost("github.com")).toBe(false);
  });
});

describe("assessUrlPromptValue", () => {
  it("flags app/editor hosts", () => {
    expect(
      assessUrlPromptValue("https://docs.google.com/document/d/abc/edit"),
    ).toEqual({ worthPrompting: false, reason: "app-or-editor" });
    expect(
      assessUrlPromptValue("https://www.figma.com/file/xyz"),
    ).toEqual({ worthPrompting: false, reason: "app-or-editor" });
  });

  it("flags site home", () => {
    expect(assessUrlPromptValue("https://news.example.com/")).toEqual({
      worthPrompting: false,
      reason: "site-home",
    });
    expect(assessUrlPromptValue("https://news.example.com")).toEqual({
      worthPrompting: false,
      reason: "site-home",
    });
  });

  it("flags listing and search URLs", () => {
    expect(
      assessUrlPromptValue("https://shop.example.com/category/laptops"),
    ).toEqual({ worthPrompting: false, reason: "listing-or-search" });
    expect(
      assessUrlPromptValue("https://shop.example.com/search?q=laptop"),
    ).toEqual({ worthPrompting: false, reason: "listing-or-search" });
    expect(
      assessUrlPromptValue("https://news.example.com/section/world"),
    ).toEqual({ worthPrompting: false, reason: "listing-or-search" });
    expect(
      assessUrlPromptValue("https://news.example.com/topic/ai"),
    ).toEqual({ worthPrompting: false, reason: "listing-or-search" });
  });

  it("allows real article and product detail URLs", () => {
    expect(
      assessUrlPromptValue("https://news.example.com/2026/03/eu-ai-act"),
    ).toEqual({ worthPrompting: true, reason: "worth-prompting" });
    expect(
      assessUrlPromptValue("https://shop.example.com/products/aurora-14"),
    ).toEqual({ worthPrompting: true, reason: "worth-prompting" });
  });
});

describe("assessPagePromptValue", () => {
  it("keeps URL reasons and adds thin-content for sparse generics", () => {
    expect(
      assessPagePromptValue(
        articleContext("https://docs.google.com/document/d/abc/edit"),
      ).reason,
    ).toBe("app-or-editor");

    expect(
      assessPagePromptValue(thinGeneric("https://example.com/about")).reason,
    ).toBe("thin-content");

    expect(
      assessPagePromptValue(
        articleContext("https://news.example.com/2026/03/eu-ai-act"),
      ),
    ).toEqual({ worthPrompting: true, reason: "worth-prompting" });
  });

  it("does not treat article/product as thin even with short excerpts", () => {
    const shortArticle: PageContext = {
      schemaVersion: 1,
      pageType: "article",
      language: "en",
      title: "Brief",
      url: "https://news.example.com/brief",
      article: { headings: [], excerpts: ["Hi."] },
    };
    expect(assessPagePromptValue(shortArticle).worthPrompting).toBe(true);
  });

  it("keeps small comparable sets worth prompting on listing URLs (DOM-64)", () => {
    const listingWithThree: PageContext = {
      schemaVersion: 1,
      pageType: "generic",
      language: "en",
      title: "Laptops",
      url: "https://shop.example.com/category/laptops",
      generic: {
        headings: ["Laptops"],
        excerpts: ["Showing 3 of 148 laptops."],
      },
      comparableSet: {
        kind: "product",
        names: ["Aurora 14 Laptop", "Aurora 16 Laptop", "Nimbus Air 13"],
      },
    };
    expect(assessPagePromptValue(listingWithThree)).toEqual({
      worthPrompting: true,
      reason: "worth-prompting",
    });
  });

  it("still empties listing URLs without a small named set", () => {
    expect(
      assessPagePromptValue({
        schemaVersion: 1,
        pageType: "generic",
        language: "en",
        title: "Laptops",
        url: "https://shop.example.com/category/laptops",
        generic: {
          headings: ["Laptops"],
          excerpts: ["Hundreds of models — use filters to narrow the range."],
        },
      }),
    ).toEqual({ worthPrompting: false, reason: "listing-or-search" });
  });
});

describe("lowValueMessageFor", () => {
  it("returns selection escape hatch for each reason", () => {
    expect(lowValueMessageFor("app-or-editor")).toMatch(/select text/i);
    expect(lowValueMessageFor("site-home")).toMatch(/homepage/i);
    expect(lowValueMessageFor("listing-or-search")).toMatch(/list of results/i);
    expect(lowValueMessageFor("thin-content")).toMatch(/more content/i);
  });
});

describe("toSelectionOnlyContext", () => {
  it("drops body sections and description", () => {
    const source: PageContext = {
      ...articleContext("https://news.example.com/"),
      selectedText: "highlighted passage",
      description: "Overview.",
      product: {
        specifications: [{ name: "Weight", value: "1kg" }],
        excerpts: ["Heavy."],
      },
    };
    const only = toSelectionOnlyContext(source);
    expect(only).toEqual({
      schemaVersion: 1,
      pageType: "generic",
      language: "en",
      title: "EU AI Act",
      url: "https://news.example.com/",
      selectedText: "highlighted passage",
    });
    expect(only.article).toBeUndefined();
    expect(only.product).toBeUndefined();
    expect(only.generic).toBeUndefined();
    expect(only.description).toBeUndefined();
  });
});
