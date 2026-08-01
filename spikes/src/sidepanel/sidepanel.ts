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
import { runDocumentSpike, runsInDocument } from "../shared/spikes/document-runners";
import type { NotificationSpikeState } from "../shared/spikes/notifications";
import {
  getNotificationSpikeState,
  NOTIFICATIONS_STATE_STORAGE_KEY,
} from "../shared/spikes/notifications";
import type { PermissionsSpikeState } from "../shared/spikes/permissions";
import {
  getPermissionsSpikeState,
  hasBroadHostAccess,
  PERMISSIONS_STATE_STORAGE_KEY,
  revokeBroadHostAccess,
} from "../shared/spikes/permissions";
import type {
  SidePanelOpenTrigger,
  SidePanelSpikeState,
} from "../shared/spikes/side-panel";
import {
  getSidePanelSpikeState,
  SIDE_PANEL_STATE_STORAGE_KEY,
  SIDE_PANEL_TRIGGER_HOWTO,
  SIDE_PANEL_TRIGGER_LABELS,
  SIDE_PANEL_TRIGGERS,
} from "../shared/spikes/side-panel";
import type { DocumentSpikeId, SpikeId, SpikeResult } from "../shared/spikes/types";
import { isDocumentSpike, SPIKE_DEFINITIONS } from "../shared/spikes/types";

const S05_INSTRUCTIONS = [
  "Open a normal http(s) page in a tab (not chrome:// or the Web Store).",
  "Click the PromptAhead toolbar icon on that tab — that gesture grants activeTab, extracts the page in the service worker, and opens this panel.",
  'Come back here and press "Run panel follow-up" to see whether the panel can re-script the same tab with no new gesture.',
  "Navigate that tab elsewhere, then press the button again — the grant should now be gone.",
  "Repeat via the page context menu and Alt+Shift+E to compare the three gestures.",
];

const S04_INSTRUCTIONS = [
  "Click the PromptAhead toolbar icon on any tab — that records the toolbar path.",
  'Right-click a page and choose "Open PromptAhead Spikes panel" — that records the context-menu path.',
  "Run S0.7 below and click the notification it posts — that records the notification path.",
  "Come back and press Run here: it reports which of the three paths have opened the panel and which are still missing.",
];

const S06_INSTRUCTIONS = [
  "Press Run on this card. Chrome must show its own permission prompt — approve it.",
  "The spike then proves the grant works without a reload, revokes it again, and proves the access is gone.",
  "The permission must be revoked when the run ends. If the banner below says GRANTED, press “Revoke <all_urls> now” before touching S0.5.",
  "Run it once here and once from the options page: they are different realms and may not both be allowed to ask.",
];

