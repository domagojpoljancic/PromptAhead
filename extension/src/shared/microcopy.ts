/**
 * Playful microcopy pools (handoff §18). Security / permission / sensitive
 * warnings stay fixed sober strings elsewhere — never pull those from here.
 */

export type MicrocopySurface =
  | "reading"
  | "understanding"
  | "understandingNano"
  | "building"
  | "nanoThinking"
  | "successStay"
  | "copiedStay";

/** First entry per pool is the canonical default (tests pin random → 0). */
export const MICROCOPY_POOLS: Record<MicrocopySurface, readonly string[]> = {
  reading: [
    "Reading this page…",
    "Connecting suspiciously relevant dots…",
    "Looking for a better rabbit hole…",
    "Skimming for the useful bits…",
  ],
  understanding: [
    "Capturing compact context and ranking directions…",
    "Removing the boring options…",
    "Sorting signal from scroll filler…",
    "Lining up a few solid next questions…",
  ],
  understandingNano: [
    "Asking on-device AI for page-specific directions…",
    "Asking the tiny model to think big…",
    "Consulting the silicon oracle…",
    "Nudging local AI for sharper directions…",
  ],
  building: [
    "Building suggestions…",
    "Ranking directions…",
    "Picking the least boring angles…",
  ],
  nanoThinking: [
    "Local AI is thinking…",
    "On-device AI is chewing on this…",
    "Tiny model, big think…",
  ],
  successStay: [
    "Opened destination. Panel stays open.",
    "Destination opened — nothing was submitted.",
    "You’re set. Panel stays open.",
  ],
  copiedStay: [
    "Prompt copied. Panel stays open.",
    "On the clipboard — panel stays open.",
    "Copied. Paste when you’re ready.",
  ],
};

let randomFn: () => number = Math.random;

/** Test helper — pin to `() => 0` for the canonical first pool line. */
export function setMicrocopyRandomForTests(fn: () => number): void {
  randomFn = fn;
}

export function resetMicrocopyRandomForTests(): void {
  randomFn = Math.random;
}

export function pickMicrocopy(surface: MicrocopySurface): string {
  const pool = MICROCOPY_POOLS[surface];
  const index = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(randomFn() * pool.length)),
  );
  return pool[index]!;
}

/** Surfaces that must never use playful pools (documentation / assertion aid). */
export const SOBER_MICROCOPY_SURFACES = [
  "sensitive-override",
  "permission-denied",
  "clear-all-data",
  "injection-warning",
] as const;
