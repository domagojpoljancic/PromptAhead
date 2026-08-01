import type {
  ErrorShape,
  LanguageModelAvailability,
  LanguageModelCreateOptions,
  LanguageModelLike,
  LanguageModelParamsLike,
  LanguageModelPromptOptions,
  LanguageModelSessionLike,
  PromptApiDetection,
  PromptApiSurface,
} from "./types";
import { AVAILABILITY_VALUES } from "./types";

/**
 * Same expectations must be passed to `availability()` and `create()`, otherwise
 * Chrome can report `available` and then fail to create a session.
 */
export const EN_TEXT_EXPECTATIONS: LanguageModelCreateOptions = {
  expectedInputs: [{ type: "text", languages: ["en"] }],
  expectedOutputs: [{ type: "text", languages: ["en"] }],
};

const KNOWN_AI_GLOBALS = [
  "LanguageModel",
  "Summarizer",
  "Writer",
  "Rewriter",
  "Translator",
  "LanguageDetector",
  "Proofreader",
  "ai",
];

interface AiScope {
  LanguageModel?: LanguageModelLike;
  ai?: { languageModel?: LanguageModelLike };
}

function aiScope(): AiScope {
  return globalThis as unknown as AiScope;
}

export function getLanguageModel(): LanguageModelLike | undefined {
  const scope = aiScope();
  return scope.LanguageModel ?? scope.ai?.languageModel;
}

export function detectPromptApi(): PromptApiDetection {
  const scope = aiScope();
  const model = getLanguageModel();

  let surface: PromptApiSurface = "none";
  if (scope.LanguageModel) {
    surface = "LanguageModel";
  } else if (scope.ai?.languageModel) {
    surface = "ai.languageModel";
  }

  const globalRecord = globalThis as unknown as Record<string, unknown>;

  return {
    surface,
    hasAvailability: typeof model?.availability === "function",
    hasCreate: typeof model?.create === "function",
    hasParams: typeof model?.params === "function",
    aiGlobals: KNOWN_AI_GLOBALS.filter((name) => name in globalRecord),
  };
}

export function describeError(error: unknown): ErrorShape {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      constructorName: error.constructor?.name ?? "Error",
      code: error instanceof DOMException ? error.code : undefined,
      raw: String(error),
    };
  }

  return {
    name: typeof error,
    message: String(error),
    constructorName: typeof error,
    raw: String(error),
  };
}

export function formatErrorShape(shape: ErrorShape): string {
  const parts = [`${shape.name} (${shape.constructorName})`];
  if (typeof shape.code === "number" && shape.code !== 0) {
    parts.push(`code=${shape.code}`);
  }
  parts.push(shape.message || "(no message)");
  return parts.join(" · ");
}

/**
 * Known failure modes worth translating into an action for whoever reads the log.
 */
export function hintForError(shape: ErrorShape): string | null {
  const haystack = `${shape.name} ${shape.message}`.toLowerCase();

  if (haystack.includes("notallowed") || haystack.includes("user activation")) {
    return "Chrome wanted a fresh user gesture. Click Run again and do not wait; transient activation expires within a few seconds.";
  }
  if (haystack.includes("notsupported")) {
    return "This Chrome build/realm does not support the requested configuration. Check the Prompt API flag and chrome://on-device-internals.";
  }
  if (haystack.includes("quota") || haystack.includes("too large")) {
    return "Input exceeded the session quota — shrink the excerpt (product caps Nano input at ~4–6k chars).";
  }
  if (haystack.includes("responseconstraint") || haystack.includes("constraint")) {
    return "responseConstraint may be unsupported on this Chrome (needs 137+). Compare against the unconstrained fallback pass.";
  }
  if (haystack.includes("aborted") || haystack.includes("abort")) {
    return "Call was aborted — usually the spike timeout, or the panel/document was closed mid-flight.";
  }
  return null;
}

export function chromeVersion(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const match = /Chrome\/([\d.]+)/.exec(ua);
  return match?.[1] ?? "unknown";
}

/**
 * Transient user activation is what `create()` needs when a download is
 * required. Reported so logs show whether it had already expired.
 */
export function userActivationState(): string {
  const nav = navigator as Navigator & {
    userActivation?: { isActive: boolean; hasBeenActive: boolean };
  };
  if (!nav?.userActivation) {
    return "userActivation API unavailable in this realm";
  }
  return `isActive=${nav.userActivation.isActive}, hasBeenActive=${nav.userActivation.hasBeenActive}`;
}