const S07_INSTRUCTIONS = [
  "Press Run. A badge appears on the toolbar icon and Chrome posts one notification.",
  "Close this side panel, then click the notification banner. Closing it first is what makes the result mean something: with the panel already open, a successful click only proves Chrome allowed the call.",
  "Reopen the panel to read the outcome — the click also fills in S0.4's notification row.",
  "If no banner appears within a few seconds, press “Notification not shown”: macOS suppression is recorded as blocked, not as a failure.",
  "The badge clears when the notification is clicked, dismissed, or via the buttons on this card.",
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
    'Once the model is resident, press "Probe worker create()" to fill the last gap in the matrix: whether the worker can host a session, not just expose the API.',
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

const MATRIX_CONTEXTS: SpikeContextId[] = ["sidepanel", "options", "service-worker"];

interface DashboardState {
  activeTab: ActiveTabSpikeState | null;
  matrix: ContextMatrix;
  sidePanel: SidePanelSpikeState;
  permissions: PermissionsSpikeState;
  broadHostsGranted: boolean;
  notifications: NotificationSpikeState;
}

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

function detailSection(title: string, instructions: string[]): HTMLElement {
  const detail = element("section", "spike-detail");
  detail.append(element("h3", "spike-detail__title", title));
  const steps = element("ol", "spike-detail__steps");
  for (const instruction of instructions) {
    steps.append(element("li", undefined, instruction));
  }
  detail.append(steps);
  return detail;
}

/**
 * Plain-language briefing so the tester knows what they are proving,
 * not just which button to click.
 */
function renderBriefing(
  definition: (typeof SPIKE_DEFINITIONS)[number] | undefined,
): HTMLElement {
  const briefing = element("section", "spike-briefing");
  if (!definition) {
    return briefing;
  }

  const rows: Array<[string, string, string]> = [
    ["What you are testing", definition.testing, "spike-briefing__body"],
    ["Why it matters", definition.matters, "spike-briefing__body"],
    ["Pass looks like", definition.pass, "spike-briefing__pass"],
    ["Result is invalid if", definition.invalidIf, "spike-briefing__warn"],
  ];

  for (const [label, text, bodyClass] of rows) {
    const row = element("div", "spike-briefing__row");
    row.append(element("p", "spike-briefing__label", label));
    row.append(element("p", bodyClass, text));
    briefing.append(row);
  }

  return briefing;
}

function extraButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Page-derived strings (title, URL, excerpt) are untrusted, so this section is
 * built with textContent only — never innerHTML.
 */
function renderActiveTabDetail(state: ActiveTabSpikeState | null): HTMLElement {
  const detail = detailSection("How to test in Chrome", S05_INSTRUCTIONS);

  detail.append(element("h3", "spike-detail__title", "Last extraction from a gesture"));

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

function describeOpenTrigger(
  trigger: SidePanelOpenTrigger,
  state: SidePanelSpikeState,
): { className: string; text: string } {
  const label = SIDE_PANEL_TRIGGER_LABELS[trigger];
  const attempt = state.attempts[trigger];

  if (!attempt) {
    return {
      className: "spike-detail__empty",
      text: `${label}: not exercised — ${SIDE_PANEL_TRIGGER_HOWTO[trigger]}`,
    };
  }

  const when = new Date(attempt.attemptedAt).toLocaleTimeString();
  if (attempt.succeeded) {
    return {
      className: attempt.confirmedByPanelAt ? "spike-detail__ok" : "spike-detail__flag",
      text: `${label}: opened at ${when}${
        attempt.confirmedByPanelAt
          ? ` and a live panel was confirmed (${attempt.confirmedBy ?? "panel"})`
          : " but no live panel was observed afterwards"
      }`,
    };
  }

  return {
    className: "spike-detail__flag",
    text: `${label}: refused at ${when} — ${attempt.error ?? "no error message"}${
      attempt.awaitedBeforeOpen ? " (inconclusive: an await preceded open())" : ""
    }`,
  };
}

function renderSidePanelDetail(state: SidePanelSpikeState): HTMLElement {
  const detail = detailSection("How to test in Chrome", S04_INSTRUCTIONS);
  detail.append(element("h3", "spike-detail__title", "Open path coverage"));

  for (const trigger of SIDE_PANEL_TRIGGERS) {
    const { className, text } = describeOpenTrigger(trigger, state);
    detail.append(element("p", className, text));
  }

  if (state.panelBehavior) {
    detail.append(
      element("p", "spike-detail__meta", `getPanelBehavior(): ${state.panelBehavior}`),
    );
  }

  return detail;
}

function renderPermissionsDetail(
  state: PermissionsSpikeState,
  granted: boolean,
): HTMLElement {
  const detail = detailSection("How to test in Chrome", S06_INSTRUCTIONS);

  detail.append(element("h3", "spike-detail__title", "Current grant state"));
  detail.append(
    element(
      "p",
      granted ? "spike-detail__flag" : "spike-detail__ok",
      granted
        ? "<all_urls> is GRANTED right now. S0.5 cannot be trusted until this is revoked — scripting will succeed on every tab."
        : "<all_urls> is not granted. S0.5 is safe to run.",
    ),
  );

  if (!state.ranAt) {
    detail.append(element("p", "spike-detail__empty", "No S0.6 run recorded yet."));
    return detail;
  }

  detail.append(element("h3", "spike-detail__title", "Last run"));
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `${new Date(state.ranAt).toLocaleTimeString()} in ${
        state.ranIn ? SPIKE_CONTEXT_LABELS[state.ranIn] : "unknown realm"
      }`,
    ),
  );
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `contains: ${state.containsBefore} → ${state.containsAfterGrant} → ${state.containsAfterRevoke} (before / after grant / after revoke)`,
    ),
  );
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `request() = ${state.granted} in ${state.promptDurationMs ?? "?"} ms · prompt likely shown: ${state.promptLikelyShown}`,
    ),
  );
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `scripting a never-granted tab: ${state.effectBeforeGrant} → ${state.effectAfterGrant} → ${state.effectAfterRevoke}`,
    ),
  );
  detail.append(
    element(
      "p",
      "spike-detail__meta",
      `remove() = ${state.removed}${state.removeError ? ` (${state.removeError})` : ""} · onAdded: ${state.onAddedFired} · onRemoved: ${state.onRemovedFired}`,
    ),
  );
  if (state.requestError) {
    detail.append(
      element("p", "spike-detail__flag", `request() threw: ${state.requestError}`),
    );
  }

  return detail;
}

