/**
 * Minimal Prompt API surface for the product Nano adapter.
 * Ported from spikes (do not import spikes into the extension bundle).
 */

export type LanguageModelAvailability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

export type LanguageModelSessionLike = {
  prompt(
    input: string,
    options?: {
      signal?: AbortSignal;
      responseConstraint?: object;
      omitResponseConstraintInput?: boolean;
    },
  ): Promise<string>;
  destroy?(): void;
};

export type DownloadProgressEventLike = {
  loaded: number;
  total?: number;
};

export type CreateMonitorLike = {
  addEventListener(
    type: "downloadprogress",
    listener: (event: DownloadProgressEventLike) => void,
  ): void;
};

export type LanguageModelCreateOptions = {
  expectedInputs?: object;
  expectedOutputs?: object;
  initialPrompts?: Array<{ role: string; content: string }>;
  temperature?: number;
  topK?: number;
  signal?: AbortSignal;
  monitor?: (monitor: CreateMonitorLike) => void;
};

export type LanguageModelLike = {
  availability(options?: object): Promise<LanguageModelAvailability>;
  create(options?: LanguageModelCreateOptions): Promise<LanguageModelSessionLike>;
};

const AVAILABILITY_VALUES = new Set<string>([
  "unavailable",
  "downloadable",
  "downloading",
  "available",
]);

/** Same expectations for availability() and create() (M0 finding). */
export const EN_TEXT_EXPECTATIONS = {
  expectedInputs: [{ type: "text" as const, languages: ["en"] }],
  expectedOutputs: [{ type: "text" as const, languages: ["en"] }],
};

/** Onboarding / settings model download may take minutes; never block forever. */
export const NANO_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

type AiScope = {
  LanguageModel?: LanguageModelLike;
  ai?: { languageModel?: LanguageModelLike };
};

export function getLanguageModel(): LanguageModelLike | undefined {
  const scope = globalThis as unknown as AiScope;
  return scope.LanguageModel ?? scope.ai?.languageModel;
}

export function isPromptApiPresent(): boolean {
  const model = getLanguageModel();
  return (
    typeof model?.availability === "function" &&
    typeof model?.create === "function"
  );
}

export async function probeAvailability(
  model: LanguageModelLike = getLanguageModel()!,
): Promise<LanguageModelAvailability | null> {
  try {
    const value = await model.availability(EN_TEXT_EXPECTATIONS);
    return AVAILABILITY_VALUES.has(value) ? value : null;
  } catch {
    return null;
  }
}

export class NanoTimeoutError extends Error {
  readonly name = "NanoTimeoutError";
  constructor(message = "Gemini Nano timed out") {
    super(message);
  }
}

/**
 * Hard timeout for Prompt API calls (product budget: 10s).
 * Aborts the signal for cooperative APIs and still rejects if they ignore it.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new NanoTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } catch (error) {
    if (
      error instanceof NanoTimeoutError ||
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "TimeoutError")
    ) {
      throw error instanceof NanoTimeoutError
        ? error
        : new NanoTimeoutError(
            error instanceof Error ? error.message : "Gemini Nano timed out",
          );
    }
    throw error;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export async function createNanoSession(
  model: LanguageModelLike,
  options: {
    systemPrompt: string;
    timeoutMs: number;
    temperature?: number;
    topK?: number;
  },
): Promise<LanguageModelSessionLike> {
  return withTimeout(
    (signal) =>
      model.create({
        ...EN_TEXT_EXPECTATIONS,
        initialPrompts: [{ role: "system", content: options.systemPrompt }],
        temperature: options.temperature ?? 0.4,
        topK: options.topK ?? 3,
        signal,
      }),
    options.timeoutMs,
  );
}

export type DownloadNanoModelResult = {
  session: LanguageModelSessionLike | null;
  progressEvents: number;
  lastProgressFraction: number | null;
  timedOut: boolean;
  error: Error | null;
};

/**
 * User-activated `create()` that surfaces `downloadprogress` for onboarding /
 * settings. Callers must destroy the session when done probing readiness.
 */
export async function downloadNanoModel(
  model: LanguageModelLike,
  options: {
    timeoutMs?: number;
    onProgress?: (fraction: number) => void;
  } = {},
): Promise<DownloadNanoModelResult> {
  const timeoutMs = options.timeoutMs ?? NANO_DOWNLOAD_TIMEOUT_MS;
  let progressEvents = 0;
  let lastProgressFraction: number | null = null;

  try {
    const session = await withTimeout(
      (signal) =>
        model.create({
          ...EN_TEXT_EXPECTATIONS,
          signal,
          monitor(monitor) {
            monitor.addEventListener("downloadprogress", (event) => {
              progressEvents += 1;
              const fraction =
                typeof event.total === "number" && event.total > 0
                  ? event.loaded / event.total
                  : event.loaded;
              lastProgressFraction = fraction;
              options.onProgress?.(fraction);
            });
          },
        }),
      timeoutMs,
    );
    return {
      session,
      progressEvents,
      lastProgressFraction,
      timedOut: false,
      error: null,
    };
  } catch (error) {
    return {
      session: null,
      progressEvents,
      lastProgressFraction,
      timedOut: error instanceof NanoTimeoutError,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

export function destroyNanoSession(
  session: LanguageModelSessionLike | null | undefined,
): void {
  if (!session || typeof session.destroy !== "function") {
    return;
  }
  try {
    session.destroy();
  } catch {
    // Destroying an already-destroyed session must never fail the UI.
  }
}

export async function promptNano(
  session: LanguageModelSessionLike,
  input: string,
  options: {
    timeoutMs: number;
    responseConstraint?: object;
  },
): Promise<string> {
  return withTimeout(
    (signal) =>
      session.prompt(input, {
        signal,
        ...(options.responseConstraint
          ? {
              responseConstraint: options.responseConstraint,
              omitResponseConstraintInput: true,
            }
          : {}),
      }),
    options.timeoutMs,
  );
}