export function isKnownAvailability(
  value: unknown,
): value is LanguageModelAvailability {
  return AVAILABILITY_VALUES.includes(value as LanguageModelAvailability);
}

export interface AvailabilityProbe {
  availability: LanguageModelAvailability | null;
  /** Raw value, so an unexpected new enum member still shows up in the log. */
  rawValue: string;
  error: ErrorShape | null;
  durationMs: number;
}

export async function probeAvailability(
  model: LanguageModelLike,
  options: LanguageModelCreateOptions | undefined = EN_TEXT_EXPECTATIONS,
): Promise<AvailabilityProbe> {
  const startedAt = performance.now();
  try {
    const value = await model.availability(options);
    return {
      availability: isKnownAvailability(value) ? value : null,
      rawValue: String(value),
      error: null,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      availability: null,
      rawValue: "(threw)",
      error: describeError(error),
      durationMs: Math.round(performance.now() - startedAt),
    };
  }
}

export async function probeParams(
  model: LanguageModelLike,
): Promise<{ params: LanguageModelParamsLike | null; error: ErrorShape | null }> {
  if (typeof model.params !== "function") {
    return { params: null, error: null };
  }
  try {
    return { params: (await model.params()) ?? null, error: null };
  } catch (error) {
    return { params: null, error: describeError(error) };
  }
}

export interface CreateSessionResult {
  session: LanguageModelSessionLike | null;
  error: ErrorShape | null;
  durationMs: number;
  progressEvents: number;
  lastProgressFraction: number | null;
  timedOut: boolean;
}

export interface CreateSessionOptions {
  model: LanguageModelLike;
  timeoutMs: number;
  extra?: LanguageModelCreateOptions;
  onProgress?: (fraction: number, raw: { loaded: number; total?: number }) => void;
}

/**
 * `create()` with a `downloadprogress` monitor and a hard timeout. Downloads can
 * outlive the timeout, so callers pass a generous value when the model is not
 * resident yet.
 */
export async function createSession({
  model,
  timeoutMs,
  extra,
  onProgress,
}: CreateSessionOptions): Promise<CreateSessionResult> {
  const controller = new AbortController();
  const startedAt = performance.now();
  let progressEvents = 0;
  let lastProgressFraction: number | null = null;
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Spike timeout", "TimeoutError"));
  }, timeoutMs);

  try {
    const session = await model.create({
      ...EN_TEXT_EXPECTATIONS,
      ...extra,
      signal: controller.signal,
      monitor(monitor) {
        monitor.addEventListener("downloadprogress", (event) => {
          progressEvents += 1;
          lastProgressFraction = event.loaded;
          onProgress?.(event.loaded, { loaded: event.loaded, total: event.total });
        });
      },
    });

    return {
      session,
      error: null,
      durationMs: Math.round(performance.now() - startedAt),
      progressEvents,
      lastProgressFraction,
      timedOut: false,
    };
  } catch (error) {
    return {
      session: null,
      error: describeError(error),
      durationMs: Math.round(performance.now() - startedAt),
      progressEvents,
      lastProgressFraction,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PromptResult {
  text: string | null;
  error: ErrorShape | null;
  durationMs: number;
  timedOut: boolean;
}

export async function promptWithTimeout(
  session: LanguageModelSessionLike,
  input: string,
  options: LanguageModelPromptOptions & { timeoutMs: number },
): Promise<PromptResult> {
  const { timeoutMs, ...promptOptions } = options;
  const controller = new AbortController();
  const startedAt = performance.now();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Spike timeout", "TimeoutError"));
  }, timeoutMs);

  try {
    const text = await session.prompt(input, {
      ...promptOptions,
      signal: controller.signal,
    });
    return {
      text,
      error: null,
      durationMs: Math.round(performance.now() - startedAt),
      timedOut: false,
    };
  } catch (error) {
    return {
      text: null,
      error: describeError(error),
      durationMs: Math.round(performance.now() - startedAt),
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function destroySession(session: LanguageModelSessionLike | null): void {
  if (!session || typeof session.destroy !== "function") {
    return;
  }
  try {
    session.destroy();
  } catch {
    // Destroying an already-destroyed session must never fail a spike.
  }
}

export function describeSessionUsage(session: LanguageModelSessionLike): string | null {
  if (
    typeof session.inputUsage !== "number" ||
    typeof session.inputQuota !== "number"
  ) {
    return null;
  }
  return `inputUsage=${session.inputUsage} / inputQuota=${session.inputQuota}`;
}

export function truncate(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}