function renderNotificationDetail(state: NotificationSpikeState): HTMLElement {
  const detail = detailSection("How to test in Chrome", S07_INSTRUCTIONS);

  if (!state.ranAt) {
    detail.append(element("p", "spike-detail__empty", "No S0.7 run recorded yet."));
    return detail;
  }

  detail.append(element("h3", "spike-detail__title", "Last run"));
  detail.append(
    element(
      "p",
      state.badgeSet ? "spike-detail__ok" : "spike-detail__flag",
      `Badge: ${state.badgeReadback ?? "not set"}`,
    ),
  );
  detail.append(
    element(
      "p",
      state.created ? "spike-detail__meta" : "spike-detail__flag",
      `notifications.create(): ${state.created ? "ok" : `failed — ${state.createError ?? "unknown"}`} · permission level: ${state.permissionLevel ?? "unknown"}`,
    ),
  );
  if (state.notificationId) {
    detail.append(element("p", "spike-detail__meta", `id: ${state.notificationId}`));
  }
  if (state.presentAfterCreate === false) {
    detail.append(
      element(
        "p",
        "spike-detail__flag",
        "Chrome dropped the notification shortly after creating it — that is what OS-level suppression looks like.",
      ),
    );
  }
  if (state.reportedNotShownAt) {
    detail.append(
      element(
        "p",
        "spike-detail__flag",
        `You reported no banner appeared at ${new Date(state.reportedNotShownAt).toLocaleTimeString()} — recorded as an OS limitation, not a code failure.`,
      ),
    );
  }
  if (state.clickedAt) {
    detail.append(
      element(
        "p",
        state.sidePanelOpened ? "spike-detail__ok" : "spike-detail__flag",
        `Clicked at ${new Date(state.clickedAt).toLocaleTimeString()} — side panel ${
          state.sidePanelOpened
            ? "opened"
            : `did not open (${state.sidePanelError ?? "no error message"})`
        }`,
      ),
    );
  } else if (state.closedAt) {
    detail.append(
      element(
        "p",
        "spike-detail__flag",
        `Dismissed without a click at ${new Date(state.closedAt).toLocaleTimeString()} (byUser: ${state.closedByUser})`,
      ),
    );
  } else {
    detail.append(
      element("p", "spike-detail__empty", "Waiting for you to click the notification."),
    );
  }

  return detail;
}

