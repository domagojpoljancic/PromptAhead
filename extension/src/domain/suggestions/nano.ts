/**
 * Real on-device Gemini Nano adapter (DOM-27).
 *
 * Hosted in the side-panel Prompt API context (M0 S0.1). Portable prompts stay
 * on deterministic `buildPrompt()` so source facts are never rewritten by Nano.
 */

import { buildPrompt } from "../prompts";
import { renderSourceData } from "../prompts/source-data";
import { CuratedSuggestionEngine } from "./curated";
import {
  NANO_ACTION_LIST_SCHEMA,
  NANO_ACTION_SYSTEM_PROMPT,
  buildNanoActionUserPayload,
  buildNanoRepairPrompt,
} from "./nano-schema";
import {
  createNanoSession,
  getLanguageModel,
  isPromptApiPresent,
  probeAvailability,
  promptNano,
  type LanguageModelLike,
  type LanguageModelSessionLike,
} from "./nano-prompt-api";
import { validateNanoActionOutput } from "./nano-validate";
import type {
  ActionGenerationInput,
  PromptGenerationInput,
  SuggestionEngine,
  SuggestionResult,
} from "./types";

/** Handoff / M2 hard budget for action generation prompts. */
export const NANO_PROMPT_TIMEOUT_MS = 10_000;
/** Session create may include a short warm-up; keep under the same product feel. */
export const NANO_CREATE_TIMEOUT_MS = 15_000;

export type NanoSuggestionEngineOptions = {
  /** Injected for tests; defaults to the realm `LanguageModel`. */
  getModel?: () => LanguageModelLike | undefined;
  /** When true, `isAvailable()` is always false (CI / curated suites). */
  forceDisabled?: boolean;
  promptTimeoutMs?: number;
  createTimeoutMs?: number;
};

function isForceDisabled(
  explicit: boolean | undefined,
): boolean {
  if (explicit === true) {
    return true;
  }
  if (typeof process !== "undefined" && process.env?.NANO_FORCE_DISABLED === "1") {
    return true;
  }
  return false;
}

export class NanoSuggestionEngine implements SuggestionEngine {
  readonly id = "nano" as const;

  private readonly getModel: () => LanguageModelLike | undefined;
  private readonly forceDisabled: boolean;
  private readonly promptTimeoutMs: number;
  private readonly createTimeoutMs: number;
  private readonly curated = new CuratedSuggestionEngine();

  constructor(options: NanoSuggestionEngineOptions = {}) {
    this.getModel = options.getModel ?? getLanguageModel;
    this.forceDisabled = isForceDisabled(options.forceDisabled);
    this.promptTimeoutMs = options.promptTimeoutMs ?? NANO_PROMPT_TIMEOUT_MS;
    this.createTimeoutMs = options.createTimeoutMs ?? NANO_CREATE_TIMEOUT_MS;
  }

  async isAvailable(): Promise<boolean> {
    if (this.forceDisabled) {
      return false;
    }
    if (!isPromptApiPresent() && !this.getModel()) {
      return false;
    }
    const model = this.getModel();
    if (!model) {
      return false;
    }
    const availability = await probeAvailability(model);
    return availability === "available";
  }

  async suggestActions(input: ActionGenerationInput): Promise<SuggestionResult> {
    try {
      return await this.suggestWithNano(input);
    } catch {
      return this.curated.suggestActions(input);
    }
  }

  generatePrompt(input: PromptGenerationInput): Promise<string> {
    // Deterministic builder — Nano proposes actions, not rewritten source facts.
    return Promise.resolve(
      buildPrompt({
        pageContext: input.pageContext,
        task: input.action,
        userNote: input.userNote,
        languageOverride: input.languageOverride,
      }).text,
    );
  }

  private async suggestWithNano(
    input: ActionGenerationInput,
  ): Promise<SuggestionResult> {
    const model = this.getModel();
    if (!model) {
      throw new Error("LanguageModel is not available");
    }

    const sourceDataBlock = renderSourceData(input.pageContext).text;
    const userPayload = buildNanoActionUserPayload({
      language: input.pageContext.language || "en",
      pageType: input.pageContext.pageType,
      preferredCategories: input.preferredCategories,
      sourceDataBlock,
    });

    let session: LanguageModelSessionLike | null = null;
    try {
      session = await createNanoSession(model, {
        systemPrompt: NANO_ACTION_SYSTEM_PROMPT,
        timeoutMs: this.createTimeoutMs,
      });

      const first = await promptNano(session, userPayload, {
        timeoutMs: this.promptTimeoutMs,
        responseConstraint: NANO_ACTION_LIST_SCHEMA,
      });
      const validated = validateNanoActionOutput(first, {
        pageType: input.pageContext.pageType,
        pageTitle: input.pageContext.title,
      });
      if (validated.ok) {
        return validated.result;
      }

      // One repair attempt (handoff §30), then curated floor.
      const repaired = await promptNano(session, buildNanoRepairPrompt(first), {
        timeoutMs: this.promptTimeoutMs,
        responseConstraint: NANO_ACTION_LIST_SCHEMA,
      });
      const repairedValidated = validateNanoActionOutput(repaired, {
        pageType: input.pageContext.pageType,
        pageTitle: input.pageContext.title,
      });
      if (repairedValidated.ok) {
        return repairedValidated.result;
      }

      throw new Error(repairedValidated.reason);
    } finally {
      try {
        session?.destroy?.();
      } catch {
        // ignore
      }
    }
  }
}
