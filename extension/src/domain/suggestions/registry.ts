/**
 * Engine selection. One flag decides which engine the product runs with, and
 * selection always degrades to curated rather than failing.
 */

import type {
  NanoPreference,
  NanoSuggestMode,
} from "../../shared/storage/schema";
import { CuratedSuggestionEngine } from "./curated";
import { MockNanoSuggestionEngine } from "./mock-nano";
import {
  NanoSuggestionEngine,
  type NanoSuggestionEngineOptions,
} from "./nano";
import { engineIdForNanoPreference } from "./nano-readiness";
import {
  type SuggestionEngine,
  type SuggestionEngineId,
} from "./types";

export type SuggestionEngineSelectOptions = {
  nanoSuggestMode?: NanoSuggestMode;
};

/**
 * The single switch. `curated` ships by default; tests and local development
 * pass `mock-nano` / `nano` explicitly. Prefer Nano only when available.
 */
export const SUGGESTION_ENGINE_FLAG: SuggestionEngineId = "curated";

/**
 * @deprecated Prefer {@link NanoSuggestionEngine} with `forceDisabled` / unavailable
 * Prompt API. Kept so older tests that construct the placeholder still compile.
 */
export class UnavailableNanoSuggestionEngine extends NanoSuggestionEngine {
  constructor() {
    super({ forceDisabled: true });
  }
}

function readEnvEngineId(): SuggestionEngineId | null {
  if (typeof process === "undefined") {
    return null;
  }
  const value = process.env?.SUGGESTION_ENGINE;
  if (value === "curated" || value === "mock-nano" || value === "nano") {
    return value;
  }
  return null;
}

export function resolveSuggestionEngineId(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
): SuggestionEngineId {
  return readEnvEngineId() ?? id;
}

export function nanoEngineOptionsForMode(
  mode: NanoSuggestMode,
): NanoSuggestionEngineOptions {
  switch (mode) {
    case "rank":
      return { mode: "rank", sessionPolicy: "reuse" };
    case "rank-clone":
      return { mode: "rank", sessionPolicy: "clone" };
    case "hybrid":
      return { mode: "hybrid", sessionPolicy: "clone" };
    case "generate":
    case "curated":
      return { mode: "generate", sessionPolicy: "fresh" };
  }
}

export function createSuggestionEngine(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
  options: SuggestionEngineSelectOptions = {},
): SuggestionEngine {
  const resolved = resolveSuggestionEngineId(id);
  switch (resolved) {
    case "curated":
      return new CuratedSuggestionEngine();
    case "mock-nano":
      return new MockNanoSuggestionEngine();
    case "nano": {
      const mode = options.nanoSuggestMode ?? "generate";
      if (mode === "curated") {
        return new CuratedSuggestionEngine();
      }
      return new NanoSuggestionEngine(nanoEngineOptionsForMode(mode));
    }
  }
}

/**
 * Resolves the engine the UI should actually use: the configured one when it
 * is available, curated otherwise. Curated is the guaranteed floor.
 */
export async function selectSuggestionEngine(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
  options: SuggestionEngineSelectOptions = {},
): Promise<SuggestionEngine> {
  const engine = createSuggestionEngine(id, options);
  if (engine.id === "curated" || engine.id === "mock-nano") {
    return engine;
  }
  if (await engine.isAvailable()) {
    return engine;
  }
  return new CuratedSuggestionEngine();
}

/**
 * Product selection: honor `nanoPreference`, then env override, then availability.
 * `basic` / `skipped` → curated. `enabled` → Nano when available.
 */
export async function selectSuggestionEngineForPreference(
  preference: NanoPreference,
  options: SuggestionEngineSelectOptions = {},
): Promise<SuggestionEngine> {
  if (options.nanoSuggestMode === "curated") {
    return new CuratedSuggestionEngine();
  }
  const preferred = engineIdForNanoPreference(preference);
  return selectSuggestionEngine(preferred, options);
}
