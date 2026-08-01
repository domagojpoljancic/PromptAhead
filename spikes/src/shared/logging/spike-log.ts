import type {
  SpikeId,
  SpikeLogEntry,
  SpikeLogLevel,
  SpikeResult,
  SpikeStatus,
} from "../spikes/types";
import { SPIKE_DEFINITIONS } from "../spikes/types";

export const SPIKE_RESULTS_STORAGE_KEY = "spikes.results.v1";

function emptyResult(spikeId: SpikeId): SpikeResult {
  return {
    spikeId,
    status: "idle",
    entries: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createDefaultSpikeResults(): Record<SpikeId, SpikeResult> {
  return Object.fromEntries(
    SPIKE_DEFINITIONS.map((spike) => [spike.id, emptyResult(spike.id)]),
  ) as Record<SpikeId, SpikeResult>;
}

export async function getSpikeResults(): Promise<Record<SpikeId, SpikeResult>> {
  const stored = await chrome.storage.local.get(SPIKE_RESULTS_STORAGE_KEY);
  const defaults = createDefaultSpikeResults();
  const existing = stored[SPIKE_RESULTS_STORAGE_KEY] as
    | Record<SpikeId, SpikeResult>
    | undefined;

  if (!existing) {
    return defaults;
  }

  return { ...defaults, ...existing };
}

/**
 * Every write is read-modify-write on one storage key, and a single gesture can
 * drive two spikes at once (a toolbar click feeds both S0.4 and S0.5). Without
 * this queue their log lines interleave and overwrite each other, which is the
 * one failure mode that would make a spike report quietly wrong.
 *
 * This only serializes writes within one realm; the worker and the panel can
 * still collide, so spikes keep their logging inside a single realm.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(task, task);
  writeQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function saveSpikeResult(result: SpikeResult): Promise<void> {
  const all = await getSpikeResults();
  all[result.spikeId] = result;
  await chrome.storage.local.set({ [SPIKE_RESULTS_STORAGE_KEY]: all });
}

export function setSpikeStatus(
  spikeId: SpikeId,
  status: SpikeStatus,
): Promise<SpikeResult> {
  return enqueueWrite(async () => {
    const all = await getSpikeResults();
    const current = all[spikeId] ?? emptyResult(spikeId);
    const updated: SpikeResult = {
      ...current,
      status,
      updatedAt: new Date().toISOString(),
    };
    await saveSpikeResult(updated);
    return updated;
  });
}

export function appendSpikeLog(
  spikeId: SpikeId,
  level: SpikeLogLevel,
  message: string,
): Promise<SpikeResult> {
  return enqueueWrite(async () => {
    const all = await getSpikeResults();
    const current = all[spikeId] ?? emptyResult(spikeId);
    const entry: SpikeLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };
    const updated: SpikeResult = {
      ...current,
      entries: [...current.entries, entry],
      updatedAt: entry.timestamp,
    };
    await saveSpikeResult(updated);
    return updated;
  });
}

export function clearSpikeLog(spikeId: SpikeId): Promise<SpikeResult> {
  return enqueueWrite(async () => {
    const cleared = emptyResult(spikeId);
    await saveSpikeResult(cleared);
    return cleared;
  });
}
