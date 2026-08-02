/**
 * Pure onboarding step helpers — Manual-first, Nano skippable, no host perms.
 */

import type {
  DestinationId,
  OnboardingPatch,
  SettingsPatch,
} from "../shared/storage/schema";

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

/** Persist when the user finishes or skips the first-run flow. */
export function buildOnboardingCompletion(input: {
  destination: DestinationId;
  skipped: boolean;
  nanoSkipped: boolean;
  now?: string;
}): { onboarding: OnboardingPatch; settings: SettingsPatch } {
  const completedAt = input.now ?? new Date().toISOString();
  return {
    settings: {
      mode: "manual",
      defaultDestination: input.destination,
      nanoPreference: "skipped",
    },
    onboarding: {
      completed: true,
      completedAt,
      modeChosen: true,
      destinationChosen: true,
      nanoStepSkipped: input.nanoSkipped || input.skipped,
    },
  };
}
