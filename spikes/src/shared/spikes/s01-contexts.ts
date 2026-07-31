import type { ContextProbeRecord, CreateAttemptOutcome } from "../nano/matrix";
import { recordContextProbe } from "../nano/matrix";
import {
  chromeVersion,
  createSession,
  describeError,
  destroySession,
  detectPromptApi,
  EN_TEXT_EXPECTATIONS,
  formatErrorShape,
  getLanguageModel,
  hintForError,
  probeAvailability,
  promptWithTimeout,
  truncate,
  userActivationState,
} from "../nano/probe";
import type { SpikeContextId } from "../nano/types";
import { SPIKE_CONTEXT_LABELS } from "../nano/types";
import { createSpikeLogger } from "./logger";
import type { SpikeLogger } from "./logger";

const SMOKE_PROMPT = "Reply with exactly one word: ready";
const SMOKE_TIMEOUT_MS = 10_000;
const CREATE_TIMEOUT_MS = 30_000;

export interface ContextProbeOptions {
  /**
   * Only ever attempted when availability is already `available`, so S0.1 never
   * kicks off a multi-GB download as a side effect.
   */
  attemptCreateWhenAvailable?: boolean;
  logger?: SpikeLogger;
}

/**
 * S0.1 — probe the Prompt API in whichever realm this function is called from.
 * Each realm must call it itself; nothing here can be delegated cross-context.
 */
export async function probePromptApiContext(
  context: SpikeContextId,
  options: ContextProbeOptions = {},
): Promise<ContextProbeRecord> {
  const log = options.logger ?? createSpikeLogger("S0.1", context);
  const version = chromeVersion();

  await log("info", `Probe started — Chrome ${version}`);

  const detection = detectPromptApi();
  await log(
    "info",
    `Detection: surface=${detection.surface}, availability()=${detection.hasAvailability}, create()=${detection.hasCreate}, params()=${detection.hasParams}`,
  );
  await log(
    "info",
    `Built-in AI globals present: ${detection.aiGlobals.join(", ") || "none"}`,
  );

  const model = getLanguageModel();

  if (!model || detection.surface === "none") {
    await log(
      "error",
      `LanguageModel is not exposed in the ${SPIKE_CONTEXT_LABELS[context]} realm. Curated mode stays unblocked; Nano cannot host here.`,
    );
    return finish({
      context,
      surface: detection.surface,
      availability: null,
      availabilityRaw: "n/a",
      createAttempt: "not-attempted",
      note: "LanguageModel global missing",
      chromeVersion: version,
      checkedAt: new Date().toISOString(),
    });
  }

  if (!detection.hasAvailability) {
    await log(
      "error",
      "LanguageModel exists but availability() is missing — API shape changed.",
    );
    return finish({
      context,
      surface: detection.surface,
      availability: null,
      availabilityRaw: "n/a",
      createAttempt: "not-attempted",
      note: "availability() missing on LanguageModel",
      chromeVersion: version,
      checkedAt: new Date().toISOString(),
    });
  }

  const withExpectations = await probeAvailability(model, EN_TEXT_EXPECTATIONS);
  if (withExpectations.error) {
    await log(
      "error",
      `availability({expectedInputs/Outputs: en text}) threw after ${withExpectations.durationMs}ms — ${formatErrorShape(withExpectations.error)}`,
    );
    const hint = hintForError(withExpectations.error);
    if (hint) {
      await log("warn", hint);
    }
  } else {
    await log(
      "success",
      `availability({expectedInputs/Outputs: en text}) = ${withExpectations.rawValue} (${withExpectations.durationMs}ms)`,
    );
  }

  // Comparing against the no-argument call catches the case where declaring
  // expectations flips the answer (a real M2 trap: availability without the same
  // options can disagree with create()).
  const bare = await probeAvailability(model, undefined);
  if (bare.error) {
    await log(
      "warn",
      `availability() with no options threw — ${formatErrorShape(bare.error)}`,
    );
  } else if (bare.rawValue !== withExpectations.rawValue) {
    await log(
      "warn",
      `availability() disagrees with the en-expectations call: no-options=${bare.rawValue} vs en=${withExpectations.rawValue}. Always pass identical options to availability() and create().`,
    );
  } else {
    await log("info", `availability() with no options = ${bare.rawValue} (matches)`);
  }

  let createAttempt: CreateAttemptOutcome = "not-attempted";
  let note: string | null = null;
  const availability = withExpectations.availability;

  const shouldAttemptCreate =
    options.attemptCreateWhenAvailable === true && availability === "available";

  if (options.attemptCreateWhenAvailable && !shouldAttemptCreate) {
    await log(
      "info",
      `Skipping create() smoke test: availability=${withExpectations.rawValue} (only attempted when already "available" so S0.1 never triggers a download).`,
    );
  }

  if (shouldAttemptCreate) {
    await log("info", `Attempting create() smoke test — ${userActivationState()}`);
    const created = await createSession({ model, timeoutMs: CREATE_TIMEOUT_MS });

    if (!created.session) {
      createAttempt = "failed";
      const reason = created.error
        ? formatErrorShape(created.error)
        : "unknown failure";
      note = `create() failed: ${reason}`;
      await log(
        "error",
        `create() failed after ${created.durationMs}ms${created.timedOut ? " (spike timeout)" : ""} — ${reason}`,
      );
      if (created.error) {
        const hint = hintForError(created.error);
        if (hint) {
          await log("warn", hint);
        }
      }
    } else {
      await log("success", `create() resolved in ${created.durationMs}ms`);
      try {
        const smoke = await promptWithTimeout(created.session, SMOKE_PROMPT, {
          timeoutMs: SMOKE_TIMEOUT_MS,
        });
        if (smoke.text === null) {
          createAttempt = "failed";
          const reason = smoke.error
            ? formatErrorShape(smoke.error)
            : "unknown failure";
          note = `prompt() failed: ${reason}`;
          await log(
            "error",
            `prompt() failed after ${smoke.durationMs}ms${smoke.timedOut ? " (10s spike timeout)" : ""} — ${reason}`,
          );
        } else {
          createAttempt = "ok";
          note = "create() + prompt() both worked in this realm";
          await log(
            "success",
            `prompt() replied in ${smoke.durationMs}ms: "${truncate(smoke.text, 80)}"`,
          );
        }
      } catch (error) {
        createAttempt = "failed";
        note = `prompt() threw synchronously: ${formatErrorShape(describeError(error))}`;
        await log("error", note);
      } finally {
        destroySession(created.session);
        await log("info", "Session destroyed.");
      }
    }
  }

  return finish({
    context,
    surface: detection.surface,
    availability,
    availabilityRaw: withExpectations.rawValue,
    createAttempt,
    note,
    chromeVersion: version,
    checkedAt: new Date().toISOString(),
  });
}

async function finish(record: ContextProbeRecord): Promise<ContextProbeRecord> {
  await recordContextProbe(record);
  return record;
}
