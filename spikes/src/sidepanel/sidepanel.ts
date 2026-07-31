import type {
  BackgroundRequest,
  BackgroundResponse,
} from "../shared/messaging/messages";
import type { ContextMatrix, ContextProbeRecord } from "../shared/nano/matrix";
import {
  getContextMatrix,
  NANO_CONTEXT_MATRIX_KEY,
  summarizeContextProbe,
} from "../shared/nano/matrix";
import type { SpikeContextId } from "../shared/nano/types";
import { SPIKE_CONTEXT_LABELS } from "../shared/nano/types";
import type { ActiveTabSpikeState } from "../shared/spikes/active-tab";
import { ACTIVE_TAB_STATE_STORAGE_KEY } from "../shared/spikes/active-tab";
import { runDocumentSpike } from "../shared/spikes/document-runners";
import type {
  DocumentSpikeId,
  SpikeId,
  SpikeResult,
} from "../shared/spikes/types";
import { isDocumentSpike, SPIKE_DEFINITIONS } from "../shared/spikes/types";

const S05_INSTRUCTIONS = [
  "Open a normal http(s) page in a tab (not chrome:// or the Web Store).",
  "Click the PromptAhead toolbar icon on that tab — that gesture grants activeTab, extracts the page in the service worker, and opens this panel.",
  'Come back here and press "Run panel follow-up" to see whether the panel can re-script the same tab with no new gesture.',
  "Navigate that tab elsewhere, then press the button again — the grant should now be gone.",
  "Repeat via the page context menu and Alt+Shift+E to compare the three gestures.",
];

/**
 * S0.1–S0.3 run inside this document, so the instructions have to say what the
 * harness cannot do for the user: probe the options realm, and keep the panel
 * open while a download runs.
 */
const NANO_INSTRUCTIONS: Record<DocumentSpikeId, string[]> = {
  "S0.1": [
    "Running here probes the side-panel realm and asks the service worker to probe its own realm.",
    'Then open the options page (header button) and press "Run S0.1 probe here" — a document can only probe the realm it runs in.',
    "Copy the matrix below into docs/technical-spikes.md together with the Chrome version.",
  ],
  "S0.2": [
    "Runs in this panel so create() can spend the user activation from your click.",
    "If the model still needs downloading, leave this panel open — closing it aborts create() and the progress log stops.",
    "No progress at all? Check chrome://on-device-internals for model status and disk space.",
  ],
  "S0.3": [
    "Needs a resident model: run S0.2 until availability() reports available.",
    "Sends three synthetic pages (article, product, generic) with responseConstraint and reports the parse rate.",
    "Each prompt times out after 10s and gets at most one repair attempt.",
  ],
};

const MATRIX_CONTEXTS: SpikeContextId[] = [
  "sidepanel",
  "options",
  "service-worker",
];

function sendMessage<T extends BackgroundResponse>(
  request: BackgroundRequest,
): Promise<T> {
  return chrome.runtime.sendMessage(request);
}

async function loadResults(): Promise<Record<SpikeId, SpikeResult>> {
  const response = await sendMessage<BackgroundResponse>({
    type: "GET_SPIKE_RESULTS",
  });
  if (!response.ok) {
    throw new Error(response.error);
  }
  if (!response.results) {
    throw new Error("Failed to load spike results.");
  }
  return response.results;
}

async function loadActiveTabState(): Promise<ActiveTabSpikeState | null> {
  const response = await sendMessage<BackgroundResponse>({
    type: "GET_S05_STATE",
  });
  return response.ok ? (response.s05State ?? null) : null;
}

/** The worker has to probe itself; nothing here can inspect its globals. */
async function probeServiceWorkerRealm(): Promise<ContextProbeRecord | null> {
  const response = await sendMessage<BackgroundResponse>({
    type: "PROBE_PROMPT_API_IN_WORKER",
  });
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.probe ?? null;
}