function renderNanoDetail(
  spikeId: DocumentSpikeId,
  matrix: ContextMatrix,
): HTMLElement {
  const detail = detailSection("How to run this spike", NANO_INSTRUCTIONS[spikeId]);

  if (spikeId !== "S0.1") {
    return detail;
  }

  detail.append(element("h3", "spike-detail__title", "Context matrix"));
  for (const context of MATRIX_CONTEXTS) {
    const record = matrix[context];
    const label = SPIKE_CONTEXT_LABELS[context];
    if (!record) {
      detail.append(element("p", "spike-detail__empty", `${label}: not probed yet`));
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

function renderSpikeCard(result: SpikeResult, state: DashboardState): HTMLElement {
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

  const header = card.querySelector(".spike-card__header");
  header?.after(renderBriefing(definition));

  const actions = card.querySelector(".spike-card__actions");

  if (result.spikeId === "S0.1") {
    actions?.append(
      extraButton("Probe worker create()", () => {
        void probeWorkerCreate();
      }),
    );
  }

  if (result.spikeId === "S0.6") {
    actions?.append(
      extraButton("Revoke <all_urls> now", () => {
        void revokeAndRefresh();
      }),
    );
  }

  if (result.spikeId === "S0.7") {
    actions?.append(
      extraButton("Notification not shown", () => {
        void sendAndRefresh({ type: "S07_REPORT_NOT_SHOWN" });
      }),
      extraButton("Clear badge", () => {
        void sendAndRefresh({ type: "S07_CLEAR_BADGE" });
      }),
    );
  }

  if (isActiveTabSpike) {
    actions?.after(renderActiveTabDetail(state.activeTab));
  }

  if (result.spikeId === "S0.4") {
    actions?.after(renderSidePanelDetail(state.sidePanel));
  }

  if (result.spikeId === "S0.6") {
    actions?.after(renderPermissionsDetail(state.permissions, state.broadHostsGranted));
  }

  if (result.spikeId === "S0.7") {
    actions?.after(renderNotificationDetail(state.notifications));
  }

  if (isDocumentSpike(result.spikeId)) {
    actions?.after(renderNanoDetail(result.spikeId, state.matrix));
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
  // Spikes that need this realm must execute here: routing them through the
  // service worker would measure the worker instead, and both create() (S0.2)
  // and permissions.request() (S0.6) need the user activation from the click
  // that got us here.
  if (runsInDocument(spikeId)) {
    await runDocumentSpike(spikeId, "sidepanel", {
      probeServiceWorker: spikeId === "S0.1" ? probeServiceWorkerRealm : undefined,
    });
    await refreshDashboard();
    return;
  }

  await sendMessage({ type: "RUN_SPIKE", spikeId });
  await refreshDashboard();
}

async function probeWorkerCreate(): Promise<void> {
  await sendMessage({ type: "PROBE_WORKER_NANO_CREATE" });
  await refreshDashboard();
}

async function revokeAndRefresh(): Promise<void> {
  await revokeBroadHostAccess("sidepanel");
  await refreshDashboard();
}

async function sendAndRefresh(request: BackgroundRequest): Promise<void> {
  await sendMessage(request);
  await refreshDashboard();
}

async function clearSpike(spikeId: SpikeId): Promise<void> {
  await sendMessage({ type: "CLEAR_SPIKE_LOG", spikeId });
  await refreshDashboard();
}

async function refreshDashboard(): Promise<void> {
  const [
    results,
    activeTab,
    matrix,
    sidePanel,
    permissions,
    broadHostsGranted,
    notifications,
  ] = await Promise.all([
    loadResults(),
    loadActiveTabState(),
    getContextMatrix(),
    getSidePanelSpikeState(),
    getPermissionsSpikeState(),
    hasBroadHostAccess(),
    getNotificationSpikeState(),
  ]);

  const root = document.getElementById("spike-list");
  if (!root) {
    return;
  }

  const state: DashboardState = {
    activeTab,
    matrix,
    sidePanel,
    permissions,
    broadHostsGranted,
    notifications,
  };

  root.replaceChildren(
    ...SPIKE_DEFINITIONS.map((definition) =>
      renderSpikeCard(results[definition.id], state),
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

const WATCHED_STORAGE_KEYS = [
  "spikes.results.v1",
  ACTIVE_TAB_STATE_STORAGE_KEY,
  NANO_CONTEXT_MATRIX_KEY,
  SIDE_PANEL_STATE_STORAGE_KEY,
  PERMISSIONS_STATE_STORAGE_KEY,
  NOTIFICATIONS_STATE_STORAGE_KEY,
];

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }
  if (!WATCHED_STORAGE_KEYS.some((key) => changes[key])) {
    return;
  }
  void refreshDashboard();
});

/**
 * S0.4 asks whether the panel actually opened, not just whether `open()`
 * resolved. This load notice is the only thing that can answer that.
 */
void sendMessage({ type: "SIDE_PANEL_LOADED" });

bindGlobalActions();
void refreshDashboard();
