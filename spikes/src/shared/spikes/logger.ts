import { appendSpikeLog } from "../logging/spike-log";
import type { SpikeContextId } from "../nano/types";
import { SPIKE_CONTEXT_LABELS } from "../nano/types";
import type { SpikeId, SpikeLogLevel } from "./types";

export type SpikeLogger = (level: SpikeLogLevel, message: string) => Promise<void>;

/** Prefixes every line with the realm, so aggregated logs stay readable. */
export function createSpikeLogger(
  spikeId: SpikeId,
  context: SpikeContextId,
): SpikeLogger {
  const label = SPIKE_CONTEXT_LABELS[context];
  return async (level, message) => {
    await appendSpikeLog(spikeId, level, `[${label}] ${message}`);
  };
}
