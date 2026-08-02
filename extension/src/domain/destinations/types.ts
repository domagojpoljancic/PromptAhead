import type { DestinationId } from "../../shared/storage/schema";

/** LLM destinations that can be opened (excludes copy-only). */
export type ProviderId = Exclude<DestinationId, "copy">;

export type ProviderConfig = {
  id: ProviderId;
  label: string;
  /** Base https entry (no query) used when clipboard strategy opens the provider. */
  webBaseUrl: string;
  /**
   * When true, prompts are embedded via `queryParamKey` on web (and app) URLs
   * as long as the result stays under the URL budget.
   */
  supportsQueryParam: boolean;
  queryParamKey: string;
  /** Optional model query key (e.g. ChatGPT `model`). Omitted providers ignore model. */
  modelParamKey?: string;
  /**
   * App / custom-protocol template. Use `{query}` where the full query string
   * (without leading `?`) should be substituted, or leave unset for web-only.
   */
  appSchemeTemplate?: string;
  suggestedModels: readonly string[];
  defaultModel?: string;
};

export type DeepLinkStrategy = "query" | "clipboard";

export type DeepLinkResult = {
  strategy: DeepLinkStrategy;
  webUrl: string;
  appUrl: string | null;
  usedModel: string | null;
  reason?: "oversize" | "unsupported";
};

export type OpenMode = "deeplink" | "fallback-web" | "clipboard" | "copy-only";

export type OpenLLMResult = {
  mode: OpenMode;
  openedUrl: string | null;
  copied: boolean;
  usedModel: string | null;
};

/** Soft cross-browser budget for query-prefilled destination URLs. */
export const DEEP_LINK_URL_BUDGET = 6_000;

/** How long to wait before probing whether a custom-scheme tab needs web fallback. */
export const APP_SCHEME_FALLBACK_MS = 1_500;
