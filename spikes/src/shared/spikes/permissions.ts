import { appendSpikeLog, setSpikeStatus } from "../logging/spike-log";
import type { SpikeContextId } from "../nano/types";
import { SPIKE_CONTEXT_LABELS } from "../nano/types";
import { userActivationState } from "../nano/probe";
import { getActiveTabSpikeState } from "./active-tab";
import { createSpikeLogger } from "./logger";
import type { SpikeId } from "./types";

/**
 * S0.6 — Optional host permissions.
 *
 * The product question: can Smart mode grant and revoke `<all_urls>` at
 * runtime, does the grant take effect without an extension reload, and does
 * revoking really take it away?
 *
 * `permissions.request()` needs user activation, which the service worker does
 * not have, so this spike runs inside a document (side panel or options page)
 * straight from a click handler.
 *
 * The run always ends with the permission revoked. A lingering `<all_urls>`
 * grant makes `scripting.executeScript` succeed everywhere and would silently
 * turn the S0.5 result into a lie, so the final state is checked and a leftover
 * grant is reported as a failure of this spike.
 */

const SPIKE_ID: SpikeId = "S0.6";

export const PERMISSIONS_STATE_STORAGE_KEY = "spikes.s06.permissions.v1";

export const OPTIONAL_ORIGINS = ["<all_urls>"];

/** Below this, `request()` resolved too fast for a human to have answered. */
const PROMPT_VISIBLE_THRESHOLD_MS = 400;

export type PermissionEffect = "allowed" | "refused" | "inconclusive";

export interface HostAccessProbe {
  effect: PermissionEffect;
  tabId: number | null;
  urlVisible: boolean;
  detail: string;
}

export interface PermissionsSpikeState {
  ranAt: string | null;
  ranIn: SpikeContextId | null;
  containsBefore: boolean | null;
  promptDurationMs: number | null;
  promptLikelyShown: boolean | null;
  granted: boolean | null;
  requestError: string | null;
  containsAfterGrant: boolean | null;
  effectBeforeGrant: PermissionEffect | null;
  effectAfterGrant: PermissionEffect | null;
  effectAfterRevoke: PermissionEffect | null;
  removed: boolean | null;
  removeError: string | null;
  containsAfterRevoke: boolean | null;
  onAddedFired: boolean;
  onRemovedFired: boolean;
  /** True while the harness believes `<all_urls>` is still granted. */
  stillGranted: boolean;
}

function emptyState(): PermissionsSpikeState {
  return {
    ranAt: null,
    ranIn: null,
    containsBefore: null,
    promptDurationMs: null,
    promptLikelyShown: null,
    granted: null,
    requestError: null,
    containsAfterGrant: null,
    effectBeforeGrant: null,
    effectAfterGrant: null,
    effectAfterRevoke: null,
    removed: null,
    removeError: null,
    containsAfterRevoke: null,
    onAddedFired: false,
    onRemovedFired: false,
    stillGranted: false,
  };
}

export async function getPermissionsSpikeState(): Promise<PermissionsSpikeState> {
  const stored = await chrome.storage.local.get(PERMISSIONS_STATE_STORAGE_KEY);
  const existing = stored[PERMISSIONS_STATE_STORAGE_KEY] as
    PermissionsSpikeState | undefined;
  return { ...emptyState(), ...existing };
}

async function patchPermissionsSpikeState(
  patch: Partial<PermissionsSpikeState>,
): Promise<PermissionsSpikeState> {
  const next = { ...(await getPermissionsSpikeState()), ...patch };
  await chrome.storage.local.set({ [PERMISSIONS_STATE_STORAGE_KEY]: next });
  return next;
}

export async function clearPermissionsSpikeState(): Promise<void> {
  await chrome.storage.local.set({
    [PERMISSIONS_STATE_STORAGE_KEY]: emptyState(),
  });
}

export function hasBroadHostAccess(): Promise<boolean> {
  return chrome.permissions.contains({ origins: OPTIONAL_ORIGINS });
}

/** Runs in the page. Reads the URL only — never any page content. */
function readLocationHref(): string {
  return location.href;
}

/**
 * Can we script a tab we were never handed a gesture for? That is the only
 * observable difference a host grant makes, and it is what "no reload
 * surprises" actually means.
 *
 * The S0.5 tab is skipped deliberately: a live `activeTab` grant there would
 * make injection succeed for the wrong reason.
 */
