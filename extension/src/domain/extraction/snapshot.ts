/**
 * In-page snapshot collection for Manual mode.
 *
 * `collectPageSnapshotInPage` is stringified by `chrome.scripting.executeScript`
 * (locked S0.5 pattern), so it must stay self-contained: only its arguments and
 * page globals — no imports, no module-scope constants, no shared helpers.
 * It therefore does the minimum a DOM is needed for and returns plain data;
 * classification, capping and normalization live in pure, testable code.
 */

export type SnapshotLimits = {
  /** Raw ceilings, deliberately looser than the PageContext caps. */
  headings: number;
  textBlocks: number;
  specCandidates: number;
  jsonLdBlocks: number;
  jsonLdBlockChars: number;
  textBlockChars: number;
  selectedTextChars: number;
  productNameCandidates: number;
};

export const RAW_SNAPSHOT_LIMITS: SnapshotLimits = {
  headings: 24,
  textBlocks: 40,
  specCandidates: 40,
  jsonLdBlocks: 8,
  jsonLdBlockChars: 40000,
  textBlockChars: 1200,
  selectedTextChars: 2000,
  /** Raw DOM product titles before comparable-set capping (DOM-64). */
  productNameCandidates: 12,
};

export type RawMetaTag = { key: string; content: string };
export type RawHeading = { level: number; text: string };
export type RawSpecCandidate = { name: string; value: string };

export type RawPageSnapshot = {
  url: string;
  title: string;
  documentLang: string;
  metaTags: RawMetaTag[];
  /** Unparsed `application/ld+json` payloads; parsing happens off-page. */
  jsonLdBlocks: string[];
  headings: RawHeading[];
  textBlocks: string[];
  specCandidates: RawSpecCandidate[];
  selectedText: string;
  hasArticleElement: boolean;
  articleTextChars: number;
  hasTimeElement: boolean;
  microdataProductCount: number;
  /** Visible product-card titles when JSON-LD ItemList is absent (e.g. Zalando). */
  productNameCandidates: string[];
};

export type SnapshotCollectionResult =
  { ok: true; snapshot: RawPageSnapshot } | { ok: false; error: string };

/**
 * Runs in the page world. Never reads form controls, so no field value can
 * reach the extension (handoff §31).
 *
 * Main-content selection is a thin `main`/`article`/`[role=main]` heuristic.
 * Bundling Mozilla Readability is deferred until the license review in DOM-13
 * is settled; the snapshot shape is what a Readability swap would feed.
 */
