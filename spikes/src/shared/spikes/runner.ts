import { appendSpikeLog, setSpikeStatus } from "../logging/spike-log";
import { runManualActiveTabSpike } from "./active-tab";
import { runNotificationSpike } from "./notifications";
import { runSidePanelPathsSpike } from "./side-panel";
import type { SpikeId } from "./types";
import { isDocumentSpike } from "./types";

export type SpikeRunner = (spikeId: SpikeId) => Promise<void>;

/**
 * S0.6 needs `permissions.request()`, which Chrome only accepts under user
 * activation. The worker has none, so the panel and options page run it in
 * their own realm and this exists only to explain a misrouted call.
 */
async function refuseWorkerRun(spikeId: SpikeId, reason: string): Promise<void> {
  await setSpikeStatus(spikeId, "running");
  await appendSpikeLog(spikeId, "error", reason);
  await setSpikeStatus(spikeId, "blocked");
}

/**
 * S0.1–S0.3 are absent on purpose: the Prompt API spikes run in the realm the
 * user clicked in (side panel / options page), never in the worker. See
 * `document-runners.ts`.
 */
export const spikeRunners: Partial<Record<SpikeId, SpikeRunner>> = {
  "S0.4": (id) => runSidePanelPathsSpike(id),
  "S0.5": (id) => runManualActiveTabSpike(id),
  "S0.6": (id) =>
    refuseWorkerRun(
      id,
      "S0.6 reached the service worker, which has no user activation to spend on permissions.request(). Run it from the side panel or the options page instead.",
    ),
  "S0.7": (id) => runNotificationSpike(id),
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
