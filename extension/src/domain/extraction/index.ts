/**
 * Page → `PageContext`. Split in two on purpose: a tiny self-contained
 * collector that must survive being stringified into the page, and pure logic
 * that turns its plain-data snapshot into the contract in `shared/types`.
 */
export type {
  ArticleContext,
  ComparableItemKind,
  ComparableSet,
  GenericContext,
  PageContext,
  PageType,
  ProductContext,
  ProductSpecification,
} from "../../shared/types/page-context";
export {
  EXTRACTION_CAPS,
  PAGE_CONTEXT_SCHEMA_VERSION,
  isPageContext,
  isPageType,
} from "../../shared/types/page-context";

export { extractComparableSet } from "./comparable-set";

export {
  RAW_SNAPSHOT_LIMITS,
  collectPageSnapshotInPage,
  type RawHeading,
  type RawMetaTag,
  type RawPageSnapshot,
  type RawSpecCandidate,
  type SnapshotCollectionResult,
  type SnapshotLimits,
} from "./snapshot";

export {
  buildPageContext,
  buildPageContextWithReason,
  countContextCharacters,
  type PageContextBuild,
} from "./build-page-context";

export {
  hasJsonLdType,
  jsonLdNumber,
  jsonLdObject,
  jsonLdString,
  jsonLdTypes,
  parseJsonLdNodes,
  type JsonLdNode,
} from "./json-ld";
