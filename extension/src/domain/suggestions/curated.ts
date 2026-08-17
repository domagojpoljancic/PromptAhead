/**
 * Deterministic curated engine (handoff §13).
 *
 * This is the path that must always work: no model, no network, no I/O. Nano
 * is an optional improvement layered on top of it, never a prerequisite, so
 * the curated engine is kept as its own tested code path (handoff §30).
 */

import { buildPrompt } from "../prompts";
import { curatedActionsFor } from "./catalog";
import {
  MORE_ACTION_COUNT,
  PRIMARY_ACTION_COUNT,
  type ActionGenerationInput,
  type PromptGenerationInput,
  type SuggestionEngine,
  type SuggestionResult,
} from "./types";

export class CuratedSuggestionEngine implements SuggestionEngine {
  readonly id = "curated" as const;

  /** Templates only — nothing can make this unavailable. */
  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  suggestActions(input: ActionGenerationInput): Promise<SuggestionResult> {
    const { pageContext } = input;
    const actions = curatedActionsFor(pageContext.pageType, {
      hasSelectedText: Boolean(pageContext.selectedText),
      comparableSet: pageContext.comparableSet,
    });

    return Promise.resolve({
      engineId: this.id,
      primary: actions.slice(0, PRIMARY_ACTION_COUNT),
      more: actions.slice(
        PRIMARY_ACTION_COUNT,
        PRIMARY_ACTION_COUNT + MORE_ACTION_COUNT,
      ),
    });
  }

  generatePrompt(input: PromptGenerationInput): Promise<string> {
    return Promise.resolve(
      buildPrompt({
        pageContext: input.pageContext,
        task: input.action,
        userNote: input.userNote,
        languageOverride: input.languageOverride,
      }).text,
    );
  }
}
