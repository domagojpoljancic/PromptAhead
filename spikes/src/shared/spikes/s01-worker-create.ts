import type { ContextProbeRecord } from "../nano/matrix";
import { getContextMatrix, recordContextProbe } from "../nano/matrix";
import {
  chromeVersion,
  createSession,
  destroySession,
  detectPromptApi,
  formatErrorShape,
  getLanguageModel,
  hintForError,
  probeAvailability,
  promptWithTimeout,
  truncate,
  userActivationState,
} from "../nano/probe";
import { createSpikeLogger } from "./logger";

/**
 * S0.1 follow-up — service-worker `create()`.
 *
 * The S0.1 matrix proved `LanguageModel` exists in the worker but left
 * `create()` untested, because the model was still downloading and the harness
 * refuses to start a multi-GB download from a realm with no user activation to
 * spend on it. That guard stays: this probe only creates a session when
 * `availability()` already reports `available`.
 *
 * It updates the `service-worker` row of the S0.1 matrix in place and never
 * changes the S0.1 status. A realm that cannot host Nano is a result, not a
 * broken spike — the side panel remains the product's Nano host either way.
 */

const CREATE_TIMEOUT_MS = 60_000;
const SMOKE_TIMEOUT_MS = 20_000;
const SMOKE_PROMPT = "Reply with exactly one word: ready";

export async function probeWorkerSessionCreation(): Promise<ContextProbeRecord | null> {
  const log = createSpikeLogger("S0.1", "service-worker");
  const version = chromeVersion();

  await log(
    "info",
    `Follow-up probe: attempting create() + prompt() in the service worker (Chrome ${version}). ${userActivationState()}`,
  );

  const detection = detectPromptApi();
  const model = getLanguageModel();

  if (!model || detection.surface === "none") {
    await log(
      "error",
      "LanguageModel is not exposed in the service worker, so there is nothing to create here. The matrix row already says so.",
    );
    return null;
  }

  const availabilityProbe = await probeAvailability(model);
  if (availabilityProbe.error) {
    await log(
      "error",
      `availability() threw in the worker — ${formatErrorShape(availabilityProbe.error)}`,
    );
    return null;
  }

  await log(
    "info",
    `availability() = ${availabilityProbe.rawValue} (${availabilityProbe.durationMs} ms)`,
  );

  if (availabilityProbe.availability !== "available") {
    await log(
      "warn",
      `Skipped: create() is only attempted from the worker when the model is already resident, and availability() says "${availabilityProbe.rawValue}". A worker has no user activation to authorise a download. Run S0.2 from the side panel until the model reports "available", then try this again.`,
    );
    return null;
  }

  const previous = (await getContextMatrix())["service-worker"];
  let createAttempt: ContextProbeRecord["createAttempt"] = "not-attempted";
  let note: string | null = null;

  const created = await createSession({ model, timeoutMs: CREATE_TIMEOUT_MS });

  if (!created.session) {
    const reason = created.error ? formatErrorShape(created.error) : "unknown failure";
    createAttempt = "failed";
    note = `Worker create() failed: ${reason}`;
    await log(
      "error",
      `create() failed in the worker after ${created.durationMs} ms${created.timedOut ? " (spike timeout)" : ""} — ${reason}`,
    );
    if (created.error) {
      const hint = hintForError(created.error);
      if (hint) {
        await log("warn", hint);
      }
    }
    await log(
      "info",
      "This closes the S0.1 gap in the negative: the worker exposes the API but cannot host a session. The side panel stays the only proven Nano host, which is what the product already assumes.",
    );
  } else {
    await log(
      "success",
      `create() resolved in the worker in ${created.durationMs} ms.`,
    );
    try {
      const smoke = await promptWithTimeout(created.session, SMOKE_PROMPT, {
        timeoutMs: SMOKE_TIMEOUT_MS,
      });
      if (smoke.text === null) {
        const reason = smoke.error ? formatErrorShape(smoke.error) : "unknown failure";
        createAttempt = "failed";
        note = `Worker create() ok but prompt() failed: ${reason}`;
        await log(
          "error",
          `prompt() failed in the worker after ${smoke.durationMs} ms${smoke.timedOut ? " (spike timeout)" : ""} — ${reason}`,
        );
      } else {
        createAttempt = "ok";
        note = "Worker create() + prompt() both worked";
        await log(
          "success",
          `prompt() replied in ${smoke.durationMs} ms: "${truncate(smoke.text, 80)}"`,
        );
        await log(
          "info",
          "The worker can host a session, so it is a viable fallback. Keep Nano in the side panel anyway: the worker can be killed mid-inference at any time.",
        );
      }
    } finally {
      destroySession(created.session);
      await log("info", "Worker session destroyed.");
    }
  }

  const record: ContextProbeRecord = {
    context: "service-worker",
    surface: detection.surface,
    availability: availabilityProbe.availability,
    availabilityRaw: availabilityProbe.rawValue,
    createAttempt,
    note: note ?? previous?.note ?? null,
    chromeVersion: version,
    checkedAt: new Date().toISOString(),
  };
  await recordContextProbe(record);
  await log(
    "info",
    "S0.1 matrix row for the service worker updated. The S0.1 status is left as it was — this probe answers one cell, not the whole spike.",
  );

  return record;
}
