import { setSpikeStatus } from "../logging/spike-log";
import { recordContextProbe } from "../nano/matrix";
import {
  chromeVersion,
  createSession,
  describeSessionUsage,
  destroySession,
  detectPromptApi,
  formatErrorShape,
  getLanguageModel,
  hintForError,
  probeAvailability,
  probeParams,
  promptWithTimeout,
  truncate,
  userActivationState,
} from "../nano/probe";
import type { SpikeContextId } from "../nano/types";
import { SPIKE_CONTEXT_LABELS } from "../nano/types";
import { createSpikeLogger } from "./logger";

const RESIDENT_CREATE_TIMEOUT_MS = 60_000;
/** Downloads are multi-GB; keep the ceiling high but bounded so the spike ends. */
const DOWNLOAD_CREATE_TIMEOUT_MS = 20 * 60_000;
const SMOKE_TIMEOUT_MS = 10_000;
const SMOKE_PROMPT =
  "Reply with exactly this text and nothing else: PromptAhead session OK";

/**
 * S0.2 — availability(), user-activated create(), and downloadprogress.
 *
 * Must be invoked directly from a click handler: when the model still needs
 * downloading, Chrome requires transient user activation for create().
 */
export async function runAvailabilityDownloadSpike(
  context: SpikeContextId,
): Promise<void> {
  const log = createSpikeLogger("S0.2", context);
  await setSpikeStatus("S0.2", "running");

  const version = chromeVersion();
  await log("info", `S0.2 started in ${SPIKE_CONTEXT_LABELS[context]} — Chrome ${version}`);
  await log("info", `User activation at click time: ${userActivationState()}`);

  const detection = detectPromptApi();
  const model = getLanguageModel();

  if (!model || detection.surface === "none") {
    await log(
      "error",
      "LanguageModel is not available in this realm — S0.2 cannot run here. Run it from a realm where S0.1 reported a surface.",
    );
    await log(
      "warn",
      "Skippable failure path: product keeps curated suggestions; Nano stays opt-in and hidden when unsupported.",
    );
    await setSpikeStatus("S0.2", "blocked");
    return;
  }

  const availabilityProbe = await probeAvailability(model);
  if (availabilityProbe.error) {
    await log(
      "error",
      `availability() threw — ${formatErrorShape(availabilityProbe.error)}`,
    );
    await setSpikeStatus("S0.2", "fail");
    return;
  }

  await log(
    "success",
    `availability() = ${availabilityProbe.rawValue} (${availabilityProbe.durationMs}ms)`,
  );

  const { params, error: paramsError } = await probeParams(model);
  if (paramsError) {
    await log("warn", `params() threw — ${formatErrorShape(paramsError)}`);
  } else if (params) {
    await log(
      "info",
      `params(): defaultTopK=${params.defaultTopK}, maxTopK=${params.maxTopK}, defaultTemperature=${params.defaultTemperature}, maxTemperature=${params.maxTemperature}`,
    );
  } else {
    await log("info", "params() not exposed on this build.");
  }

  const availability = availabilityProbe.availability;

  if (availability === "unavailable") {
    await log(
      "error",
      'availability() = "unavailable" — this device/build cannot run Gemini Nano (hardware, disk space, enterprise policy, or missing flag).',
    );
    await log(
      "warn",
      "Skippable failure path confirmed: onboarding must show an 'unsupported' state, never block, and Manual + curated must stay fully usable.",
    );
    await log(
      "info",
      "Diagnose with chrome://on-device-internals (model status) and chrome://flags/#prompt-api-for-gemini-nano.",
    );
    await recordContextProbe({
      context,
      surface: detection.surface,
      availability,
      availabilityRaw: availabilityProbe.rawValue,
      createAttempt: "not-attempted",
      note: "S0.2: unavailable on this device",
      chromeVersion: version,
      checkedAt: new Date().toISOString(),
    });
    await setSpikeStatus("S0.2", "blocked");
    return;
  }

  const expectsDownload =
    availability === "downloadable" || availability === "downloading";

  if (availability === "downloadable") {
    await log(
      "info",
      "Model is downloadable — create() should start the download and needs the click that started this run. Keep this surface open until it finishes.",
    );
  } else if (availability === "downloading") {
    await log(
      "info",
      "A download is already in flight — create() should attach to it and resolve when it completes.",
    );
  } else {
    await log("info", "Model is resident — create() should resolve without any download.");
  }

  const logProgress = createProgressLogger(log);
  const timeoutMs = expectsDownload
    ? DOWNLOAD_CREATE_TIMEOUT_MS
    : RESIDENT_CREATE_TIMEOUT_MS;

  await log(
    "info",
    `Calling create() with a downloadprogress monitor (timeout ${Math.round(timeoutMs / 1000)}s) — ${userActivationState()}`,
  );

  const created = await createSession({
    model,
    timeoutMs,
    onProgress: (fraction, raw) => {
      void logProgress(fraction, raw);
    },
  });

  if (!created.session) {
    const reason = created.error ? formatErrorShape(created.error) : "unknown failure";
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
    await log(
      "warn",
      `downloadprogress events seen before the failure: ${created.progressEvents}`,
    );
    await log(
      "warn",
      "Skippable failure path: surface a retry plus a clear 'local AI unavailable' state; never block the curated flow.",
    );
    await recordContextProbe({
      context,
      surface: detection.surface,
      availability,
      availabilityRaw: availabilityProbe.rawValue,
      createAttempt: "failed",
      note: `S0.2 create() failed: ${reason}`,
      chromeVersion: version,
      checkedAt: new Date().toISOString(),
    });
    await setSpikeStatus("S0.2", "fail");
    return;
  }

  await log("success", `create() resolved in ${created.durationMs}ms`);
  await log(
    created.progressEvents > 0 ? "success" : "info",
    `downloadprogress events: ${created.progressEvents}${
      created.lastProgressFraction !== null
        ? `, last loaded=${created.lastProgressFraction}`
        : ""
    }${
      created.progressEvents === 0 && !expectsDownload
        ? " (expected — no events fire when the model is already resident)"
        : ""
    }`,
  );

  if (expectsDownload && created.progressEvents === 0) {
    await log(
      "warn",
      "Download was expected but no downloadprogress event fired — a determinate progress bar cannot be promised in onboarding. Plan an indeterminate state as fallback.",
    );
  }

  let status: "pass" | "fail" = "pass";
  let note = "S0.2: create() succeeded";

  try {
    const usage = describeSessionUsage(created.session);
    if (usage) {
      await log("info", `Session quota before prompting: ${usage}`);
    }

    const smoke = await promptWithTimeout(created.session, SMOKE_PROMPT, {
      timeoutMs: SMOKE_TIMEOUT_MS,
    });

    if (smoke.text === null) {
      status = "fail";
      const reason = smoke.error ? formatErrorShape(smoke.error) : "unknown failure";
      note = `S0.2: session created but prompt() failed: ${reason}`;
      await log(
        "error",
        `Warm-up prompt() failed after ${smoke.durationMs}ms${smoke.timedOut ? " (10s spike timeout)" : ""} — ${reason}`,
      );
    } else {
      await log(
        "success",
        `Warm-up prompt() replied in ${smoke.durationMs}ms: "${truncate(smoke.text, 120)}"`,
      );
      const usageAfter = describeSessionUsage(created.session);
      if (usageAfter) {
        await log("info", `Session quota after prompting: ${usageAfter}`);
      }
    }
  } finally {
    destroySession(created.session);
    await log("info", "Session destroyed.");
  }

  await recordContextProbe({
    context,
    surface: detection.surface,
    availability,
    availabilityRaw: availabilityProbe.rawValue,
    createAttempt: status === "pass" ? "ok" : "failed",
    note,
    chromeVersion: version,
    checkedAt: new Date().toISOString(),
  });

  await log(
    "info",
    "Record availability value, create() duration, downloadprogress behaviour, and Chrome version in docs/technical-spikes.md.",
  );
  await setSpikeStatus("S0.2", status);
}

/**
 * Every log line is a storage write, so progress is reported on ~10% steps plus
 * the first and last event rather than on every tick.
 */
function createProgressLogger(
  log: ReturnType<typeof createSpikeLogger>,
): (fraction: number, raw: { loaded: number; total?: number }) => Promise<void> {
  let lastLoggedStep = -1;
  let loggedTerminal = false;

  return async (fraction, raw) => {
    const clamped = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    const percent = clamped * 100;
    const step = Math.floor(percent / 10);
    const isTerminal = clamped >= 1;

    if (isTerminal && loggedTerminal) {
      return;
    }
    if (step === lastLoggedStep && !isTerminal) {
      return;
    }
    lastLoggedStep = step;
    loggedTerminal = loggedTerminal || isTerminal;

    const total = raw.total === undefined ? "" : `, total=${raw.total}`;
    await log(
      isTerminal ? "success" : "info",
      `downloadprogress ${percent.toFixed(1)}% (loaded=${raw.loaded}${total})`,
    );
  };
}
