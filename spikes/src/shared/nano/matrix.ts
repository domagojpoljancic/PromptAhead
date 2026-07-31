import type {
  LanguageModelAvailability,
  PromptApiSurface,
  SpikeContextId,
} from "./types";

/**
 * S0.1 needs one row per realm, but each realm can only probe itself. Rows are
 * persisted so the dashboard can show the full matrix even though the options
 * page and service worker are probed at different times.
 */
export const NANO_CONTEXT_MATRIX_KEY = "spikes.nano.contextMatrix.v1";

export type CreateAttemptOutcome = "not-attempted" | "ok" | "failed";

export interface ContextProbeRecord {
  context: SpikeContextId;
  surface: PromptApiSurface;
  availability: LanguageModelAvailability | null;
  availabilityRaw: string;
  createAttempt: CreateAttemptOutcome;
  note: string | null;
  chromeVersion: string;
  checkedAt: string;
}

export type ContextMatrix = Partial<Record<SpikeContextId, ContextProbeRecord>>;

export async function getContextMatrix(): Promise<ContextMatrix> {
  const stored = await chrome.storage.local.get(NANO_CONTEXT_MATRIX_KEY);
  return (stored[NANO_CONTEXT_MATRIX_KEY] as ContextMatrix | undefined) ?? {};
}

export async function recordContextProbe(
  record: ContextProbeRecord,
): Promise<void> {
  const matrix = await getContextMatrix();
  matrix[record.context] = record;
  await chrome.storage.local.set({ [NANO_CONTEXT_MATRIX_KEY]: matrix });
}

export async function clearContextMatrix(): Promise<void> {
  await chrome.storage.local.remove(NANO_CONTEXT_MATRIX_KEY);
}

export function summarizeContextProbe(record: ContextProbeRecord): string {
  const parts = [
    `surface=${record.surface}`,
    `availability=${record.availability ?? record.availabilityRaw}`,
    `create=${record.createAttempt}`,
  ];
  if (record.note) {
    parts.push(record.note);
  }
  return parts.join(" · ");
}
