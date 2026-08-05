/**
 * Pure Nano readiness helpers shared by onboarding, options, and side panel.
 */

import type { NanoPreference } from "../../shared/storage/schema";
import type { SuggestionEngineId } from "./types";
import {
  createNanoSession,
  destroyNanoSession,
  getLanguageModel,
  isPromptApiPresent,
  probeAvailability,
  type LanguageModelAvailability,
  type LanguageModelLike,
} from "./nano-prompt-api";

/** UI states for onboarding / settings Nano step (handoff §8). */
export type NanoReadinessState =
  | "checking"
  | "ready"
  | "download"
  | "unsupported";

export function readinessFromAvailability(
  availability: LanguageModelAvailability | null,
  apiPresent: boolean,
): Exclude<NanoReadinessState, "checking"> {
  if (!apiPresent || availability === null || availability === "unavailable") {
    return "unsupported";
  }
  if (availability === "available") {
    return "ready";
  }
  return "download";
}

export type NanoReadinessProbe = {
  state: Exclude<NanoReadinessState, "checking">;
  availability: LanguageModelAvailability | null;
  apiPresent: boolean;
};

export async function probeNanoReadiness(
  getModel: () => LanguageModelLike | undefined = getLanguageModel,
): Promise<NanoReadinessProbe> {
  const model = getModel();
  const apiPresent =
    Boolean(model) &&
    typeof model?.availability === "function" &&
    typeof model?.create === "function";

  if (!apiPresent) {
    // Fall back to realm detection when injection only stubs globals.
    const present = isPromptApiPresent() || Boolean(model);
    if (!present || !model) {
      return { state: "unsupported", availability: null, apiPresent: false };
    }
  }

  if (!model) {
    return { state: "unsupported", availability: null, apiPresent: false };
  }

  const availability = await probeAvailability(model);
  const state = readinessFromAvailability(availability, true);

  // Warm the on-device model once when Chrome reports ready so the first
  // post-onboarding suggestion is less likely to hit create timeouts (DOM-31).
  if (state === "ready") {
    let session: Awaited<ReturnType<typeof createNanoSession>> | null = null;
    try {
      session = await createNanoSession(model, {
        systemPrompt: "Reply with OK.",
        timeoutMs: 60_000,
      });
    } catch {
      // availability() can race ahead of a cold create — treat as downloadable.
      return {
        state: "download",
        availability: availability ?? "downloadable",
        apiPresent: true,
      };
    } finally {
      destroyNanoSession(session);
    }
  }

  return {
    state,
    availability,
    apiPresent: true,
  };
}

/** Prefer Nano only when the user opted in; otherwise curated. */
export function engineIdForNanoPreference(
  preference: NanoPreference,
): SuggestionEngineId {
  return preference === "enabled" ? "nano" : "curated";
}

export function shouldOfferNanoRetry(preference: NanoPreference): boolean {
  return preference === "enabled";
}

/**
 * True when we selected Nano and the engine silently returned curated actions
 * (timeout / invalid / repair exhausted).
 */
export function didNanoFallBackToCurated(input: {
  selectedEngineId: SuggestionEngineId;
  resultEngineId: SuggestionEngineId;
}): boolean {
  return (
    input.selectedEngineId === "nano" && input.resultEngineId === "curated"
  );
}

export const NANO_FALLBACK_COPY =
  "Tiny brain needed a nap. Using the reliable classics instead.";

/** Model missing / uninstall / stalled Chrome internals — curated floor + download CTA. */
export const NANO_NEEDS_DOWNLOAD_COPY =
  "On-device AI isn’t ready (missing or stuck). Using reliable classics — open Settings to download/repair, or Force basic private mode.";

export const NANO_UNSUPPORTED_COPY =
  "On-device AI isn’t available on this Chrome. Using reliable classics instead.";

export const NANO_THINKING_COPY = "Local AI is thinking…";

export type NanoPanelNotice =
  | "none"
  | "fallback"
  | "needs-download"
  | "unsupported";

/**
 * When preference is enabled, map live readiness to a panel notice so we don’t
 * pretend the model is ready after uninstall / broken Chrome internals state.
 */
export function nanoPanelNoticeForPreference(input: {
  preference: NanoPreference;
  readiness: NanoReadinessProbe | null;
}): NanoPanelNotice {
  if (input.preference !== "enabled") {
    return "none";
  }
  if (!input.readiness) {
    return "none";
  }
  switch (input.readiness.state) {
    case "ready":
      return "none";
    case "download":
      return "needs-download";
    case "unsupported":
      return "unsupported";
  }
}

export function copyForNanoPanelNotice(notice: NanoPanelNotice): string {
  switch (notice) {
    case "needs-download":
      return NANO_NEEDS_DOWNLOAD_COPY;
    case "unsupported":
      return NANO_UNSUPPORTED_COPY;
    case "fallback":
      return NANO_FALLBACK_COPY;
    case "none":
      return "";
  }
}

/**
 * After a Nano suggest failure, prefer “needs download” when Chrome’s model
 * looks installed but create/prompt stalls (common after Uninstall mid-session).
 */
export function nanoPanelNoticeFromFailureReason(
  reason: string | undefined,
): NanoPanelNotice {
  if (!reason) {
    return "fallback";
  }
  if (
    /timed out/i.test(reason) ||
    /signal is aborted/i.test(reason) ||
    /nano\.(create|prompt)/i.test(reason)
  ) {
    return "needs-download";
  }
  return "fallback";
}

export function formatDownloadProgress(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction) || fraction < 0) {
    return "Downloading on-device model…";
  }
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  if (pct === 0) {
    return "Starting download…";
  }
  return `Downloading on-device model… ${pct}%`;
}

/** Readable status for Settings — preference + live availability. */
export function describeNanoStatus(input: {
  preference: NanoPreference;
  readiness: NanoReadinessProbe | null;
  forceDisabled?: boolean;
}): string {
  if (input.forceDisabled) {
    return "On-device AI is disabled for this build (test mode). Curated suggestions stay available.";
  }

  if (input.preference === "basic") {
    return "Basic private mode — curated suggestions only. On-device AI stays off for this profile.";
  }

  const readiness = input.readiness;
  if (!readiness) {
    if (input.preference === "enabled") {
      return "On-device AI preferred. Checking availability…";
    }
    if (input.preference === "skipped") {
      return "Nano setup was skipped. Curated suggestions work without a download — you can set up on-device AI anytime.";
    }
    return "Checking on-device AI…";
  }

  switch (readiness.state) {
    case "ready":
      return input.preference === "enabled"
        ? "On-device AI is ready. Page-specific directions stay on this device."
        : "On-device AI is available on this device. Enable it to prefer local suggestions.";
    case "download":
      return readiness.availability === "downloading"
        ? "On-device model is downloading. You can keep using curated suggestions meanwhile."
        : "On-device AI needs a one-time Chrome-managed download. Nothing from the page is uploaded by PromptAhead.";
    case "unsupported":
      return "This Chrome or device does not support on-device AI yet. Curated suggestions remain fully usable.";
  }
}

export function progressFractionToPercent(
  fraction: number | null,
): number | null {
  if (fraction === null || !Number.isFinite(fraction)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}
