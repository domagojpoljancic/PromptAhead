/**
 * The `SuggestionEngine` seam (architecture §4).
 *
 * Three implementations share it: deterministic curated templates, a fixture
 * engine for tests and development, and — from M2 — the real Prompt API
 * adapter. Nothing outside this folder should care which one is running.
 */

import type { OutputFormat, PromptTask } from "../prompts";
import type { PageContext, PageType } from "../../shared/types/page-context";

export type SuggestionEngineId = "curated" | "mock-nano" | "nano";

/**
 * Coarse bucket an action belongs to. M3 preference learning aggregates these
 * per page type; they are deliberately not URLs or titles.
 */
export type ActionCategory =
  | "context"
  | "perspectives"
  | "developments"
  | "sources"
  | "timeline"
  | "critique"
  | "level"
  | "price"
  | "alternatives"
  | "weaknesses"
  | "cost"
  | "compatibility"
  | "comparison"
  | "tradeoffs"
  | "next-steps"
  | "selection"
  | "custom";

/** Handoff §30 caps, applied to every engine so the UI never has to clip. */
export const MAX_ACTION_TITLE_CHARS = 60;
/** Short enough for the narrow side panel — one scannable line of why. */
export const MAX_ACTION_DESCRIPTION_CHARS = 90;
/** Handoff §15: three ranked directions, everything else behind "More…". */
export const PRIMARY_ACTION_COUNT = 3;

export type SuggestedAction = PromptTask & {
  /** One line of "why pick this", shown under the title. */
  description: string;
  category: ActionCategory;
  pageType: PageType;
};

export type ActionGenerationInput = {
  pageContext: PageContext;
  /**
   * Aggregate, non-identifying preferences (handoff §30 `USER_PREFERENCES`).
   * Curated ignores them; Nano will rank with them in M3.
   */
  preferredCategories?: readonly ActionCategory[];
};

export type SuggestionResult = {
  engineId: SuggestionEngineId;
  /** Ranked best-first; at most `PRIMARY_ACTION_COUNT`. */
  primary: SuggestedAction[];
  /** Revealed by "More…". */
  more: SuggestedAction[];
  /**
   * Optional debugging metadata surfaced by the UI layer.
   * Never include page content or prompt text.
   */
  debug?: {
    /**
     * When the Nano engine falls back to curated, this explains why at a
     * coarse level (timeout / invalid JSON / schema mismatch).
     */
    nanoFailureReason?: string;
    /** Wall-clock ms for the Nano suggest path (create + prompt + validate). */
    elapsedMs?: number;
    /** Which Nano strategy produced this result (DOM-66). */
    nanoPath?: "rank" | "generate" | "curated-fallback";
    createMs?: number;
    promptMs?: number;
  };
};

export type PromptGenerationInput = {
  pageContext: PageContext;
  action: SuggestedAction;
  /** Optional free-text note before building the prompt. */
  userNote?: string;
  /** `null`/omitted follows the page language (handoff §19). */
  languageOverride?: string | null;
};

export interface SuggestionEngine {
  readonly id: SuggestionEngineId;
  isAvailable(): Promise<boolean>;
  suggestActions(input: ActionGenerationInput): Promise<SuggestionResult>;
  generatePrompt(input: PromptGenerationInput): Promise<string>;
}

export type { OutputFormat };
