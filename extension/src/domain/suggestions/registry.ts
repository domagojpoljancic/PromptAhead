/**
 * Engine selection. One flag decides which engine the product runs with, and
 * selection always degrades to curated rather than failing.
 */

import { CuratedSuggestionEngine } from "./curated";
import { MockNanoSuggestionEngine } from "./mock-nano";
import { NanoSuggestionEngine } from "./nano";
import {
  type SuggestionEngine,
  type SuggestionEngineId,
} from "./types";

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

export function createSuggestionEngine(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
): SuggestionEngine {
  const resolved = resolveSuggestionEngineId(id);
  switch (resolved) {
    case "curated":
      return new CuratedSuggestionEngine();
    case "mock-nano":
      return new MockNanoSuggestionEngine();
    case "nano":
      return new NanoSuggestionEngine();
  }
}

/**
 * Resolves the engine the UI should actually use: the configured one when it
 * is available, curated otherwise. Curated is the guaranteed floor.
 */
export async function selectSuggestionEngine(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
): Promise<SuggestionEngine> {
  const engine = createSuggestionEngine(id);
  if (engine.id === "curated" || (await engine.isAvailable())) {
    return engine;
  }
  return new CuratedSuggestionEngine();
}
