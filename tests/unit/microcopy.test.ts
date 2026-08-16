import { afterEach, describe, expect, it } from "vitest";

import {
  MICROCOPY_POOLS,
  SOBER_MICROCOPY_SURFACES,
  nextMicrocopyAfter,
  pickMicrocopy,
  resetMicrocopyRandomForTests,
  setMicrocopyRandomForTests,
} from "../../extension/src/shared/microcopy";

describe("microcopy pools", () => {
  afterEach(() => {
    resetMicrocopyRandomForTests();
  });

  it("returns the canonical first line when random is pinned to 0", () => {
    setMicrocopyRandomForTests(() => 0);
    expect(pickMicrocopy("reading")).toBe(MICROCOPY_POOLS.reading[0]);
    expect(pickMicrocopy("nanoThinking")).toBe(MICROCOPY_POOLS.nanoThinking[0]);
  });

  it("returns the next pool line after a previous value", () => {
    setMicrocopyRandomForTests(() => 0);
    expect(nextMicrocopyAfter("nanoThinking", null)).toBe(
      MICROCOPY_POOLS.nanoThinking[0],
    );
    expect(
      nextMicrocopyAfter("nanoThinking", MICROCOPY_POOLS.nanoThinking[0]!),
    ).toBe(MICROCOPY_POOLS.nanoThinking[1]);
    expect(
      nextMicrocopyAfter(
        "nanoThinking",
        MICROCOPY_POOLS.nanoThinking[
          MICROCOPY_POOLS.nanoThinking.length - 1
        ]!,
      ),
    ).toBe(MICROCOPY_POOLS.nanoThinking[0]);
  });

  it("keeps every pool non-empty and playful surfaces distinct from sober list", () => {
    for (const [surface, pool] of Object.entries(MICROCOPY_POOLS)) {
      expect(pool.length).toBeGreaterThanOrEqual(2);
      expect(SOBER_MICROCOPY_SURFACES).not.toContain(surface);
    }
  });

  it("keeps nanoThinking large enough for calm long waits", () => {
    expect(MICROCOPY_POOLS.nanoThinking.length).toBeGreaterThanOrEqual(50);
    expect(new Set(MICROCOPY_POOLS.nanoThinking).size).toBe(
      MICROCOPY_POOLS.nanoThinking.length,
    );
  });

  it("documents sober surfaces that must stay fixed (not pooled)", () => {
    expect(SOBER_MICROCOPY_SURFACES).toEqual(
      expect.arrayContaining([
        "sensitive-override",
        "permission-denied",
        "clear-all-data",
        "injection-warning",
      ]),
    );
  });
});
