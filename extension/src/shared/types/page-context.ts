/**
 * Deterministic extraction contract (handoff §31, schemaVersion 1).
 * Missing fields stay absent rather than being guessed.
 */

export const PAGE_CONTEXT_SCHEMA_VERSION = 1 as const;

export type PageType = "article" | "product" | "generic";

export type ProductSpecification = {
  name: string;
  value: string;
};

export type ArticleContext = {
  publisher?: string;
  author?: string;
  publishedAt?: string;
  headings: string[];
  excerpts: string[];
};

export type ProductContext = {
  brand?: string;
  model?: string;
  category?: string;
  price?: string;
  currency?: string;
  availability?: string;
  rating?: number;
  reviewCount?: number;
  specifications: ProductSpecification[];
  excerpts: string[];
};

export type GenericContext = {
  headings: string[];
  excerpts: string[];
};

/**
 * Small named set on a listing / ItemList page (DOM-64).
 * Present only when extraction found 2–10 distinct named entities worth comparing.
 */
export type ComparableItemKind = "product" | "article" | "item";

export type ComparableSet = {
  kind: ComparableItemKind;
  names: string[];
};

/**
 * Larger named product pool for optional expand (DOM-68).
 * Present when more named products were found than the compact ≤10 set.
 */
export type ExpandableNamedSet = {
  kind: "product";
  /** Names included after the hard ceiling (≤ comparableSetExpandMax). */
  names: string[];
  /** Count of distinct named products found before the expand ceiling. */
  totalFound: number;
};

export type PageContext = {
  schemaVersion: 1;
  pageType: PageType;
  language: string;
  title: string;
  url: string;
  description?: string;
  selectedText?: string;
  article?: ArticleContext;
  product?: ProductContext;
  generic?: GenericContext;
  /** Set when the page lists a small, named comparable group (≤10). */
  comparableSet?: ComparableSet;
  /** Set when more named products exist than the compact set (DOM-68). */
  expandableNamedSet?: ExpandableNamedSet;
};

/** Compactness caps from handoff §31; extraction (DOM-9) enforces them. */
export const EXTRACTION_CAPS = {
  headings: 8,
  articleExcerpts: 6,
  productSpecifications: 12,
  productExcerpts: 4,
  totalCharacters: 6000,
  /** Inclusive bounds for `comparableSet` (DOM-64). */
  comparableSetMin: 2,
  comparableSetMax: 10,
  /** Hard ceiling after user opt-in to include all named products (DOM-68). */
  comparableSetExpandMax: 40,
} as const;

export function isPageType(value: unknown): value is PageType {
  return value === "article" || value === "product" || value === "generic";
}

/**
 * Structural check only — enough to reject foreign messages crossing the
 * content-script boundary, not a full validation of extraction output.
 */
export function isPageContext(value: unknown): value is PageContext {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PageContext>;
  return (
    candidate.schemaVersion === PAGE_CONTEXT_SCHEMA_VERSION &&
    isPageType(candidate.pageType) &&
    typeof candidate.language === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.url === "string"
  );
}
