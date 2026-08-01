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
};

/** Compactness caps from handoff §31; extraction (DOM-9) enforces them. */
export const EXTRACTION_CAPS = {
  headings: 8,
  articleExcerpts: 6,
  productSpecifications: 12,
  productExcerpts: 4,
  totalCharacters: 6000,
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
