import { appendSpikeLog, setSpikeStatus } from "../logging/spike-log";
import type { SpikeId } from "./types";

/**
 * S0.4 — Side Panel open paths.
 *
 * The product question: can the panel be opened from the toolbar action, a
 * context-menu item, and a notification click? All three are gestures Chrome
 * owns, and `sidePanel.open()` only works while that gesture is still live —
 * a single `await` before the call is enough to lose it.
 *
 * Nothing here can synthesise a gesture, so the spike records every real open
 * attempt as it happens and the Run button only reports coverage. That keeps
 * "Chrome refused this path" separate from "nobody has tried this path yet".
 */

const SPIKE_ID: SpikeId = "S0.4";

export const SIDE_PANEL_STATE_STORAGE_KEY = "spikes.s04.sidePanel.v1";

/** How long after an `open()` a panel load is still attributable to it. */
const PANEL_LOAD_ATTRIBUTION_MS = 15_000;

const PANEL_PRESENCE_POLL_MS = 200;
const PANEL_PRESENCE_TIMEOUT_MS = 2_000;

export type SidePanelOpenTrigger =
  | "toolbar-action"
  | "context-menu"
  | "notification-click";

export const SIDE_PANEL_TRIGGERS: readonly SidePanelOpenTrigger[] = [
  "toolbar-action",
  "context-menu",
  "notification-click",
];

export const SIDE_PANEL_TRIGGER_LABELS: Record<SidePanelOpenTrigger, string> = {
  "toolbar-action": "Toolbar action click",
  "context-menu": "Page context menu",
  "notification-click": "Notification click",
};

export const SIDE_PANEL_TRIGGER_HOWTO: Record<SidePanelOpenTrigger, string> = {
  "toolbar-action": "Click the PromptAhead toolbar icon on any tab.",
  "context-menu":
    'Right-click a page → "Open PromptAhead Spikes panel" (or the S0.5 extract item).',
  "notification-click":
    "Run S0.7, then click the notification banner it posts.",
};

export interface SidePanelOpenAttempt {
  trigger: SidePanelOpenTrigger;
  attemptedAt: string;
  durationMs: number;
  succeeded: boolean;
  error?: string;
  /** `open()` resolving is not proof the panel painted — see `confirmedBy`. */
  confirmedByPanelAt?: string;
  /**
   * `context` = a live SIDE_PANEL extension context was observed after the
   * call, `document-load` = the panel script reported its own load.
   */
  confirmedBy?: "context" | "document-load";
  target: "tabId" | "windowId";
  /**
   * True when the handler had to await something (a tab query, a storage read)
   * before reaching `open()`. Chrome may reject the call for that alone, so a
   * failure here is not necessarily a verdict on the trigger itself.
   */
  awaitedBeforeOpen: boolean;
}

export interface SidePanelSpikeState {
  attempts: Partial<Record<SidePanelOpenTrigger, SidePanelOpenAttempt>>;
  lastPanelLoadAt: string | null;
  /** Serialized `sidePanel.getPanelBehavior()`, captured on the last run. */
  panelBehavior: string | null;
}

function emptyState(): SidePanelSpikeState {
  return { attempts: {}, lastPanelLoadAt: null, panelBehavior: null };
}

export async function getSidePanelSpikeState(): Promise<SidePanelSpikeState> {
  const stored = await chrome.storage.local.get(SIDE_PANEL_STATE_STORAGE_KEY);
  const existing = stored[SIDE_PANEL_STATE_STORAGE_KEY] as
    | SidePanelSpikeState
    | undefined;
  return { ...emptyState(), ...existing, attempts: { ...existing?.attempts } };
}

async function patchSidePanelSpikeState(
  patch: Partial<SidePanelSpikeState>,
): Promise<void> {
  const next = { ...(await getSidePanelSpikeState()), ...patch };
  await chrome.storage.local.set({ [SIDE_PANEL_STATE_STORAGE_KEY]: next });
}

export async function clearSidePanelSpikeState(): Promise<void> {
  await chrome.storage.local.set({
    [SIDE_PANEL_STATE_STORAGE_KEY]: emptyState(),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `null` when this Chrome build cannot answer (getContexts is Chrome 116+). */
async function sidePanelContextPresent(): Promise<boolean | null> {
  if (typeof chrome.runtime.getContexts !== "function") {
    return null;
  }
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["SIDE_PANEL" as chrome.runtime.ContextType],
    });
    return contexts.length > 0;
  } catch {
    return null;
  }
}

/**
 * `sidePanel.open()` resolving only means Chrome accepted the call. This looks
 * for a live side-panel context afterwards, which is the closest the extension
 * can get to "a panel is on screen".
 */
async function waitForSidePanelContext(): Promise<boolean | null> {
  const deadline = Date.now() + PANEL_PRESENCE_TIMEOUT_MS;
  for (;;) {
    const present = await sidePanelContextPresent();
    if (present !== false) {
      return present;
    }
    if (Date.now() >= deadline) {
      return false;
    }
    await delay(PANEL_PRESENCE_POLL_MS);
  }
}

