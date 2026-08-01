/**
 * Copy / Copy-and-open destinations (handoff §15).
 *
 * MVP never auto-submits. "Copy and open" copies the prompt, then opens a blank
 * chat URL for the provider — the user pastes. Prefill is out of scope.
 */

import type { DestinationId } from "../../shared/storage/schema";
import { DESTINATION_LABELS } from "../../shared/storage/schema";

export { DESTINATION_IDS, DESTINATION_LABELS, type DestinationId } from "../../shared/storage/schema";

/** Blank chat entry points — no query params that would auto-fill or submit. */
export const DESTINATION_OPEN_URLS: Record<Exclude<DestinationId, "copy">, string> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/",
};

export function destinationLabel(id: DestinationId): string {
  return DESTINATION_LABELS[id];
}

export function openUrlForDestination(id: DestinationId): string | null {
  if (id === "copy") {
    return null;
  }
  return DESTINATION_OPEN_URLS[id];
}

/**
 * True when a URL looks like a blank provider entry (no prompt payload).
 * Used by tests to guard against accidental auto-submit encodings.
 */
export function isBlankChatUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Reject anything that embeds the prompt in the query or hash.
    if ([...parsed.searchParams.keys()].length > 0) {
      return false;
    }
    if (parsed.hash.length > 1) {
      return false;
    }
    return Object.values(DESTINATION_OPEN_URLS).some((known) => {
      const expected = new URL(known);
      return (
        parsed.origin === expected.origin &&
        (parsed.pathname === expected.pathname ||
          parsed.pathname === `${expected.pathname}/`)
      );
    });
  } catch {
    return false;
  }
}

export async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error("Clipboard API is unavailable in this context");
}

/**
 * Copies the prompt, then opens the provider (unless destination is Copy only).
 * Never puts the prompt in the URL.
 */
export async function copyAndMaybeOpen(options: {
  prompt: string;
  destination: DestinationId;
  openTab?: (url: string) => void | Promise<void>;
}): Promise<{ copied: true; openedUrl: string | null }> {
  await copyTextToClipboard(options.prompt);
  const url = openUrlForDestination(options.destination);
  if (!url) {
    return { copied: true, openedUrl: null };
  }
  const open =
    options.openTab ??
    ((target: string) => {
      if (typeof chrome !== "undefined" && chrome.tabs?.create) {
        void chrome.tabs.create({ url: target });
        return;
      }
      window.open(target, "_blank", "noopener,noreferrer");
    });
  await open(url);
  return { copied: true, openedUrl: url };
}
