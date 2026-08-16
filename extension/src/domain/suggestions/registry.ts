/**
 * Engine selection. One flag decides which engine the product runs with, and
 * selection always degrades to curated rather than failing.
 */

import type { NanoPreference } from "../../shared/storage/schema";
import { CuratedSuggestionEngine } from "./curated";
import { MockNanoSuggestionEngine } from "./mock-nano";
import { NanoSuggestionEngine } from "./nano";
import { engineIdForNanoPreference } from "./nano-readiness";
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
  options: { nanoFastPath?: boolean } = {},
): SuggestionEngine {
  const resolved = resolveSuggestionEngineId(id);
  switch (resolved) {
    case "curated":
      return new CuratedSuggestionEngine();
    case "mock-nano":
      return new MockNanoSuggestionEngine();
    case "nano":
      return new NanoSuggestionEngine({
        mode: options.nanoFastPath === false ? "generate" : "rank",
        reuseSession: options.nanoFastPath !== false,
      });
  }
}

/**
 * Resolves the engine the UI should actually use: the configured one when it
 * is available, curated otherwise. Curated is the guaranteed floor.
 */
export async function selectSuggestionEngine(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
  options: { nanoFastPath?: boolean } = {},
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
  options: { nanoFastPath?: boolean } = {},
): Promise<SuggestionEngine> {
  const preferred = engineIdForNanoPreference(preference);
  return selectSuggestionEngine(preferred, options);
}
