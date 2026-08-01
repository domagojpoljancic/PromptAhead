/**
 * Engine selection. One flag decides which engine the product runs with, and
 * selection always degrades to curated rather than failing.
 */

import { CuratedSuggestionEngine } from "./curated";
import { MockNanoSuggestionEngine } from "./mock-nano";
import {
  type ActionGenerationInput,
  type PromptGenerationInput,
  type SuggestionEngine,
  type SuggestionEngineId,
  type SuggestionResult,
} from "./types";

/**
 * The single switch. `curated` ships in M1; tests and local development pass
 * `mock-nano` explicitly, and M2 flips this to `nano` once the Prompt API
 * adapter exists.
 */
export const SUGGESTION_ENGINE_FLAG: SuggestionEngineId = "curated";

/**
 * Placeholder for the real Prompt API adapter (M2). It reports unavailable so
 * `selectSuggestionEngine` exercises the same fallback path the real adapter
 * will use on machines without Nano.
 */
export class UnavailableNanoSuggestionEngine implements SuggestionEngine {
  readonly id = "nano" as const;

  isAvailable(): Promise<boolean> {
    return Promise.resolve(false);
  }

  suggestActions(_input: ActionGenerationInput): Promise<SuggestionResult> {
    void _input;
    return Promise.reject(new Error("Gemini Nano is not wired up until M2"));
  }

  generatePrompt(_input: PromptGenerationInput): Promise<string> {
    void _input;
    return Promise.reject(new Error("Gemini Nano is not wired up until M2"));
  }
}

export function createSuggestionEngine(
  id: SuggestionEngineId = SUGGESTION_ENGINE_FLAG,
): SuggestionEngine {
  switch (id) {
    case "curated":
      return new CuratedSuggestionEngine();
    case "mock-nano":
      return new MockNanoSuggestionEngine();
    case "nano":
      return new UnavailableNanoSuggestionEngine();
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
