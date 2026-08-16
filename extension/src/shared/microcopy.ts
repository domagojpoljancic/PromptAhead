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
    "Thinking on this device…",
    "Chewing on the page locally…",
    "Working through the excerpts…",
    "Still thinking — nothing left this device…",
    "Crunching this tab privately…",
    "Warming up the on-device model…",
    "Reading between the pixels…",
    "Sorting useful from scroll filler…",
    "Finding the sharpest next questions…",
    "Sketching a few solid angles…",
    "Brewing page-specific directions…",
    "Quietly ranking what matters…",
    "Turning this tab into prompts…",
    "Asking AI for a second opinion…",
    "Keeping it private while it thinks…",
    "No cloud — just careful chewing…",
    "Mapping what’s worth asking next…",
    "Trimming the boring options first…",
    "Looking for the interesting thread…",
    "Spinning up private suggestions…",
    "Almost there — still on this device…",
    "Parsing the useful bits locally…",
    "Drafting sharper directions…",
    "Checking what this page is really about…",
    "Holding the page under a tiny microscope…",
    "Gathering angles that fit this tab…",
    "Thinking with the lights off (privacy)…",
    "One more pass over the excerpts…",
    "Building a shortlist of next moves…",
    "Full attention, on this device…",
    "Sifting headlines from substance…",
    "Queuing up less-obvious questions…",
    "Working through the compact context…",
    "Preferring signal over sidebar noise…",
    "Shaping three decent directions…",
    "On-device gears are turning…",
    "Consulting the quiet local model…",
    "Making sure nothing leaves this device…",
    "Reranking until it feels useful…",
    "Hunting for a better rabbit hole…",
    "Polishing page-specific prompts…",
    "AI is still working on this…",
    "Still on-device — hang tight…",
    "Finishing the local think loop…",
    "Almost ready with directions…",
    "Wrapping up the on-device pass…",
    "AI is lining up next questions…",
    "Private model, full focus…",
    "Combing the page for signal…",
    "Nudging local AI for sharper ideas…",
    "Letting AI take another look…",
    "AI is ranking what matters most…",
  ],
  successStay: [
    "Destination opened with your prompt ready — PromptAhead never auto-submits.",
    "Opened the chat — PromptAhead did not send the prompt for you.",
    "You’re set. Panel stays open.",
  ],
  copiedStay: [
    "Prompt copied. Panel stays open.",
    "On the clipboard — paste when you’re ready. PromptAhead did not submit it.",
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

/** Cadence for rotating AI status lines — calm, readable (DOM-85). */
export const NANO_THINKING_ROTATE_MS = 2800;

/** Fixed pre-AI busy copy — one title + benefit, no rotation. */
export const AI_LOADING_STATUS = {
  title: "Loading on-device AI…",
  benefit:
    "So directions fit this page — privately, without sending it to the cloud.",
} as const;

/** Fixed curated / page-busy copy when local AI is not starting. */
export const PAGE_BUSY_STATUS = {
  title: "Understanding this page…",
  benefit: "Building a short list of useful directions.",
} as const;

/**
 * Next line in the pool after `previous` (wraps). Used while Nano is busy so
 * copy changes in lockstep with the thinking animation.
 */
export function nextMicrocopyAfter(
  surface: MicrocopySurface,
  previous: string | null,
): string {
  const pool = MICROCOPY_POOLS[surface];
  if (pool.length === 0) {
    return "";
  }
  if (previous == null) {
    return pickMicrocopy(surface);
  }
  const idx = pool.indexOf(previous);
  return pool[((idx >= 0 ? idx : 0) + 1) % pool.length]!;
}

/** Surfaces that must never use playful pools (documentation / assertion aid). */
export const SOBER_MICROCOPY_SURFACES = [
  "sensitive-override",
  "permission-denied",
  "clear-all-data",
  "injection-warning",
] as const;
