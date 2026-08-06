import { describe, expect, it } from "vitest";

import type { LanguageModelLike } from "../../extension/src/domain/suggestions/nano-prompt-api";
import {
  describeNanoStatus,
  didNanoFallBackToCurated,
  engineIdForNanoPreference,
  formatDownloadProgress,
  nanoPanelNoticeForPreference,
  nanoPanelNoticeFromFailureReason,
  readinessFromAvailability,
} from "../../extension/src/domain/suggestions/nano-readiness";


function fakeModel(options: {
  availability?: "available" | "unavailable" | "downloadable";
  failCreate?: boolean;
}): LanguageModelLike {
  return {
    availability: async () => options.availability ?? "available",
    create: async () => {
      if (options.failCreate) {
        throw new Error("create failed");
      }
      return {
        prompt: async () => "OK",
        destroy: () => undefined,
      };
    },
  };
}

describe("nano-readiness helpers", () => {
  it("maps availability to UI states", () => {
    expect(readinessFromAvailability("available", true)).toBe("ready");
    expect(readinessFromAvailability("downloadable", true)).toBe("download");
    expect(readinessFromAvailability("downloading", true)).toBe("download");
    expect(readinessFromAvailability("unavailable", true)).toBe("unsupported");
    expect(readinessFromAvailability(null, false)).toBe("unsupported");
  });


  it("treats available + failed warm create as download", async () => {
    const probe = await probeNanoReadiness(() =>
      fakeModel({ availability: "available", failCreate: true }),
    );
    expect(probe.state).toBe("download");
    expect(probe.apiPresent).toBe(true);
    expect(probe.availability).toBe("available");
  });

  it("prefers nano only when preference is enabled", () => {
    expect(engineIdForNanoPreference("enabled")).toBe("nano");
    expect(engineIdForNanoPreference("basic")).toBe("curated");
    expect(engineIdForNanoPreference("skipped")).toBe("curated");
  });

  it("detects silent curated fallback after Nano selection", () => {
    expect(
      didNanoFallBackToCurated({
        selectedEngineId: "nano",
        resultEngineId: "curated",
      }),
    ).toBe(true);
    expect(
      didNanoFallBackToCurated({
        selectedEngineId: "nano",
        resultEngineId: "nano",
      }),
    ).toBe(false);
    expect(
      didNanoFallBackToCurated({
        selectedEngineId: "curated",
        resultEngineId: "curated",
      }),
    ).toBe(false);
  });

  it("formats download progress", () => {
    expect(formatDownloadProgress(null)).toMatch(/Downloading/i);
    expect(formatDownloadProgress(0)).toMatch(/Starting/i);
    expect(formatDownloadProgress(0.42)).toContain("42%");
  });

  it("describes readable settings status", () => {
    expect(
      describeNanoStatus({
        preference: "basic",
        readiness: null,
      }),
    ).toMatch(/Basic private mode/i);

    expect(
      describeNanoStatus({
        preference: "enabled",
        readiness: {
          state: "ready",
          availability: "available",
          apiPresent: true,
        },
      }),
    ).toMatch(/ready/i);

    expect(
      describeNanoStatus({
        preference: "skipped",
        readiness: {
          state: "unsupported",
          availability: "unavailable",
          apiPresent: false,
        },
      }),
    ).toMatch(/does not support/i);
  });

  it("maps preference + readiness to panel notices", () => {
    expect(
      nanoPanelNoticeForPreference({
        preference: "enabled",
        readiness: {
          state: "download",
          availability: "downloadable",
          apiPresent: true,
        },
      }),
    ).toBe("needs-download");
    expect(
      nanoPanelNoticeForPreference({
        preference: "enabled",
        readiness: {
          state: "ready",
          availability: "available",
          apiPresent: true,
        },
      }),
    ).toBe("none");
    expect(
      nanoPanelNoticeForPreference({
        preference: "basic",
        readiness: {
          state: "download",
          availability: "downloadable",
          apiPresent: true,
        },
      }),
    ).toBe("none");
  });

  it("maps suggest failure reasons to panel notices", () => {
    expect(nanoPanelNoticeFromFailureReason(undefined)).toBe("fallback");
    expect(nanoPanelNoticeFromFailureReason("Gemini Nano timed out")).toBe(
      "needs-download",
    );
    expect(nanoPanelNoticeFromFailureReason("The signal is aborted.")).toBe(
      "needs-download",
    );
    expect(nanoPanelNoticeFromFailureReason("nano.create: create failed")).toBe(
      "needs-download",
    );
    expect(nanoPanelNoticeFromFailureReason("nano.prompt: hung")).toBe(
      "needs-download",
    );
    expect(nanoPanelNoticeFromFailureReason("No valid Nano actions")).toBe(
      "fallback",
    );
  });
});