function formatEntry(entry: SpikeResult["entries"][number]): string {
  const time = new Date(entry.timestamp).toLocaleTimeString();
  return `[${time}] ${entry.level.toUpperCase()}: ${entry.message}`;
}

function element(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

/**
 * Page-derived strings (title, URL, excerpt) are untrusted, so this section is
 * built with textContent only — never innerHTML.
 */
function renderActiveTabDetail(state: ActiveTabSpikeState | null): HTMLElement {
  const detail = element("section", "spike-detail");
  detail.append(element("h3", "spike-detail__title", "How to test in Chrome"));

  const steps = element("ol", "spike-detail__steps");
  for (const instruction of S05_INSTRUCTIONS) {
    steps.append(element("li", undefined, instruction));
  }
  detail.append(steps);

  detail.append(
    element("h3", "spike-detail__title", "Last extraction from a gesture"),
  );

  const gesture = state?.lastGestureExtraction;
  if (!gesture) {
    detail.append(
      element(
        "p",
        "spike-detail__empty",
        "None yet — click the toolbar icon on a page to capture one.",
      ),
    );
    return detail;
  }

  const time = new Date(gesture.extractedAt).toLocaleTimeString();
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `${gesture.gesture} · tab ${gesture.tabId} · ${time} · ${gesture.durationMs} ms`,
    ),
  );
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `${gesture.page.title || "(no title)"} — ${gesture.page.hostname}`,
    ),
  );
  detail.append(element("p", "spike-detail__meta", gesture.page.url));
  detail.append(
    element(
      "pre",
      "spike-detail__excerpt",
      `${gesture.page.excerpt}${gesture.page.truncated ? "…" : ""}`,
    ),
  );

  if (state?.navigationSinceGrant) {
    const nav = state.navigationSinceGrant;
    detail.append(
      element(
        "p",
        "spike-detail__flag",
        `Tab ${nav.tabId} ${nav.reason} at ${new Date(nav.at).toLocaleTimeString()} — the grant should be revoked.`,
      ),
    );
  }

  const followUp = state?.lastFollowUp;
  if (followUp) {
    detail.append(
      element(
        "p",
        followUp.succeeded ? "spike-detail__ok" : "spike-detail__flag",
        `Last panel follow-up (${new Date(followUp.attemptedAt).toLocaleTimeString()}): ${
          followUp.succeeded
            ? "injection allowed without a new gesture"
            : `injection refused — ${followUp.error ?? "no error message"}`
        }`,
      ),
    );
  }

  return detail;
}

function renderNanoDetail(
  spikeId: DocumentSpikeId,
  matrix: ContextMatrix,
): HTMLElement {
  const detail = element("section", "spike-detail");
  detail.append(element("h3", "spike-detail__title", "How to run this spike"));

  const steps = element("ol", "spike-detail__steps");
  for (const instruction of NANO_INSTRUCTIONS[spikeId]) {
    steps.append(element("li", undefined, instruction));
  }
  detail.append(steps);

  if (spikeId !== "S0.1") {
    return detail;
  }

  detail.append(element("h3", "spike-detail__title", "Context matrix"));
  for (const context of MATRIX_CONTEXTS) {
    const record = matrix[context];
    const label = SPIKE_CONTEXT_LABELS[context];
    if (!record) {
      detail.append(
        element("p", "spike-detail__empty", `${label}: not probed yet`),
      );
      continue;
    }
    detail.append(
      element(
        "p",
        record.surface === "none" ? "spike-detail__flag" : "spike-detail__ok",
        `${label}: ${summarizeContextProbe(record)}`,
      ),
    );
    detail.append(
      element(
        "p",
        "spike-detail__meta",
        `Chrome ${record.chromeVersion} · ${new Date(record.checkedAt).toLocaleTimeString()}`,
      ),
    );
  }

  return detail;
}

