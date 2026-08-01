import type { ContextProbeRecord } from "../nano/matrix";
import type { ActiveTabSpikeState } from "../spikes/active-tab";
import type { SpikeId, SpikeResult } from "../spikes/types";

export type BackgroundRequest =
  | { type: "RUN_SPIKE"; spikeId: SpikeId }
  /** S0.1 only: make the worker probe LanguageModel in its own realm. */
  | { type: "PROBE_PROMPT_API_IN_WORKER" }
  /** S0.1 follow-up: worker-side create() + prompt(), matrix row only. */
  | { type: "PROBE_WORKER_NANO_CREATE" }
  | { type: "GET_SPIKE_RESULTS" }
  | { type: "GET_S05_STATE" }
  | { type: "CLEAR_SPIKE_LOG"; spikeId: SpikeId }
  | { type: "OPEN_SIDE_PANEL"; tabId?: number }
  /** S0.4: the panel document confirming it actually loaded. */
  | { type: "SIDE_PANEL_LOADED" }
  /** S0.7: the tester saw no notification banner (OS suppression). */
  | { type: "S07_REPORT_NOT_SHOWN" }
  | { type: "S07_CLEAR_BADGE" };

export type BackgroundResponse =
  | {
      ok: true;
      results?: Record<SpikeId, SpikeResult>;
      result?: SpikeResult;
      s05State?: ActiveTabSpikeState;
      probe?: ContextProbeRecord;
    }
  | { ok: false; error: string; result?: SpikeResult };

const REQUEST_TYPES: ReadonlySet<string> = new Set([
  "RUN_SPIKE",
  "PROBE_PROMPT_API_IN_WORKER",
  "PROBE_WORKER_NANO_CREATE",
  "GET_SPIKE_RESULTS",
  "GET_S05_STATE",
  "CLEAR_SPIKE_LOG",
  "OPEN_SIDE_PANEL",
  "SIDE_PANEL_LOADED",
  "S07_REPORT_NOT_SHOWN",
  "S07_CLEAR_BADGE",
]);

export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!value || typeof value !== "object") {
    return false;
  }

  const request = value as { type?: unknown };
  return typeof request.type === "string" && REQUEST_TYPES.has(request.type);
}
