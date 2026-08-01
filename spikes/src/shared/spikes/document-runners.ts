import { setSpikeStatus } from "../logging/spike-log";
import type { ContextProbeRecord } from "../nano/matrix";
import { getContextMatrix, summarizeContextProbe } from "../nano/matrix";
import { chromeVersion } from "../nano/probe";
import type { SpikeContextId } from "../nano/types";
import { SPIKE_CONTEXT_LABELS } from "../nano/types";
import { createSpikeLogger } from "./logger";
import { runOptionalHostsSpike } from "./permissions";
import { probePromptApiContext } from "./s01-contexts";
import { runAvailabilityDownloadSpike } from "./s02-availability";
import { runStructuredJsonSpike } from "./s03-structured";
import type { DocumentSpikeId, SpikeId } from "./types";
import { isDocumentSpike } from "./types";

export type DocumentContextId = Extract<SpikeContextId, "sidepanel" | "options">;

/**
 * S0.6 joins the Prompt API spikes in having to run inside a document, but for
 * a different reason: `permissions.request()` needs the user activation from
 * the click. It is kept out of `DocumentSpikeId` so that type keeps meaning
 * "Prompt API realm probe".
 */
export type DocumentRunnableSpikeId = DocumentSpikeId | Extract<SpikeId, "S0.6">;

const EXTRA_DOCUMENT_SPIKE_IDS: readonly DocumentRunnableSpikeId[] = ["S0.6"];

export function runsInDocument(spikeId: SpikeId): spikeId is DocumentRunnableSpikeId {
  return (
    isDocumentSpike(spikeId) ||
    (EXTRA_DOCUMENT_SPIKE_IDS as readonly string[]).includes(spikeId)
  );
}

export interface DocumentSpikeOptions {
  /** S0.1 only: also ask the service worker to probe its own realm. */
  probeServiceWorker?: (() => Promise<ContextProbeRecord | null>) | undefined;
}

export async function runDocumentSpike(
  spikeId: DocumentRunnableSpikeId,
  context: DocumentContextId,
  options: DocumentSpikeOptions = {},
): Promise<void> {
  switch (spikeId) {
    case "S0.1":
      await runContextMatrixSpike(context, options.probeServiceWorker);
      return;
    case "S0.2":
      await runAvailabilityDownloadSpike(context);
      return;
    case "S0.3":
      await runStructuredJsonSpike(context);
      return;
    case "S0.6":
      await runOptionalHostsSpike(context);
      return;
  }
}

/**
 * S0.1 — probe this realm, optionally ask the worker to probe itself, then log
 * the aggregate matrix. The remaining realm has to be run by hand from its own
 * surface, which the log spells out.
 */
export async function runContextMatrixSpike(
  context: DocumentContextId,
  probeServiceWorker?: (() => Promise<ContextProbeRecord | null>) | undefined,
): Promise<void> {
  const log = createSpikeLogger("S0.1", context);
  await setSpikeStatus("S0.1", "running");

  const local = await probePromptApiContext(context, { logger: log });
  await log(
    "info",
    "create() is intentionally not attempted here — S0.2 covers session creation for this realm.",
  );

  let worker: ContextProbeRecord | null = null;
  if (probeServiceWorker) {
    await log("info", "Asking the service worker to probe its own realm…");
    try {
      worker = await probeServiceWorker();
      if (worker) {
        await log(
          "success",
          `Service worker replied: ${summarizeContextProbe(worker)}`,
        );
      } else {
        await log("error", "Service worker returned no probe result.");
      }
    } catch (error) {
      await log(
        "error",
        `Service worker probe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const matrix = await getContextMatrix();
  const contexts: SpikeContextId[] = ["sidepanel", "options", "service-worker"];
  const missing: SpikeContextId[] = [];

  for (const id of contexts) {
    const record = matrix[id];
    if (!record) {
      missing.push(id);
      await log("warn", `${SPIKE_CONTEXT_LABELS[id]}: not probed yet`);
      continue;
    }
    await log(
      "info",
      `${SPIKE_CONTEXT_LABELS[id]}: ${summarizeContextProbe(record)} (Chrome ${record.chromeVersion}, ${new Date(record.checkedAt).toLocaleTimeString()})`,
    );
  }

  if (missing.includes("options")) {
    await log(
      "warn",
      "Options page still unprobed — open the options page and click “Run S0.1 probe here”. A document can only probe its own realm.",
    );
  }

  const anySurface = contexts.some(
    (id) => matrix[id] && matrix[id]?.surface !== "none",
  );

  await log(
    "info",
    `Record this matrix in docs/technical-spikes.md (S0.1) together with Chrome ${chromeVersion()}. The Nano host decision belongs in that doc, not in the harness.`,
  );

  if (!anySurface) {
    await log(
      "error",
      "No probed realm exposes LanguageModel — Nano cannot be hosted on this build. Curated mode remains the product path.",
    );
    await setSpikeStatus("S0.1", "blocked");
    return;
  }

  // "fail" means this realm cannot host Nano even though another one can — the
  // matrix itself was still gathered successfully.
  await setSpikeStatus("S0.1", local.surface === "none" ? "fail" : "pass");
}
