/**
 * Local structural types for the Chrome Prompt API (`LanguageModel`).
 *
 * The spike deliberately does not consume the ambient `@types/dom-chromium-ai`
 * globals: the API is still volatile, so we want a shape mismatch to surface as
 * a logged runtime finding in Chrome rather than as a build error against a
 * typings version that may already be stale.
 */

export type LanguageModelAvailability =
  "unavailable" | "downloadable" | "downloading" | "available";

export const AVAILABILITY_VALUES: readonly LanguageModelAvailability[] = [
  "unavailable",
  "downloadable",
  "downloading",
  "available",
];

export type PromptApiSurface = "LanguageModel" | "ai.languageModel" | "none";

export type SpikeContextId = "sidepanel" | "options" | "service-worker";

export const SPIKE_CONTEXT_LABELS: Record<SpikeContextId, string> = {
  sidepanel: "Side panel",
  options: "Options page",
  "service-worker": "Service worker",
};

export interface LanguageModelExpectation {
  type: "text" | "image" | "audio";
  languages?: string[];
}

export interface LanguageModelInitialPrompt {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DownloadProgressEventLike extends Event {
  /** Chrome reports a 0–1 fraction here; older builds also set `total`. */
  loaded: number;
  total?: number;
}

export interface CreateMonitorLike {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEventLike) => void,
  ): void;
}

export interface LanguageModelCreateOptions {
  expectedInputs?: LanguageModelExpectation[];
  expectedOutputs?: LanguageModelExpectation[];
  initialPrompts?: LanguageModelInitialPrompt[];
  monitor?: (monitor: CreateMonitorLike) => void;
  signal?: AbortSignal;
  temperature?: number;
  topK?: number;
}

export interface LanguageModelPromptOptions {
  signal?: AbortSignal;
  responseConstraint?: object;
  omitResponseConstraintInput?: boolean;
}

export interface LanguageModelSessionLike {
  prompt(input: string, options?: LanguageModelPromptOptions): Promise<string>;
  clone?(options?: { signal?: AbortSignal }): Promise<LanguageModelSessionLike>;
  destroy?(): void;
  readonly inputUsage?: number;
  readonly inputQuota?: number;
}

export interface LanguageModelParamsLike {
  defaultTopK?: number;
  maxTopK?: number;
  defaultTemperature?: number;
  maxTemperature?: number;
}

export interface LanguageModelLike {
  availability(
    options?: LanguageModelCreateOptions,
  ): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSessionLike>;
  params?(): Promise<LanguageModelParamsLike | null>;
}

export interface ErrorShape {
  name: string;
  message: string;
  constructorName: string;
  /** `DOMException.code`, when the failure is a DOMException. */
  code?: number;
  raw: string;
}

export interface PromptApiDetection {
  surface: PromptApiSurface;
  hasAvailability: boolean;
  hasCreate: boolean;
  hasParams: boolean;
  /** Which built-in AI globals exist in this realm (helps date the Chrome build). */
  aiGlobals: string[];
}