export interface SidePanelOpenRequest {
  trigger: SidePanelOpenTrigger;
  tabId?: number;
  windowId?: number;
  awaitedBeforeOpen?: boolean;
}

/**
 * Opens the panel and records the outcome for S0.4.
 *
 * Call this as the first statement of a gesture handler and do not await
 * anything before it: `chrome.sidePanel.open()` is reached synchronously here,
 * everything else happens after the promise is already in flight.
 */
export async function openSidePanelForSpike(
  request: SidePanelOpenRequest,
): Promise<boolean> {
  const startedAt = Date.now();
  const useTabId = request.tabId !== undefined;
  const target = useTabId
    ? { tabId: request.tabId as number }
    : { windowId: request.windowId as number };

  let openPromise: Promise<void>;
  try {
    openPromise = chrome.sidePanel.open(target);
  } catch (error) {
    openPromise = Promise.reject(error);
  }

  let failure: string | undefined;
  try {
    await openPromise;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  const attempt: SidePanelOpenAttempt = {
    trigger: request.trigger,
    attemptedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    succeeded: failure === undefined,
    target: useTabId ? "tabId" : "windowId",
    awaitedBeforeOpen: request.awaitedBeforeOpen === true,
  };
  if (failure !== undefined) {
    attempt.error = failure;
  }

  const label = SIDE_PANEL_TRIGGER_LABELS[request.trigger];
  let presence: boolean | null = null;

  if (failure === undefined) {
    presence = await waitForSidePanelContext();
    if (presence === true) {
      attempt.confirmedByPanelAt = new Date().toISOString();
      attempt.confirmedBy = "context";
    }
  }

  const state = await getSidePanelSpikeState();

  // The panel document can report its load before this attempt is written, so
  // a load that happened during the call still counts as confirmation.
  if (
    failure === undefined &&
    !attempt.confirmedByPanelAt &&
    state.lastPanelLoadAt &&
    new Date(state.lastPanelLoadAt).getTime() >= startedAt
  ) {
    attempt.confirmedByPanelAt = state.lastPanelLoadAt;
    attempt.confirmedBy = "document-load";
  }

  await patchSidePanelSpikeState({
    attempts: { ...state.attempts, [request.trigger]: attempt },
  });

  if (failure === undefined) {
    await appendSpikeLog(
      SPIKE_ID,
      "success",
      `${label}: sidePanel.open({${attempt.target}}) resolved in ${attempt.durationMs} ms.`,
    );
    if (attempt.confirmedByPanelAt) {
      await appendSpikeLog(
        SPIKE_ID,
        "success",
        `${label}: a side-panel document is live afterwards (via ${attempt.confirmedBy}) — the panel really is open.`,
      );
    } else if (presence === false) {
      await appendSpikeLog(
        SPIKE_ID,
        "error",
        `${label}: open() resolved but no SIDE_PANEL context exists ${PANEL_PRESENCE_TIMEOUT_MS} ms later. Chrome accepted the call without showing a panel.`,
      );
    } else {
      await appendSpikeLog(
        SPIKE_ID,
        "info",
        `${label}: runtime.getContexts() is unavailable on this build, so confirmation has to come from the panel script reporting its own load.`,
      );
    }
  } else {
    await appendSpikeLog(
      SPIKE_ID,
      "error",
      `${label}: sidePanel.open({${attempt.target}}) threw — ${failure}`,
    );
    if (attempt.awaitedBeforeOpen) {
      await appendSpikeLog(
        SPIKE_ID,
        "warn",
        `${label}: the handler had to await before calling open(), which can cost the user gesture on its own. Treat this as inconclusive for the trigger.`,
      );
    } else if (/gesture|user activation/i.test(failure)) {
      await appendSpikeLog(
        SPIKE_ID,
        "warn",
        `${label}: Chrome does not treat this event as a user gesture for sidePanel.open(), even though open() was reached synchronously. This is a real platform limitation, not a harness bug.`,
      );
    }
  }

  return failure === undefined;
}

/**
 * Called by the panel document on load. `open()` resolving only means Chrome
 * accepted the call; this is what proves a panel actually appeared.
 */
export async function noteSidePanelDocumentLoaded(): Promise<void> {
  const state = await getSidePanelSpikeState();
  const loadedAt = new Date().toISOString();

  const pending = Object.values(state.attempts)
    .filter(
      (attempt) =>
        attempt.succeeded &&
        !attempt.confirmedByPanelAt &&
        Date.now() - new Date(attempt.attemptedAt).getTime() <
          PANEL_LOAD_ATTRIBUTION_MS,
    )
    .sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt))[0];

  if (!pending) {
    await patchSidePanelSpikeState({ lastPanelLoadAt: loadedAt });
    return;
  }

  await patchSidePanelSpikeState({
    lastPanelLoadAt: loadedAt,
    attempts: {
      ...state.attempts,
      [pending.trigger]: {
        ...pending,
        confirmedByPanelAt: loadedAt,
        confirmedBy: "document-load",
      },
    },
  });
  await appendSpikeLog(
    SPIKE_ID,
    "success",
    `${SIDE_PANEL_TRIGGER_LABELS[pending.trigger]}: panel document loaded ${
      Date.now() - new Date(pending.attemptedAt).getTime()
    } ms after open() — the panel really did appear.`,
  );
}

