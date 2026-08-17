import { describe, expect, it } from "vitest";

import {
  buildOnboardingCompletion,
  nanoStepCopy,
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

  it("persists enabled Nano preference when the user opts in", () => {
    const { settings } = buildOnboardingCompletion({
      destination: "chatgpt",
      skipped: false,
      nanoPreference: "enabled",
      now: "2026-08-02T12:00:00.000Z",
    });

    expect(settings).toEqual({
      mode: "manual",
      smartModeAvailable: false,
      defaultDestination: "chatgpt",
      nanoPreference: "enabled",
      nanoSuggestMode: "generate",
    });
  });

  it("persists Smart mode only when grant succeeded", () => {
    const { settings } = buildOnboardingCompletion({
      destination: "copy",
      skipped: false,
      nanoPreference: "skipped",
      mode: "smart",
      smartModeAvailable: true,
      now: "2026-08-06T12:00:00.000Z",
    });
    expect(settings.mode).toBe("smart");
    expect(settings.smartModeAvailable).toBe(true);
  });

  it("persists basic private mode and marks the nano step skipped", () => {
    const { onboarding, settings } = buildOnboardingCompletion({
      destination: "copy",
      skipped: false,
      nanoPreference: "basic",
      now: "2026-08-02T12:00:00.000Z",
    });
    expect(settings.nanoPreference).toBe("basic");
    expect(settings.nanoSuggestMode).toBe("curated");
    expect(onboarding.nanoStepSkipped).toBe(true);
  });

  it("marks nano skipped when the whole flow is skipped", () => {
    const { onboarding, settings } = buildOnboardingCompletion({
      destination: "copy",
      skipped: true,
      nanoPreference: "skipped",
      now: "2026-08-02T12:00:00.000Z",
    });
    expect(settings.nanoPreference).toBe("skipped");
    expect(onboarding.nanoStepSkipped).toBe(true);
    expect(onboarding.completed).toBe(true);
  });

  it("returns sober copy for unsupported hardware", () => {
    const copy = nanoStepCopy("unsupported");
    expect(copy.heading).toMatch(/unavailable/i);
    expect(copy.body).toMatch(/basic private mode/i);
  });
});
