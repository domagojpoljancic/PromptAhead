import { appendSpikeLog, setSpikeStatus } from "../logging/spike-log";
import { runManualActiveTabSpike } from "./active-tab";
import type { SpikeId } from "./types";
import { isDocumentSpike } from "./types";

export type SpikeRunner = (spikeId: SpikeId) => Promise<void>;

async function runStub(spikeId: SpikeId, note: string): Promise<void> {
  await setSpikeStatus(spikeId, "running");
  await appendSpikeLog(spikeId, "info", note);
  await appendSpikeLog(
    spikeId,
    "warn",
    "Spike logic not implemented yet — harness stub only.",
  );
  await setSpikeStatus(spikeId, "idle");
}

/**
 * S0.1–S0.3 are absent on purpose: the Prompt API spikes run in the realm the
 * user clicked in (side panel / options page), never in the worker. See
 * `document-runners.ts`.
 */
export const spikeRunners: Partial<Record<SpikeId, SpikeRunner>> = {
  "S0.4": (id) =>
    runStub(
      id,
      "Will test side panel open from toolbar, notification, and context menu.",
    ),
  "S0.5": (id) => runManualActiveTabSpike(id),
  "S0.6": (id) =>
    runStub(id, "Will test optional host permissions.request / remove / contains."),
  "S0.7": (id) => runStub(id, "Will test badge + notification opening the side panel."),
};

export async function runSpike(spikeId: SpikeId): Promise<void> {
  if (isDocumentSpike(spikeId)) {
    throw new Error(
      `${spikeId} is a Prompt API spike and must be run from the side panel or options page, not the service worker.`,
    );
  }

  const runner = spikeRunners[spikeId];
  if (!runner) {
    throw new Error(`Unknown spike: ${spikeId}`);
  }
  await runner(spikeId);
}
