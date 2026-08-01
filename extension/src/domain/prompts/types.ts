/**
 * Shapes the prompt builder needs from whoever chose the action.
 *
 * These live here rather than in `domain/suggestions` so the prompt domain
 * stays a leaf: every engine (curated, mock, and later Nano) depends on the
 * builder, never the other way round.
 */

import type { PageContext } from "../../shared/types/page-context";

/** `EXPECTED_OUTPUT_FORMAT` from handoff §30. */
export type OutputFormat =
  | "structured_explanation"
  | "comparison"
  | "timeline"
  | "decision_brief"
  | "source_map"
  | "other";

/** The part of a suggested action the builder actually renders. */
export type PromptTask = {
  id: string;
  title: string;
  /** Imperative sentence describing what the destination model should do. */
  task: string;
  outputFormat: OutputFormat;
  /** Bullets describing the shape of a good answer. */
  outputSpec: readonly string[];
};

export type PromptBuildInput = {
  pageContext: PageContext;
  task: PromptTask;
  /** Free text from "Anything to add?" — untrusted, but user-authored. */
  userNote?: string;
  /** `null`/omitted follows the page language (handoff §19). */
  languageOverride?: string | null;
};

export type BuiltPrompt = {
  text: string;
  characterCount: number;
  /** BCP-47 tag the answer was requested in. */
  language: string;
  /** True when source context hit the character budget and was cut short. */
  sourceTruncated: boolean;
};