function renderSpikeCard(
  result: SpikeResult,
  activeTabState: ActiveTabSpikeState | null,
  matrix: ContextMatrix,
): HTMLElement {
  const definition = SPIKE_DEFINITIONS.find((spike) => spike.id === result.spikeId);
  const isActiveTabSpike = result.spikeId === "S0.5";
  const isRunning = result.status === "running";
  const card = document.createElement("article");
  card.className = "spike-card";
  card.dataset.spikeId = result.spikeId;

  card.innerHTML = `
    <header class="spike-card__header">
      <div>
        <h2>${result.spikeId} · ${definition?.title ?? "Spike"}</h2>
        <p class="spike-card__question">${definition?.question ?? ""}</p>
      </div>
      <span class="spike-card__status spike-card__status--${result.status}">${result.status}</span>
    </header>
    <div class="spike-card__actions">
      <button type="button" class="btn btn--primary" data-action="run"${
        isRunning ? " disabled" : ""
      }>${
        isRunning ? "Running…" : isActiveTabSpike ? "Run panel follow-up" : "Run"
      }</button>
      <button type="button" class="btn" data-action="clear">Clear log</button>
    </div>
    <pre class="spike-card__log" aria-live="polite"></pre>
  `;

  if (isActiveTabSpike) {
    card
      .querySelector(".spike-card__actions")
      ?.after(renderActiveTabDetail(activeTabState));
  }

  if (isDocumentSpike(result.spikeId)) {
    card
      .querySelector(".spike-card__actions")
      ?.after(renderNanoDetail(result.spikeId, matrix));
  }

  const logEl = card.querySelector(".spike-card__log") as HTMLPreElement;
  logEl.textContent =
    result.entries.length > 0
      ? result.entries.map(formatEntry).join("\n")
      : "No log entries yet.";

  card.querySelector('[data-action="run"]')?.addEventListener("click", () => {
    void runSpike(result.spikeId);
  });

  card.querySelector('[data-action="clear"]')?.addEventListener("click", () => {
    void clearSpike(result.spikeId);
  });

  return card;
}

async function runSpike(spikeId: SpikeId): Promise<void> {
  // Prompt API spikes must execute in this document: routing them through the
  // service worker would only ever measure the worker, and create() needs the
  // transient user activation from the click that got us here.
  if (isDocumentSpike(spikeId)) {
    await runDocumentSpike(spikeId, "sidepanel", {
      probeServiceWorker: spikeId === "S0.1" ? probeServiceWorkerRealm : undefined,
    });
    await refreshDashboard();
    return;
  }

  await sendMessage({ type: "RUN_SPIKE", spikeId });
  await refreshDashboard();
}

async function clearSpike(spikeId: SpikeId): Promise<void> {
  await sendMessage({ type: "CLEAR_SPIKE_LOG", spikeId });
  await refreshDashboard();
}

async function refreshDashboard(): Promise<void> {
  const [results, activeTabState, matrix] = await Promise.all([
    loadResults(),
    loadActiveTabState(),
    getContextMatrix(),
  ]);
  const root = document.getElementById("spike-list");
  if (!root) {
    return;
  }

  root.replaceChildren(
    ...SPIKE_DEFINITIONS.map((definition) =>
      renderSpikeCard(results[definition.id], activeTabState, matrix),
    ),
  );
}

function bindGlobalActions(): void {
  document.getElementById("open-options")?.addEventListener("click", () => {
    void chrome.runtime.openOptionsPage();
  });

  document.getElementById("refresh-all")?.addEventListener("click", () => {
    void refreshDashboard();
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (
    areaName !== "local" ||
    (!changes["spikes.results.v1"] &&
      !changes[ACTIVE_TAB_STATE_STORAGE_KEY] &&
      !changes[NANO_CONTEXT_MATRIX_KEY])
  ) {
    return;
  }
  void refreshDashboard();
});

bindGlobalActions();
void refreshDashboard();