async function logPanelBehavior(): Promise<string | null> {
  try {
    const behavior = await chrome.sidePanel.getPanelBehavior();
    const serialized = JSON.stringify(behavior);
    await appendSpikeLog(
      SPIKE_ID,
      "info",
      `sidePanel.getPanelBehavior() = ${serialized}`,
    );
    if (behavior.openPanelOnActionClick !== false) {
      await appendSpikeLog(
        SPIKE_ID,
        "warn",
        "openPanelOnActionClick is not false — Chrome is opening the panel itself, so action.onClicked never fires and S0.5 cannot capture its activeTab gesture. Reload the extension to re-apply the harness default.",
      );
    }
    return serialized;
  } catch (error) {
    await appendSpikeLog(
      SPIKE_ID,
      "warn",
      `sidePanel.getPanelBehavior() threw — ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Coverage report, not a test run. Status semantics:
 * `pass` = all three paths opened the panel, `fail` = a path was exercised and
 * Chrome refused it, `blocked` = a path has not been exercised yet.
 */
export async function runSidePanelPathsSpike(spikeId: SpikeId): Promise<void> {
  await setSpikeStatus(spikeId, "running");

  await appendSpikeLog(
    spikeId,
    "info",
    "This button reports coverage — it cannot fake a gesture. Each open path has to be triggered by hand; the result is recorded when it happens.",
  );
  await appendSpikeLog(
    spikeId,
    "info",
    "The harness sets openPanelOnActionClick: false on purpose. With it true, Chrome opens the panel itself and action.onClicked never fires, which S0.5 needs to spend its activeTab grant. So the toolbar path here is an explicit sidePanel.open() from the onClicked handler, not Chrome's built-in behaviour.",
  );

  const panelBehavior = await logPanelBehavior();
  await patchSidePanelSpikeState({ panelBehavior });

  const state = await getSidePanelSpikeState();
  const missing: SidePanelOpenTrigger[] = [];
  const refused: SidePanelOpenTrigger[] = [];
  const inconclusive: SidePanelOpenTrigger[] = [];

  for (const trigger of SIDE_PANEL_TRIGGERS) {
    const label = SIDE_PANEL_TRIGGER_LABELS[trigger];
    const attempt = state.attempts[trigger];

    if (!attempt) {
      missing.push(trigger);
      await appendSpikeLog(
        spikeId,
        "warn",
        `${label}: never exercised. ${SIDE_PANEL_TRIGGER_HOWTO[trigger]}`,
      );
      continue;
    }

    const when = new Date(attempt.attemptedAt).toLocaleTimeString();
    if (attempt.succeeded) {
      await appendSpikeLog(
        spikeId,
        "success",
        `${label}: opened at ${when} in ${attempt.durationMs} ms via {${attempt.target}}${
          attempt.confirmedByPanelAt
            ? `, confirmed by ${attempt.confirmedBy ?? "the panel"}`
            : ", but no live panel was observed afterwards — open() resolved without a visible panel"
        }.`,
      );
      if (!attempt.confirmedByPanelAt) {
        inconclusive.push(trigger);
        await appendSpikeLog(
          spikeId,
          "warn",
          `${label}: close the side panel and trigger this path again. If the panel still never appears while open() keeps resolving, that is a real finding — record it.`,
        );
      }
      continue;
    }

    if (attempt.awaitedBeforeOpen) {
      inconclusive.push(trigger);
      await appendSpikeLog(
        spikeId,
        "warn",
        `${label}: failed at ${when} after an await preceded open() — ${attempt.error ?? "no error message"}. Inconclusive: the gesture may have expired before Chrome saw the call.`,
      );
      continue;
    }

    refused.push(trigger);
    await appendSpikeLog(
      spikeId,
      "error",
      `${label}: Chrome refused at ${when} — ${attempt.error ?? "no error message"}`,
    );
  }

  if (refused.length > 0) {
    await appendSpikeLog(
      spikeId,
      "error",
      `Refused paths: ${refused.map((t) => SIDE_PANEL_TRIGGER_LABELS[t]).join(", ")}. Record the exact error in docs/technical-spikes.md — this is a product constraint, not a retry.`,
    );
    await setSpikeStatus(spikeId, "fail");
    return;
  }

  if (missing.length > 0 || inconclusive.length > 0) {
    const pendingLabels = [...missing, ...inconclusive].map(
      (t) => SIDE_PANEL_TRIGGER_LABELS[t],
    );
    await appendSpikeLog(
      spikeId,
      "warn",
      `Coverage incomplete — still to prove: ${pendingLabels.join(", ")}. Nothing has failed; the paths just have not been exercised.`,
    );
    await setSpikeStatus(spikeId, "blocked");
    return;
  }

  await appendSpikeLog(
    spikeId,
    "success",
    "All three open paths opened the side panel and the panel document confirmed each one.",
  );
  await setSpikeStatus(spikeId, "pass");
}