async function probeHostAccess(phase: string): Promise<HostAccessProbe> {
  const activeTabState = await getActiveTabSpikeState();
  const gestureTabId = activeTabState.lastGestureExtraction?.tabId ?? null;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter(
    (tab) => tab.id !== undefined && tab.id !== chrome.tabs.TAB_ID_NONE,
  );
  const untainted = candidates.filter((tab) => tab.id !== gestureTabId);
  const target = untainted[0] ?? candidates[0];

  if (!target?.id) {
    return {
      effect: "inconclusive",
      tabId: null,
      urlVisible: false,
      detail: `${phase}: no tab available to probe.`,
    };
  }

  const tainted = untainted.length === 0 && gestureTabId !== null;
  const urlVisible = typeof target.url === "string" && target.url.length > 0;

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: target.id },
      func: readLocationHref,
    });
    const href = typeof injection?.result === "string" ? injection.result : "";
    return {
      effect: tainted ? "inconclusive" : "allowed",
      tabId: target.id,
      urlVisible,
      detail: tainted
        ? `${phase}: injection into tab ${target.id} succeeded, but that tab still holds an activeTab grant from S0.5 — open a second tab and re-run to get a clean reading.`
        : `${phase}: injection into never-granted tab ${target.id} succeeded (${href || "no URL returned"}); tabs.query exposed its URL: ${urlVisible}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const restricted =
      /chrome:\/\/|cannot be scripted|extension gallery|chrome-extension:\/\//i.test(
        message,
      );
    return {
      effect: restricted ? "inconclusive" : "refused",
      tabId: target.id,
      urlVisible,
      detail: restricted
        ? `${phase}: tab ${target.id} is a restricted page Chrome never allows scripting on (${message}) — this says nothing about the permission. Open an ordinary https:// tab.`
        : `${phase}: injection into never-granted tab ${target.id} was refused (${message}); tabs.query exposed its URL: ${urlVisible}.`,
    };
  }
}

interface RemoveOutcome {
  removed: boolean;
  error: string | null;
}

