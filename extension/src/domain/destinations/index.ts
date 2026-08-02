/**
 * Destination handoff: deep links (app-first + web fallback) with clipboard
 * paste for Gemini and oversized prompts. Never auto-submits.
 */

import type { DestinationId } from "../../shared/storage/schema";
import { DESTINATION_LABELS } from "../../shared/storage/schema";
import {
  openLLMWithFallback,
  type OpenLLMDeps,
} from "./open-with-fallback";
import {
  DESTINATION_OPEN_URLS,
  getProviderConfig,
  PROVIDER_REGISTRY,
} from "./registry";
import type { ProviderId } from "./types";

export {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  type DestinationId,
} from "../../shared/storage/schema";

export { copyTextToClipboard } from "./clipboard";
export { generateLLMDeepLink } from "./generate-deep-link";
export {
  openLLMWithFallback,
  type OpenLLMDeps,
  type TabHandle,
} from "./open-with-fallback";
export {
  DESTINATION_OPEN_URLS,
  getProviderConfig,
  PROVIDER_REGISTRY,
} from "./registry";
export {
  APP_SCHEME_FALLBACK_MS,
  DEEP_LINK_URL_BUDGET,
  type DeepLinkResult,
  type DeepLinkStrategy,
  type OpenLLMResult,
  type OpenMode,
  type ProviderConfig,
  type ProviderId,
} from "./types";

export function destinationLabel(id: DestinationId): string {
  return DESTINATION_LABELS[id];
}

/** Base (non-prefilled) open URL for a destination, or null for copy-only. */
export function openUrlForDestination(id: DestinationId): string | null {
  if (id === "copy") {
    return null;
  }
  return DESTINATION_OPEN_URLS[id];
}

/**
 * True when a destination URL must not look like an auto-submit endpoint.
 * Prefill via `q` is allowed; `submit` / `send` / `autosubmit` are not.
 */
export function isSafeHandoffUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const banned = ["submit", "send", "autosubmit", "auto_submit"];
    for (const key of parsed.searchParams.keys()) {
      if (banned.includes(key.toLowerCase())) {
        return false;
      }
    }
    return true;
  } catch {
    // Custom schemes (com.openai.chat://…) are not always WHATWG-parseable.
    const lower = url.toLowerCase();
    return !bannedParamInRaw(lower);
  }
}

function bannedParamInRaw(url: string): boolean {
  return /[?&](submit|send|autosubmit|auto_submit)=/i.test(url);
}

/**
 * Opens (or copies for) a destination. Prefer `openLLMWithFallback` for new code.
 * Kept as a thin wrapper for call sites that still expect the old name.
 */
export async function copyAndMaybeOpen(options: {
  prompt: string;
  destination: DestinationId;
  model?: string | null;
  openTab?: (url: string) => void | Promise<void>;
  deps?: OpenLLMDeps;
}): Promise<{
  copied: boolean;
  openedUrl: string | null;
  mode: import("./types").OpenMode;
}> {
  const deps: OpenLLMDeps | undefined = options.deps ??
    (options.openTab
      ? {
          openTab: async (url) => {
            await options.openTab?.(url);
          },
        }
      : undefined);

  const result = await openLLMWithFallback({
    prompt: options.prompt,
    destination: options.destination,
    model: options.model,
    deps,
  });

  return {
    copied: result.copied,
    openedUrl: result.openedUrl,
    mode: result.mode,
  };
}

/** Suggested models for a provider (empty when none configured). */
export function suggestedModelsFor(provider: ProviderId): readonly string[] {
  return getProviderConfig(provider).suggestedModels;
}

/** Resolve default/suggested model id for deep-link generation. */
export function resolveDefaultModel(
  provider: ProviderId,
  override?: string | null,
): string | null {
  const config = PROVIDER_REGISTRY[provider];
  if (!config.modelParamKey) {
    return null;
  }
  return override ?? config.defaultModel ?? null;
}
