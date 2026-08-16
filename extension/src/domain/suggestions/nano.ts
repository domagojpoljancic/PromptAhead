/**
 * Real on-device Gemini Nano adapter (DOM-27).
 *
 * Hosted in the side-panel Prompt API context (M0 S0.1). Portable prompts stay
 * on deterministic `buildPrompt()` so source facts are never rewritten by Nano.
 *
 * DOM-66/67: optional `mode: "rank"` ranks curated catalog ids (fast path) and
 * reuses a warm LanguageModel session across suggests.
 */

import { buildPrompt } from "../prompts";
import { renderSourceData } from "../prompts/source-data";
import { curatedActionsFor } from "./catalog";
import { CuratedSuggestionEngine } from "./curated";
import {
  NANO_ACTION_LIST_SCHEMA,
  NANO_ACTION_SYSTEM_PROMPT,
  buildNanoActionUserPayload,
  buildNanoRepairPrompt,
} from "./nano-schema";
import {
  NANO_RANK_CREATE_TIMEOUT_MS,
  NANO_RANK_PROMPT_TIMEOUT_MS,
  NANO_RANK_SUGGEST_BUDGET_MS,
  NANO_RANK_SYSTEM_PROMPT,
  buildNanoRankUserPayload,
  buildPageFingerprint,
  catalogCandidatesForPage,
  parseNanoRankOrderedIds,
  suggestionResultFromRankedIds,
} from "./nano-rank";
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

/** Warm session shared across NanoSuggestionEngine instances (side panel). */
let sharedSession: LanguageModelSessionLike | null = null;
let sharedSessionLanguage: string | null = null;
let sharedSessionMode: "rank" | "generate" | null = null;

export type NanoSuggestMode = "generate" | "rank";

export type NanoSuggestionEngineOptions = {
  /** Injected for tests; defaults to the realm `LanguageModel`. */
  getModel?: () => LanguageModelLike | undefined;
  /** When true, `isAvailable()` is always false (CI / curated suites). */
  forceDisabled?: boolean;
  promptTimeoutMs?: number;
  createTimeoutMs?: number;
  suggestBudgetMs?: number;
  /**
   * `rank` = catalog id ranking (DOM-66/67 fast path).
   * `generate` = full free-form actions (legacy).
   */
  mode?: NanoSuggestMode;
  /** Keep LanguageModel session warm across suggests (default true for rank). */
  reuseSession?: boolean;
};

function isForceDisabled(explicit: boolean | undefined): boolean {
  if (explicit === true) {
    return true;
  }
  if (typeof process !== "undefined" && process.env?.NANO_FORCE_DISABLED === "1") {
    return true;
  }
  return false;
}

function destroySharedSession(): void {
  try {
    sharedSession?.destroy?.();
  } catch {
    // ignore
  }
  sharedSession = null;
  sharedSessionLanguage = null;
  sharedSessionMode = null;
}

/** Test helper — drop the warm session between suites. */
export function resetNanoSharedSessionForTests(): void {
  destroySharedSession();
}

export class NanoSuggestionEngine implements SuggestionEngine {
  readonly id = "nano" as const;

  private readonly getModel: () => LanguageModelLike | undefined;
  private readonly forceDisabled: boolean;
  private readonly promptTimeoutMs: number;
  private readonly createTimeoutMs: number;
  private readonly suggestBudgetMs: number;
  private readonly mode: NanoSuggestMode;
  private readonly reuseSession: boolean;
  private readonly curated = new CuratedSuggestionEngine();

  constructor(options: NanoSuggestionEngineOptions = {}) {
    this.getModel = options.getModel ?? getLanguageModel;
    this.forceDisabled = isForceDisabled(options.forceDisabled);
    this.mode = options.mode ?? "generate";
    this.reuseSession = options.reuseSession ?? this.mode === "rank";
    this.promptTimeoutMs =
      options.promptTimeoutMs ??
      (this.mode === "rank" ? NANO_RANK_PROMPT_TIMEOUT_MS : NANO_PROMPT_TIMEOUT_MS);
    this.createTimeoutMs =
      options.createTimeoutMs ??
      (this.mode === "rank" ? NANO_RANK_CREATE_TIMEOUT_MS : NANO_CREATE_TIMEOUT_MS);
    this.suggestBudgetMs =
      options.suggestBudgetMs ??
      (this.mode === "rank" ? NANO_RANK_SUGGEST_BUDGET_MS : NANO_SUGGEST_BUDGET_MS);
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
      const result =
        this.mode === "rank"
          ? await this.suggestWithRank(input)
          : await this.suggestWithNano(input);
      const elapsedMs = Date.now() - started;
      try {
        console.info(
          `[PromptAhead] Nano suggest ok (${this.mode}) in ${elapsedMs}ms`,
        );
      } catch {
        // Ignore logging failures.
      }
      return {
        ...result,
        debug: {
          ...result.debug,
          elapsedMs,
          nanoPath: result.debug?.nanoPath ?? this.mode,
        },
      };
    } catch (error) {
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
      // Failed create/prompt may leave a bad warm session — drop it.
      if (this.reuseSession) {
        destroySharedSession();
      }
      return {
        ...curatedResult,
        debug: {
          nanoFailureReason: reason,
          elapsedMs,
          nanoPath: "curated-fallback",
        },
      };
    }
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