export function collectPageSnapshotInPage(
  limits: SnapshotLimits,
): SnapshotCollectionResult {
  try {
    // Anything that can hold user input, executable code, or chrome noise.
    const NEVER_READ =
      "form, input, textarea, select, option, optgroup, button, fieldset, legend, label, script, style, noscript, template, svg, iframe, canvas, object, embed";
    const BOILERPLATE =
      "nav, aside, footer, header, [role='navigation'], [role='banner'], [role='contentinfo'], [role='search'], [role='complementary'], [hidden], [aria-hidden='true']";
    const SKIP = NEVER_READ + ", " + BOILERPLATE;

    const normalize = (value: string | null | undefined): string =>
      (value ?? "").replace(/\s+/g, " ").trim();

    const clamp = (value: string, max: number): string =>
      value.length > max ? value.slice(0, max) : value;

    const isHidden = (element: Element): boolean => {
      let node: Element | null = element;
      let depth = 0;
      while (node && depth < 12) {
        if (
          node.hasAttribute("hidden") ||
          node.getAttribute("aria-hidden") === "true"
        ) {
          return true;
        }
        const style = node.getAttribute("style");
        if (style && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(style)) {
          return true;
        }
        node = node.parentElement;
        depth += 1;
      }
      return false;
    };

    const isUsable = (element: Element): boolean =>
      !element.closest(SKIP) && !isHidden(element);

    const metaTags: RawMetaTag[] = [];
    const seenMeta = new Set<string>();
    document.querySelectorAll("meta").forEach((meta) => {
      const key = normalize(
        meta.getAttribute("property") ??
          meta.getAttribute("name") ??
          meta.getAttribute("itemprop"),
      ).toLowerCase();
      const content = normalize(meta.getAttribute("content"));
      if (!key || !content || seenMeta.has(key)) {
        return;
      }
      seenMeta.add(key);
      metaTags.push({ key, content: clamp(content, 600) });
    });

    // Structured metadata is read on purpose even though `script` is skipped
    // for page text: it is data the site publishes for machines.
    const jsonLdBlocks: string[] = [];
    document.querySelectorAll("script[type='application/ld+json']").forEach((node) => {
      if (jsonLdBlocks.length >= limits.jsonLdBlocks) {
        return;
      }
      const text = node.textContent ?? "";
      if (text.trim()) {
        jsonLdBlocks.push(clamp(text, limits.jsonLdBlockChars));
      }
    });

    const articleElement = document.querySelector("article");
    const mainRoot =
      document.querySelector("main") ??
      articleElement ??
      document.querySelector("[role='main']") ??
      document.body ??
      document.documentElement;

    const headings: RawHeading[] = [];
    const seenHeadings = new Set<string>();
    const headingScope = mainRoot.querySelector("h1, h2, h3")
      ? mainRoot
      : (document.body ?? document.documentElement);
    headingScope.querySelectorAll("h1, h2, h3").forEach((element) => {
      if (headings.length >= limits.headings || !isUsable(element)) {
        return;
      }
      const text = normalize(element.textContent);
      const key = text.toLowerCase();
      if (text.length < 3 || text.length > 140 || seenHeadings.has(key)) {
        return;
      }
      seenHeadings.add(key);
      headings.push({ level: Number(element.tagName.slice(1)), text });
    });

    const textBlocks: string[] = [];
    const seenBlocks = new Set<string>();
    mainRoot.querySelectorAll("p, li, blockquote, figcaption").forEach((element) => {
      if (textBlocks.length >= limits.textBlocks || !isUsable(element)) {
        return;
      }
      const text = clamp(normalize(element.textContent), limits.textBlockChars);
      const key = text.toLowerCase();
      if (text.length < 40 || seenBlocks.has(key)) {
        return;
      }
      seenBlocks.add(key);
      textBlocks.push(text);
    });

    const specCandidates: RawSpecCandidate[] = [];
    const seenSpecs = new Set<string>();
    const addSpec = (rawName: string, rawValue: string): void => {
      if (specCandidates.length >= limits.specCandidates) {
        return;
      }
      const name = normalize(rawName).replace(/[:\s]+$/, "");
      const value = normalize(rawValue);
      const key = name.toLowerCase();
      if (!name || !value || name.length > 60 || value.length > 200) {
        return;
      }
      if (seenSpecs.has(key)) {
        return;
      }
      seenSpecs.add(key);
      specCandidates.push({ name, value });
    };

    mainRoot.querySelectorAll("dl").forEach((list) => {
      if (!isUsable(list)) {
        return;
      }
      list.querySelectorAll("dt").forEach((term) => {
        const definition = term.nextElementSibling;
        if (definition && definition.tagName === "DD") {
          addSpec(term.textContent ?? "", definition.textContent ?? "");
        }
      });
    });

    mainRoot.querySelectorAll("tr").forEach((row) => {
      if (!isUsable(row)) {
        return;
      }
      const cells = row.querySelectorAll("th, td");
      if (cells.length === 2) {
        addSpec(cells[0]?.textContent ?? "", cells[1]?.textContent ?? "");
      }
    });

    const selectedText =
      typeof window !== "undefined" && typeof window.getSelection === "function"
        ? clamp(normalize(window.getSelection()?.toString()), limits.selectedTextChars)
        : "";

    // Product-card titles for short shop grids without ItemList JSON-LD (DOM-64).
    const productNameCandidates: string[] = [];
    const seenProductNames = new Set<string>();
    const pricePattern =
      /(?:€|\$|£|eur|usd|gbp)\s*\d|\d{1,5}(?:[.,]\d{2})?\s*(?:€|\$|£|eur|usd)/i;
    const skipProductName =
      /^(home|menu|filter|sort|search|login|cart|wishlist|größe|size|farbe|color|marke|brand|preis|price|sale|neu|new)$/i;

    const addProductName = (raw: string): void => {
      if (productNameCandidates.length >= limits.productNameCandidates) {
        return;
      }
      const text = normalize(raw)
        .replace(/(?:€|\$|£)\s*[\d.,]+.*$/i, "")
        .replace(/\b\d{1,5}(?:[.,]\d{2})?\s*(?:€|\$|£)\b.*$/i, "")
        .replace(/\s*[·|—–-]\s*$/, "")
        .trim();
      if (text.length < 4 || text.length > 120 || skipProductName.test(text)) {
        return;
      }
      const key = text.toLowerCase();
      if (seenProductNames.has(key)) {
        return;
      }
      seenProductNames.add(key);
      productNameCandidates.push(clamp(text, 120));
    };

    mainRoot
      .querySelectorAll(
        "[itemtype*='Product'] [itemprop='name'], [itemtype*='Product'][itemprop='name'], [itemtype*='product'] [itemprop='name']",
      )
      .forEach((element) => {
        if (isUsable(element)) {
          addProductName(element.textContent ?? "");
        }
      });

    const cardSelector =
      "article, li, [data-testid*='product'], [data-testid*='Product'], [class*='productCard'], [class*='product-card'], [class*='product_card'], [class*='ProductCard']";
    mainRoot.querySelectorAll(cardSelector).forEach((card) => {
      if (
        productNameCandidates.length >= limits.productNameCandidates ||
        !isUsable(card)
      ) {
        return;
      }
      const cardText = normalize(card.textContent);
      if (!pricePattern.test(cardText)) {
        return;
      }
      const named =
        card.querySelector("[itemprop='name']") ??
        card.querySelector("h2, h3, h4");
      if (named && isUsable(named)) {
        addProductName(named.textContent ?? "");
        return;
      }
      const labelled = card.querySelector("a[aria-label]");
      if (labelled) {
        addProductName(labelled.getAttribute("aria-label") ?? "");
        return;
      }
      const link = card.querySelector("a[href]");
      if (link) {
        addProductName(link.getAttribute("title") || link.textContent || "");
      }
    });

    // Shop grids often use plain divs + aria-label links (Zalando-style CSR).
    if (productNameCandidates.length < 2) {
      mainRoot.querySelectorAll("a[href][aria-label]").forEach((link) => {
        if (productNameCandidates.length >= limits.productNameCandidates) {
          return;
        }
        if (!isUsable(link)) {
          return;
        }
        const root =
          link.closest("article, li, [role='listitem']") ??
          link.parentElement?.parentElement ??
          link.parentElement;
        if (!root || !pricePattern.test(normalize(root.textContent))) {
          return;
        }
        addProductName(link.getAttribute("aria-label") ?? "");
      });
    }

    return {
      ok: true,
      snapshot: {
        url: location.href,
        title: normalize(document.title),
        documentLang: normalize(document.documentElement.getAttribute("lang")),
        metaTags,
        jsonLdBlocks,
        headings,
        textBlocks,
        specCandidates,
        selectedText,
        hasArticleElement: Boolean(articleElement),
        articleTextChars: articleElement
          ? normalize(articleElement.textContent).length
          : 0,
        hasTimeElement: Boolean(document.querySelector("time[datetime]")),
        microdataProductCount: document.querySelectorAll(
          "[itemtype*='schema.org/Product']",
        ).length,
        productNameCandidates,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
