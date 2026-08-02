import { getProviderConfig } from "./registry";
import {
  DEEP_LINK_URL_BUDGET,
  type DeepLinkResult,
  type ProviderId,
} from "./types";

function buildQueryString(
  config: ReturnType<typeof getProviderConfig>,
  prompt: string,
  model: string | null,
): string {
  const params = new URLSearchParams();
  params.set(config.queryParamKey, prompt);
  if (config.modelParamKey && model) {
    params.set(config.modelParamKey, model);
  }
  return params.toString();
}

function buildPrefillWebUrl(provider: ProviderId, query: string): string {
  switch (provider) {
    case "chatgpt":
      return `https://chatgpt.com/?${query}`;
    case "claude":
      return `https://claude.ai/new?${query}`;
    case "perplexity":
      return `https://www.perplexity.ai/search?${query}`;
    case "gemini":
      return getProviderConfig("gemini").webBaseUrl;
  }
}

/**
 * Pure deep-link generator. Does not open tabs or touch the clipboard.
 */
export function generateLLMDeepLink(options: {
  provider: ProviderId;
  prompt: string;
  model?: string | null;
}): DeepLinkResult {
  const config = getProviderConfig(options.provider);
  const resolvedModel =
    config.modelParamKey != null
      ? (options.model ?? config.defaultModel ?? null)
      : null;

  if (!config.supportsQueryParam) {
    return {
      strategy: "clipboard",
      webUrl: config.webBaseUrl,
      appUrl: null,
      usedModel: null,
      reason: "unsupported",
    };
  }

  const query = buildQueryString(config, options.prompt, resolvedModel);
  const webUrl = buildPrefillWebUrl(config.id, query);
  const appUrl = config.appSchemeTemplate
    ? config.appSchemeTemplate.replace("{query}", query)
    : null;

  const longest = Math.max(webUrl.length, appUrl?.length ?? 0);
  if (longest > DEEP_LINK_URL_BUDGET) {
    return {
      strategy: "clipboard",
      webUrl: config.webBaseUrl,
      appUrl: null,
      usedModel: resolvedModel,
      reason: "oversize",
    };
  }

  return {
    strategy: "query",
    webUrl,
    appUrl,
    usedModel: resolvedModel,
  };
}
