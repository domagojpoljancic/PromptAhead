/**
 * Pure onboarding step helpers — Manual-first, Nano skippable, no host perms.
 */

import type {
  DestinationId,
  NanoPreference,
  OnboardingPatch,
  SettingsPatch,
} from "../shared/storage/schema";
import type { NanoReadinessState } from "../domain/suggestions/nano-readiness";

export const ONBOARDING_STEPS = [
  "welcome",
  "mode",
  "destination",
  "nano",
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export function isOnboardingStepId(value: string): value is OnboardingStepId {
  return (ONBOARDING_STEPS as readonly string[]).includes(value);
}

export function nextOnboardingStep(
  step: OnboardingStepId,
): OnboardingStepId | "complete" {
  const index = ONBOARDING_STEPS.indexOf(step);
  if (index < 0 || index >= ONBOARDING_STEPS.length - 1) {
    return "complete";
  }
  return ONBOARDING_STEPS[index + 1]!;
}

export function previousOnboardingStep(
  step: OnboardingStepId,
): OnboardingStepId | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  if (index <= 0) {
    return null;
  }
  return ONBOARDING_STEPS[index - 1]!;
}

/**
 * Persist when the user finishes or skips the first-run flow.
 * `nanoPreference`: enabled | basic | skipped (handoff §8).
 */
export function buildOnboardingCompletion(input: {
  destination: DestinationId;
  skipped: boolean;
  nanoPreference: NanoPreference;
  nanoStepSkipped?: boolean;
  now?: string;
}): { onboarding: OnboardingPatch; settings: SettingsPatch } {
  const completedAt = input.now ?? new Date().toISOString();
  const nanoStepSkipped =
    input.nanoStepSkipped ??
    (input.skipped ||
      input.nanoPreference === "skipped" ||
      input.nanoPreference === "basic");

  return {
    settings: {
      mode: "manual",
      defaultDestination: input.destination,
      nanoPreference: input.nanoPreference,
    },
    onboarding: {
      completed: true,
      completedAt,
      modeChosen: true,
      destinationChosen: true,
      nanoStepSkipped,
    },
  };
}

/** Heading + body for the nano onboarding panel. */
export function nanoStepCopy(
  state: NanoReadinessState,
): { heading: string; body: string } {
  switch (state) {
    case "checking":
      return {
        heading: "On-device AI",
        body: "Checking whether Gemini Nano is available on this device…",
      };
    case "ready":
      return {
        heading: "On-device AI is ready",
        body: "Gemini Nano can rank page-specific directions privately on this device. Nothing from the page leaves via PromptAhead.",
      };
    case "download":
      return {
        heading: "Download on-device AI",
        body: "Chrome can download Gemini Nano for private, page-specific suggestions. The download is user-activated and skippable — curated directions work either way.",
      };
    case "unsupported":
      return {
        heading: "On-device AI unavailable",
        body: "This Chrome or device does not support Gemini Nano yet. You can continue with basic private mode — curated suggestions stay fully usable.",
      };
  }
}
