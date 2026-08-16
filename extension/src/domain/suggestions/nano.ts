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

/** Per-prompt cap — keep short so stacked retries cannot dominate. */
export const NANO_PROMPT_TIMEOUT_MS = 25_000;
/** Session create may include model warm-up on first hardware run. */
export const NANO_CREATE_TIMEOUT_MS = 30_000;
/**
 * Wall-clock budget for the whole Nano suggest attempt (create + prompts).
 * Exceeding it fails through to curated instead of stacking more retries.
 */
export const NANO_SUGGEST_BUDGET_MS = 55_000;
/** Skip further prompt passes when less than this remains on the budget. */
const NANO_MIN_RETRY_BUDGET_MS = 8_000;

export type NanoSuggestionEngineOptions = {
  /** Injected for tests; defaults to the realm `LanguageModel`. */
  getModel?: () => LanguageModelLike | undefined;
  /** When true, `isAvailable()` is always false (CI / curated suites). */
  forceDisabled?: boolean;
  promptTimeoutMs?: number;
  createTimeoutMs?: number;
  suggestBudgetMs?: number;
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
  private readonly suggestBudgetMs: number;
  private readonly curated = new CuratedSuggestionEngine();

  constructor(options: NanoSuggestionEngineOptions = {}) {
    this.getModel = options.getModel ?? getLanguageModel;
    this.forceDisabled = isForceDisabled(options.forceDisabled);
    this.promptTimeoutMs = options.promptTimeoutMs ?? NANO_PROMPT_TIMEOUT_MS;
    this.createTimeoutMs = options.createTimeoutMs ?? NANO_CREATE_TIMEOUT_MS;
    this.suggestBudgetMs = options.suggestBudgetMs ?? NANO_SUGGEST_BUDGET_MS;
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
    const started = Date.now();
    try {
      const result = await this.suggestWithNano(input);
      const elapsedMs = Date.now() - started;
      try {
        console.info(`[PromptAhead] Nano suggest ok in ${elapsedMs}ms`);
      } catch {
        // Ignore logging failures.
      }
      return {
        ...result,
        debug: {
          ...result.debug,
          elapsedMs,
        },
      };
    } catch (error) {
      // Nano should never block the product: fall back to curated actions,
      // but retain a coarse failure reason for on-device debugging.
      const elapsedMs = Date.now() - started;
      const curatedResult = await this.curated.suggestActions(input);
      const reason =
        error instanceof Error ? error.message : "Nano failed (unknown error)";
      try {
        console.info(
          `[PromptAhead] Nano fell back to curated after ${elapsedMs}ms:`,
          reason,
        );
      } catch {
        // Ignore logging failures.
      }
      return {
        ...curatedResult,
        debug: {
          nanoFailureReason: reason,
          elapsedMs,
        },
      };
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

    const deadline = Date.now() + this.suggestBudgetMs;
    const remainingMs = (): number => Math.max(0, deadline - Date.now());
    const promptTimeoutForPass = (): number =>
      Math.min(this.promptTimeoutMs, remainingMs());

    const language = input.pageContext.language || "en";
    const sourceDataBlock = renderSourceData(input.pageContext).text;
    const userPayload = buildNanoActionUserPayload({
      language,
      pageType: input.pageContext.pageType,
      preferredCategories: input.preferredCategories,
      sourceDataBlock,
    });

    let session: LanguageModelSessionLike | null = null;
    try {
      try {
        const createTimeout = Math.min(this.createTimeoutMs, remainingMs());
        if (createTimeout <= 0) {
          throw new Error("suggest budget exhausted before create");
        }
        session = await createNanoSession(model, {
          systemPrompt: NANO_ACTION_SYSTEM_PROMPT,
          timeoutMs: createTimeout,
          language,
        });
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "nano.create failed";
        throw new Error(`nano.create: ${reason}`);
      }

      // Prefer unconstrained prompt first — DOM-31 hardware showed plain
      // session.prompt() works while responseConstraint can hang ~45s on some
      // Chrome builds after model wipe/restore. Validate in-process either way.
      const firstTimeout = promptTimeoutForPass();
      if (firstTimeout <= 0) {
        throw new Error("suggest budget exhausted before prompt");
      }
      const first = await this.promptActions(session, userPayload, {
        preferConstraint: false,
        timeoutMs: firstTimeout,
      });
      const validated = validateNanoActionOutput(first, {
        pageType: input.pageContext.pageType,
        pageTitle: input.pageContext.title,
      });
      if (validated.ok) {
        return validated.result;
      }

      // One repair attempt when budget remains — skip stacked retries that
      // previously pushed wall-clock past ~100s on slow hardware.
      if (remainingMs() < NANO_MIN_RETRY_BUDGET_MS) {
        throw new Error(validated.reason);
      }
      const repairTimeout = promptTimeoutForPass();
      const repaired = await this.promptActions(
        session,
        buildNanoRepairPrompt(first),
        { preferConstraint: false, timeoutMs: repairTimeout },
      );
      const repairedValidated = validateNanoActionOutput(repaired, {
        pageType: input.pageContext.pageType,
        pageTitle: input.pageContext.title,
      });
      if (repairedValidated.ok) {
        return repairedValidated.result;
      }

      // Constrained pass is optional and historically hang-prone — only try
      // when meaningful budget remains.
      if (remainingMs() < NANO_MIN_RETRY_BUDGET_MS) {
        throw new Error(repairedValidated.reason);
      }
      try {
        const constrained = await this.promptActions(session, userPayload, {
          preferConstraint: true,
          timeoutMs: promptTimeoutForPass(),
        });
        const constrainedValidated = validateNanoActionOutput(constrained, {
          pageType: input.pageContext.pageType,
          pageTitle: input.pageContext.title,
        });
        if (constrainedValidated.ok) {
          return constrainedValidated.result;
        }
        throw new Error(constrainedValidated.reason);
      } catch (error) {
        throw new Error(
          repairedValidated.reason ||
            (error instanceof Error ? error.message : "No valid Nano actions"),
        );
      }
    } finally {
      try {
        session?.destroy?.();
      } catch {
        // ignore
      }
    }
  }

  private async promptActions(
    session: LanguageModelSessionLike,
    userPayload: string,
    options: { preferConstraint: boolean; timeoutMs: number },
  ): Promise<string> {
    try {
      return await promptNano(session, userPayload, {
        timeoutMs: options.timeoutMs,
        ...(options.preferConstraint
          ? { responseConstraint: NANO_ACTION_LIST_SCHEMA }
          : {}),
      });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "nano.prompt failed";
      throw new Error(
        options.preferConstraint
          ? `nano.prompt(constraint): ${reason}`
          : `nano.prompt: ${reason}`,
      );
    }
  }
}