  private async getSession(
    model: LanguageModelLike,
    language: string,
    systemPrompt: string,
    createTimeout: number,
  ): Promise<{ session: LanguageModelSessionLike; createMs: number }> {
    if (
      this.reuseSession &&
      sharedSession &&
      sharedSessionLanguage === language &&
      sharedSessionMode === this.mode
    ) {
      return { session: sharedSession, createMs: 0 };
    }
    if (this.reuseSession) {
      destroySharedSession();
    }
    const createStarted = Date.now();
    const session = await createNanoSession(model, {
      systemPrompt,
      timeoutMs: createTimeout,
      language,
    });
    const createMs = Date.now() - createStarted;
    if (this.reuseSession) {
      sharedSession = session;
      sharedSessionLanguage = language;
      sharedSessionMode = this.mode;
    }
    return { session, createMs };
  }

  private async suggestWithRank(
    input: ActionGenerationInput,
  ): Promise<SuggestionResult> {
    const model = this.getModel();
    if (!model) {
      throw new Error("LanguageModel is not available");
    }

    const deadline = Date.now() + this.suggestBudgetMs;
    const remainingMs = (): number => Math.max(0, deadline - Date.now());
    const language = input.pageContext.language || "en";
    const catalog = curatedActionsFor(input.pageContext.pageType, {
      hasSelectedText: Boolean(input.pageContext.selectedText?.trim()),
      comparableSet: input.pageContext.comparableSet,
    });
    const candidates = catalogCandidatesForPage(input.pageContext);
    const fingerprint = buildPageFingerprint(input.pageContext);
    const userPayload = buildNanoRankUserPayload({
      language,
      fingerprint,
      candidates,
    });

    let session: LanguageModelSessionLike | null = null;
    let ownedSession = false;
    let createMs = 0;
    try {
      const createTimeout = Math.min(this.createTimeoutMs, remainingMs());
      if (createTimeout <= 0) {
        throw new Error("suggest budget exhausted before create");
      }
      try {
        const got = await this.getSession(
          model,
          language,
          NANO_RANK_SYSTEM_PROMPT,
          createTimeout,
        );
        session = got.session;
        createMs = got.createMs;
        ownedSession = !this.reuseSession;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "nano.create failed";
        throw new Error(`nano.create: ${reason}`);
      }

      const promptTimeout = Math.min(this.promptTimeoutMs, remainingMs());
      if (promptTimeout <= 0) {
        throw new Error("suggest budget exhausted before prompt");
      }
      const promptStarted = Date.now();
      const raw = await this.promptActions(session, userPayload, {
        preferConstraint: false,
        timeoutMs: promptTimeout,
      });
      const promptMs = Date.now() - promptStarted;
      const orderedIds = parseNanoRankOrderedIds(raw);
      const mapped = suggestionResultFromRankedIds(orderedIds, catalog);
      if (!mapped) {
        throw new Error("No valid Nano rank ids");
      }
      return {
        ...mapped,
        debug: {
          ...mapped.debug,
          createMs,
          promptMs,
          nanoPath: "rank",
        },
      };
    } finally {
      if (ownedSession) {
        try {
          session?.destroy?.();
        } catch {
          // ignore
        }
      }
    }
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
    let ownedSession = false;
    let createMs = 0;
    try {
      try {
        const createTimeout = Math.min(this.createTimeoutMs, remainingMs());
        if (createTimeout <= 0) {
          throw new Error("suggest budget exhausted before create");
        }
        const got = await this.getSession(
          model,
          language,
          NANO_ACTION_SYSTEM_PROMPT,
          createTimeout,
        );
        session = got.session;
        createMs = got.createMs;
        ownedSession = !this.reuseSession;
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "nano.create failed";
        throw new Error(`nano.create: ${reason}`);
      }

      const firstTimeout = promptTimeoutForPass();
      if (firstTimeout <= 0) {
        throw new Error("suggest budget exhausted before prompt");
      }
      const promptStarted = Date.now();
      const first = await this.promptActions(session, userPayload, {
        preferConstraint: false,
        timeoutMs: firstTimeout,
      });
      let promptMs = Date.now() - promptStarted;
      const validated = validateNanoActionOutput(first, {
        pageType: input.pageContext.pageType,
        pageTitle: input.pageContext.title,
      });
      if (validated.ok) {
        return {
          ...validated.result,
          debug: {
            ...validated.result.debug,
            createMs,
            promptMs,
            nanoPath: "generate",
          },
        };
      }

      if (remainingMs() < NANO_MIN_RETRY_BUDGET_MS) {
        throw new Error(validated.reason);
      }
      const repairTimeout = promptTimeoutForPass();
      const repaired = await this.promptActions(
        session,
        buildNanoRepairPrompt(first),
        { preferConstraint: false, timeoutMs: repairTimeout },
      );
      promptMs += Date.now() - promptStarted;
      const repairedValidated = validateNanoActionOutput(repaired, {
        pageType: input.pageContext.pageType,
        pageTitle: input.pageContext.title,
      });
      if (repairedValidated.ok) {
        return {
          ...repairedValidated.result,
          debug: {
            ...repairedValidated.result.debug,
            createMs,
            promptMs,
            nanoPath: "generate",
          },
        };
      }

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
          return {
            ...constrainedValidated.result,
            debug: {
              ...constrainedValidated.result.debug,
              createMs,
              promptMs,
              nanoPath: "generate",
            },
          };
        }
        throw new Error(constrainedValidated.reason);
      } catch (error) {
        throw new Error(
          repairedValidated.reason ||
            (error instanceof Error ? error.message : "No valid Nano actions"),
        );
      }
    } finally {
      if (ownedSession) {
        try {
          session?.destroy?.();
        } catch {
          // ignore
        }
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
