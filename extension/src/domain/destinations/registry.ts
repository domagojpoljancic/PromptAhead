import type { ProviderConfig, ProviderId } from "./types";

/**
 * Extensible destination registry: deep-link patterns, model hints, capabilities.
 * Model suggestions are registry defaults — no picker UI yet.
 */
export const PROVIDER_REGISTRY: Record<ProviderId, ProviderConfig> = {
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    webBaseUrl: "https://chatgpt.com/",
    supportsQueryParam: true,
    queryParamKey: "q",
    modelParamKey: "model",
    appSchemeTemplate: "com.openai.chat://chatgpt.com/?{query}",
    suggestedModels: ["gpt-4o", "o3", "gpt-4.1"],
    defaultModel: "gpt-4o",
  },
  claude: {
    id: "claude",
    label: "Claude",
    webBaseUrl: "https://claude.ai/new",
    supportsQueryParam: true,
    queryParamKey: "q",
    // Anthropic new-chat URLs reliably take `q`; model is suggestion-only for now.
    appSchemeTemplate: "claude://claude.ai/new?{query}",
    suggestedModels: ["claude-sonnet-4-5", "claude-opus-4", "claude-haiku-4-5"],
    defaultModel: "claude-sonnet-4-5",
  },
  perplexity: {
    id: "perplexity",
    label: "Perplexity",
    webBaseUrl: "https://www.perplexity.ai/",
    supportsQueryParam: true,
    queryParamKey: "q",
    suggestedModels: [],
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    // Native Gemini has no reliable query prefill; clipboard + open is intentional.
    webBaseUrl: "https://gemini.google.com/app",
    supportsQueryParam: false,
    queryParamKey: "q",
    suggestedModels: [],
  },
};

export function getProviderConfig(id: ProviderId): ProviderConfig {
  return PROVIDER_REGISTRY[id];
}

/** Base URLs opened when clipboard strategy is used (no prompt in the URL). */
export const DESTINATION_OPEN_URLS: Record<ProviderId, string> = {
  chatgpt: PROVIDER_REGISTRY.chatgpt.webBaseUrl,
  claude: PROVIDER_REGISTRY.claude.webBaseUrl,
  gemini: PROVIDER_REGISTRY.gemini.webBaseUrl,
  perplexity: PROVIDER_REGISTRY.perplexity.webBaseUrl,
};
