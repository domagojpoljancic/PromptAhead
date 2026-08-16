import { describe, expect, it } from "vitest";

import { extractNamedComparableSets } from "../../extension/src/domain/extraction/comparable-set";
import { renderSourceData } from "../../extension/src/domain/prompts/source-data";
import {
  applyContextInclusion,
  DEFAULT_CONTEXT_INCLUSION,
} from "../../extension/src/sidepanel/context-inclusion";
import type { PageContext } from "../../extension/src/shared/types/page-context";
import { EXTRACTION_CAPS } from "../../extension/src/shared/types/page-context";

function productNodes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    "@type": "Product",
    name: `Product ${String(index + 1).padStart(2, "0")}`,
  }));
}

describe("expandable named products (DOM-68)", () => {
  it("keeps compact comparableSet only when ≤10 named products", () => {
    const result = extractNamedComparableSets(productNodes(4));
    expect(result.comparableSet?.names).toHaveLength(4);
    expect(result.expandableNamedSet).toBeUndefined();
  });

  it("exposes compact ≤10 plus expandable pool when more named products exist", () => {
    const result = extractNamedComparableSets(productNodes(15));
    expect(result.comparableSet?.names).toHaveLength(
      EXTRACTION_CAPS.comparableSetMax,
    );
    expect(result.expandableNamedSet?.totalFound).toBe(15);
    expect(result.expandableNamedSet?.names).toHaveLength(15);
  });

  it("caps the expandable pool and reports totalFound when over the ceiling", () => {
    const result = extractNamedComparableSets(productNodes(55));
    expect(result.comparableSet?.names).toHaveLength(10);
    expect(result.expandableNamedSet?.names).toHaveLength(
      EXTRACTION_CAPS.comparableSetExpandMax,
    );
    expect(result.expandableNamedSet?.totalFound).toBe(55);
  });

  it("does not expand SOURCE_DATA until the user opts in", () => {
    const pageContext: PageContext = {
      schemaVersion: 1,
      pageType: "generic",
      language: "en",
      title: "Laptops",
      url: "https://shop.example.com/laptops",
      comparableSet: {
        kind: "product",
        names: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
      },
      expandableNamedSet: {
        kind: "product",
        names: [
          "A",
          "B",
          "C",
          "D",
          "E",
          "F",
          "G",
          "H",
          "I",
          "J",
          "K",
          "L",
          "M",
          "N",
          "O",
        ],
        totalFound: 15,
      },
    };

    const compact = applyContextInclusion(pageContext, {
      ...DEFAULT_CONTEXT_INCLUSION,
      expandNamedProducts: false,
    });
    expect(compact.comparableSet?.names).toHaveLength(10);

    const expanded = applyContextInclusion(pageContext, {
      ...DEFAULT_CONTEXT_INCLUSION,
      expandNamedProducts: true,
    });
    expect(expanded.comparableSet?.names).toHaveLength(15);

    const source = renderSourceData(expanded);
    expect(source.text).toContain("COMPARABLE_ITEM: O");
    expect(source.text).toMatch(/Included all 15 named products/i);
  });
});