async function removeBroadHosts(): Promise<RemoveOutcome> {
  try {
    const removed = await chrome.permissions.remove({
      origins: OPTIONAL_ORIGINS,
    });
    return { removed, error: null };
  } catch (error) {
    return {
      removed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Standalone cleanup, exposed as its own button. The spike revokes on its own,
 * but a run interrupted halfway (closed panel, reloaded extension) can leave
 * the grant behind, and S0.5 must never be run in that state.
 */
export async function revokeBroadHostAccess(context: SpikeContextId): Promise<boolean> {
  const log = createSpikeLogger(SPIKE_ID, context);
  const before = await hasBroadHostAccess();
  if (!before) {
    await log("info", "Cleanup: <all_urls> was already revoked. Nothing to do.");
    await patchPermissionsSpikeState({ stillGranted: false });
    return true;
  }

  const outcome = await removeBroadHosts();
  const after = await hasBroadHostAccess();
  await patchPermissionsSpikeState({ stillGranted: after });

  if (after) {
    await log(
      "error",
      `Cleanup FAILED: <all_urls> is still granted (remove() returned ${outcome.removed}${
        outcome.error ? `, threw ${outcome.error}` : ""
      }). Revoke it by hand at chrome://extensions → Details → Site access before running S0.5.`,
    );
    return false;
  }

  await log("success", "Cleanup: <all_urls> revoked. S0.5 is safe to run again.");
  return true;
}

/**
 * The full grant → verify → revoke sequence. Must be called directly from a
 * click handler in a document; the service worker has no user activation to
 * spend on `request()`.
 */
export async function runOptionalHostsSpike(context: SpikeContextId): Promise<void> {
  const log = createSpikeLogger(SPIKE_ID, context);
  await setSpikeStatus(SPIKE_ID, "running");

  let onAddedFired = false;
  let onRemovedFired = false;
  const onAdded = (permissions: chrome.permissions.Permissions): void => {
    onAddedFired = true;
    void log(
      "success",
      `permissions.onAdded fired in this document: origins=${(permissions.origins ?? []).join(", ") || "none"}`,
    );
  };
  const onRemoved = (permissions: chrome.permissions.Permissions): void => {
    onRemovedFired = true;
    void log(
      "success",
      `permissions.onRemoved fired in this document: origins=${(permissions.origins ?? []).join(", ") || "none"}`,
    );
  };
  chrome.permissions.onAdded.addListener(onAdded);
  chrome.permissions.onRemoved.addListener(onRemoved);

  try {
    await log(
      "info",
      `S0.6 started in ${SPIKE_CONTEXT_LABELS[context]} — requesting ${OPTIONAL_ORIGINS.join(", ")} from optional_host_permissions.`,
    );

    let containsBefore = await hasBroadHostAccess();
    await log("info", `permissions.contains() before: ${containsBefore}`);

    if (containsBefore) {
      await log(
        "warn",
        "<all_urls> was already granted before this run — a previous run left it behind, and any S0.5 result recorded since then is void. Revoking first so the request path is genuinely exercised.",
      );
      await removeBroadHosts();
      containsBefore = await hasBroadHostAccess();
      await log("info", `permissions.contains() after pre-clean: ${containsBefore}`);
    }

    const effectBeforeGrant = await probeHostAccess("Before grant");
    await log(
      effectBeforeGrant.effect === "refused" ? "info" : "warn",
      effectBeforeGrant.detail,
    );
    if (effectBeforeGrant.effect === "allowed") {
      await log(
        "warn",
        "Scripting already works with no host permission — something else is granting access. The before/after comparison below cannot be trusted.",
      );
    }

    // Nothing slow may sit between here and request(): transient user
    // activation expires a few seconds after the click that started this run.
    const activation = userActivationState();
    await log(
      "info",
      `Calling permissions.request() — ${activation}. Chrome should show its own prompt now; approve it.`,
    );
    if (activation.includes("isActive=false")) {
      await log(
        "warn",
        "User activation has already expired before the request. If Chrome refuses below, that is this run's own setup cost, not a platform limit — press Run again.",
      );
    }

    const requestStartedAt = Date.now();
    let granted = false;
    let requestError: string | null = null;
    try {
      granted = await chrome.permissions.request({ origins: OPTIONAL_ORIGINS });
    } catch (error) {
      requestError = error instanceof Error ? error.message : String(error);
    }
    const promptDurationMs = Date.now() - requestStartedAt;
    const promptLikelyShown =
      requestError === null && promptDurationMs >= PROMPT_VISIBLE_THRESHOLD_MS;

    await patchPermissionsSpikeState({
      ...emptyState(),
      ranAt: new Date().toISOString(),
      ranIn: context,
      containsBefore,
      effectBeforeGrant: effectBeforeGrant.effect,
      granted: requestError === null ? granted : null,
      requestError,
      promptDurationMs,
      promptLikelyShown: requestError === null ? promptLikelyShown : null,
    });

    if (requestError !== null) {
      await log(
        "error",
        `permissions.request() threw after ${promptDurationMs} ms — ${requestError}`,
      );
      await log(
        "warn",
        /gesture|user activation/i.test(requestError)
          ? `Chrome refused the request for lack of user activation in the ${SPIKE_CONTEXT_LABELS[context]} realm. Try the other surface (options page vs side panel) and record which realms can host the Smart-mode permission prompt.`
          : "Chrome refused the request outright. Record the exact error — this decides whether Smart mode can ask for hosts at runtime at all.",
      );
      await finish("fail", log);
      return;
    }

    await log(
      granted ? "success" : "warn",
      `permissions.request() returned ${granted} after ${promptDurationMs} ms.`,
    );
    if (promptLikelyShown) {
      await log(
        "info",
        `Prompt was almost certainly shown: the call took ${promptDurationMs} ms, which is human-answer time.`,
      );
    } else {
      await log(
        "warn",
        `No prompt was shown: the call returned in ${promptDurationMs} ms, far too fast for a human to have answered. Chrome ${
          granted
            ? "granted without asking, which it does when the origin was approved earlier in this browser session — the grant is real but the prompt UX is untested"
            : "denied without asking, which usually means the call was not treated as user-initiated"
        }.`,
      );
    }

    const containsAfterGrant = await hasBroadHostAccess();
    await log(
      containsAfterGrant === granted ? "success" : "error",
      `permissions.contains() after request: ${containsAfterGrant}${
        containsAfterGrant === granted
          ? ""
          : ` — DISAGREES with the request() result (${granted}).`
      }`,
    );
    await patchPermissionsSpikeState({
      containsAfterGrant,
      stillGranted: containsAfterGrant,
    });

    if (!granted) {
      await log(
        "warn",
        "Nothing was granted, so grant behaviour is untested. This is a missing tester step, not a Chrome refusal: press Run again and click Allow in Chrome's prompt.",
      );
      await finish("blocked", log);
      return;
    }

    const effectAfterGrant = await probeHostAccess("After grant");
    await log(
      effectAfterGrant.effect === "allowed" ? "success" : "error",
      effectAfterGrant.detail,
    );
    await patchPermissionsSpikeState({ effectAfterGrant: effectAfterGrant.effect });

    if (effectAfterGrant.effect === "allowed") {
      await log(
        "success",
        "The grant took effect immediately in the calling document — no extension reload was needed.",
      );
    } else if (effectAfterGrant.effect === "refused") {
      await log(
        "error",
        "Permission is granted but scripting is still refused. That is the reload surprise this spike exists to catch — record it, then reload the extension and re-probe to confirm.",
      );
    }

    await log("info", "Revoking so the harness never leaves broad access behind…");
    const removal = await removeBroadHosts();
    const containsAfterRevoke = await hasBroadHostAccess();
    await patchPermissionsSpikeState({
      removed: removal.removed,
      removeError: removal.error,
      containsAfterRevoke,
      stillGranted: containsAfterRevoke,
    });

    if (removal.error) {
      await log("error", `permissions.remove() threw — ${removal.error}`);
    } else {
      await log(
        removal.removed ? "success" : "error",
        `permissions.remove() returned ${removal.removed}.`,
      );
    }
    await log(
      containsAfterRevoke ? "error" : "success",
      `permissions.contains() after revoke: ${containsAfterRevoke}`,
    );

    const effectAfterRevoke = await probeHostAccess("After revoke");
    await log(
      effectAfterRevoke.effect === "refused" ? "success" : "error",
      effectAfterRevoke.detail,
    );
    await patchPermissionsSpikeState({
      effectAfterRevoke: effectAfterRevoke.effect,
    });

    if (effectAfterRevoke.effect === "allowed") {
      await log(
        "error",
        "Scripting still works after revoke — access outlived the permission. Reload the extension and re-probe; if it persists, Smart-mode revocation is not trustworthy and must be escalated.",
      );
    }

    await log(
      "info",
      `permissions.onAdded fired: ${onAddedFired}; permissions.onRemoved fired: ${onRemovedFired}. Both also fire in the service worker — check the same log for the [Service worker] lines.`,
    );

    // A refused-after-grant or allowed-after-revoke reading is Chrome behaving
    // in a way the product cannot ship on. An inconclusive one only means the
    // window had no ordinary page to probe, which the tester can fix.
    const chromeMisbehaved =
      containsAfterRevoke ||
      !removal.removed ||
      effectAfterGrant.effect === "refused" ||
      effectAfterRevoke.effect === "allowed";

    if (chromeMisbehaved) {
      await finish("fail", log);
      return;
    }

    if (
      effectAfterGrant.effect === "inconclusive" ||
      effectAfterRevoke.effect === "inconclusive"
    ) {
      await log(
        "warn",
        "Grant and revoke both worked, but the scripting check had no clean tab to prove it against. Open a second ordinary https:// tab in this window — one that S0.5 never touched — and run again.",
      );
      await finish("blocked", log);
      return;
    }

    await finish("pass", log);
  } finally {
    chrome.permissions.onAdded.removeListener(onAdded);
    chrome.permissions.onRemoved.removeListener(onRemoved);
    await patchPermissionsSpikeState({ onAddedFired, onRemovedFired });
  }
}

/**
 * Last line of defence. Whatever happened above, the run does not end while
 * `<all_urls>` is still granted without saying so as loudly as possible.
 */
async function finish(
  status: "pass" | "fail" | "blocked",
  log: ReturnType<typeof createSpikeLogger>,
): Promise<void> {
  const stillGranted = await hasBroadHostAccess();
  await patchPermissionsSpikeState({ stillGranted });

  if (!stillGranted) {
    await log("info", "Final state: <all_urls> is revoked. S0.5 remains valid.");
    await setSpikeStatus(SPIKE_ID, status);
    return;
  }

  await removeBroadHosts();
  const afterRetry = await hasBroadHostAccess();
  await patchPermissionsSpikeState({ stillGranted: afterRetry });

  if (!afterRetry) {
    await log(
      "warn",
      "Final state: <all_urls> was still granted and had to be revoked by the cleanup pass. Check the log above for where the revoke was skipped.",
    );
    await setSpikeStatus(SPIKE_ID, status);
    return;
  }

  await log(
    "error",
    "STOP: <all_urls> is STILL GRANTED. Every S0.5 result recorded from now on is meaningless, because scripting will succeed on any tab. Revoke it at chrome://extensions → PromptAhead Spikes → Details → Site access → \u201cOn click\u201d before doing anything else.",
  );
  await setSpikeStatus(SPIKE_ID, "fail");
}
