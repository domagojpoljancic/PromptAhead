import {
  getSpikeResults,
  SPIKE_RESULTS_STORAGE_KEY,
} from "../shared/logging/spike-log";
import {
  getContextMatrix,
  NANO_CONTEXT_MATRIX_KEY,
  summarizeContextProbe,
} from "../shared/nano/matrix";
import type { SpikeContextId } from "../shared/nano/types";
import { SPIKE_CONTEXT_LABELS } from "../shared/nano/types";
import type { DocumentRunnableSpikeId } from "../shared/spikes/document-runners";
import { runDocumentSpike } from "../shared/spikes/document-runners";
import {
  hasBroadHostAccess,
  PERMISSIONS_STATE_STORAGE_KEY,
  revokeBroadHostAccess,
} from "../shared/spikes/permissions";
import type { SpikeId } from "../shared/spikes/types";

const LOGGED_SPIKE_IDS: SpikeId[] = ["S0.1", "S0.2", "S0.3", "S0.6"];

const MATRIX_CONTEXTS: SpikeContextId[] = [
  "sidepanel",
  "options",
  "service-worker",
];

const BUTTON_IDS: Record<DocumentRunnableSpikeId, string> = {
  "S0.1": "probe-context",
  "S0.2": "run-s02",
  "S0.3": "run-s03",
  "S0.6": "run-s06",
};

const RUNNABLE_SPIKE_IDS = Object.keys(BUTTON_IDS) as DocumentRunnableSpikeId[];

function setText(elementId: string, text: string): void {
  const node = document.getElementById(elementId);
  if (node) {
    node.textContent = text;
  }
}

function runButtons(): HTMLButtonElement[] {
  return Object.values(BUTTON_IDS)
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLButtonElement => node instanceof HTMLButtonElement);
}

async function renderMatrix(): Promise<void> {
  const matrix = await getContextMatrix();
  const lines = MATRIX_CONTEXTS.map((context) => {
    const record = matrix[context];
    const label = SPIKE_CONTEXT_LABELS[context];
    if (!record) {
      return `${label}: not probed yet`;
    }
    return `${label}: ${summarizeContextProbe(record)} (Chrome ${record.chromeVersion}, ${new Date(record.checkedAt).toLocaleString()})`;
  });
  setText("context-matrix", lines.join("\n"));
}

/**
 * A lingering `<all_urls>` grant silently invalidates S0.5, so the state is on
 * screen at all times rather than only inside the S0.6 log.
 */
async function renderPermissionState(): Promise<void> {
  const granted = await hasBroadHostAccess();
  setText(
    "permission-state",
    granted
      ? "<all_urls> is GRANTED. Revoke it before running S0.5 — scripting will otherwise succeed on every tab for the wrong reason."
      : "<all_urls> is not granted. S0.5 is safe to run.",
  );
  const node = document.getElementById("permission-state");
  if (node) {
    node.dataset.granted = String(granted);
  }
}

async function renderSpikeLog(): Promise<void> {
  const results = await getSpikeResults();
  const lines: string[] = [];

  for (const spikeId of LOGGED_SPIKE_IDS) {
    const result = results[spikeId];
    lines.push(`— ${spikeId} (${result?.status ?? "idle"}) —`);
    if (!result || result.entries.length === 0) {
      lines.push("  no log entries yet");
      continue;
    }
    for (const entry of result.entries) {
      const time = new Date(entry.timestamp).toLocaleTimeString();
      lines.push(`  [${time}] ${entry.level.toUpperCase()}: ${entry.message}`);
    }
  }

  setText("nano-log", lines.join("\n"));
}

async function renderResults(): Promise<void> {
  const results = await getSpikeResults();
  setText("stored-results", JSON.stringify(results, null, 2));
  await Promise.all([renderMatrix(), renderSpikeLog(), renderPermissionState()]);
}

/**
 * Runs the spike in this document. Called straight from the click handler so
 * `create()` (S0.2) and `permissions.request()` (S0.6) still see the transient
 * user activation.
 */
async function run(spikeId: DocumentRunnableSpikeId): Promise<void> {
  const buttons = runButtons();
  for (const button of buttons) {
    button.disabled = true;
  }
  setText("run-status", `Running ${spikeId} in the options page…`);

  try {
    await runDocumentSpike(spikeId, "options");
    setText("run-status", `${spikeId} finished — see the log below.`);
  } catch (error) {
    setText(
      "run-status",
      `${spikeId} threw: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    for (const button of buttons) {
      button.disabled = false;
    }
    await renderResults();
  }
}

for (const spikeId of RUNNABLE_SPIKE_IDS) {
  document.getElementById(BUTTON_IDS[spikeId])?.addEventListener("click", () => {
    void run(spikeId);
  });
}

document.getElementById("probe-worker-create")?.addEventListener("click", () => {
  void chrome.runtime
    .sendMessage({ type: "PROBE_WORKER_NANO_CREATE" })
    .then(() => renderResults());
});

document.getElementById("revoke-hosts")?.addEventListener("click", () => {
  void revokeBroadHostAccess("options").then(() => renderResults());
});

document.getElementById("refresh-results")?.addEventListener("click", () => {
  void renderResults();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (
    changes[SPIKE_RESULTS_STORAGE_KEY] ||
    changes[NANO_CONTEXT_MATRIX_KEY] ||
    changes[PERMISSIONS_STATE_STORAGE_KEY]
  ) {
    void renderResults();
  }
});

chrome.permissions.onAdded.addListener(() => {
  void renderPermissionState();
});

chrome.permissions.onRemoved.addListener(() => {
  void renderPermissionState();
});

void renderResults();
