import { describe, expect, it } from "vitest";

import {
  buildOnboardingCompletion,
  nextOnboardingStep,
  previousOnboardingStep,
} from "../../extension/src/sidepanel/onboarding-flow";

describe("onboarding-flow", () => {
  it("walks welcome → mode → destination → nano → complete", () => {
    expect(nextOnboardingStep("welcome")).toBe("mode");
    expect(nextOnboardingStep("mode")).toBe("destination");
    expect(nextOnboardingStep("destination")).toBe("nano");
    expect(nextOnboardingStep("nano")).toBe("complete");
  });

  it("walks back until welcome", () => {
    expect(previousOnboardingStep("welcome")).toBeNull();
    expect(previousOnboardingStep("mode")).toBe("welcome");
    expect(previousOnboardingStep("nano")).toBe("destination");
  });

  it("builds a Manual-first completion patch with Nano skipped", () => {
    const { onboarding, settings } = buildOnboardingCompletion({
      destination: "chatgpt",
      skipped: false,
      nanoSkipped: true,
      now: "2026-08-02T12:00:00.000Z",
    });

    expect(settings).toEqual({
      mode: "manual",
      defaultDestination: "chatgpt",
      nanoPreference: "skipped",
    });
    expect(onboarding).toEqual({
      completed: true,
      completedAt: "2026-08-02T12:00:00.000Z",
      modeChosen: true,
      destinationChosen: true,
      nanoStepSkipped: true,
    });
  });

  it("marks nano skipped when the whole flow is skipped", () => {
    const { onboarding } = buildOnboardingCompletion({
      destination: "copy",
      skipped: true,
      nanoSkipped: false,
      now: "2026-08-02T12:00:00.000Z",
    });
    expect(onboarding.nanoStepSkipped).toBe(true);
    expect(onboarding.completed).toBe(true);
  });
});
