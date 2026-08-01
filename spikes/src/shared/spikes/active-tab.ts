import { appendSpikeLog, setSpikeStatus } from "../logging/spike-log";
import type { SpikeId } from "./types";

/**
 * S0.5 — Manual `activeTab`.
 *
 * The product question: can Manual mode extract a page using only `activeTab`
 * (no persistent host permissions), and does that grant survive long enough for
 * the side panel to re-script the same tab later without a fresh gesture?
 *
 * Chrome only grants `activeTab` from an extension gesture it owns: toolbar
 * action click, context-menu click, or a keyboard command. Clicks inside the
 * side panel are NOT such a gesture, so every gesture path here extracts from
 * the service worker while the grant is fresh, then hands the page context to
 * the panel through `chrome.storage.local`.
 */

const SPIKE_ID: SpikeId = "S0.5";

export const ACTIVE_TAB_STATE_STORAGE_KEY = "spikes.s05.activeTab.v1";

const EXCERPT_CHAR_LIMIT = 500;

export type ManualGesture = "action-click" | "context-menu" | "keyboard-command";

export interface ExtractedPageInfo {
  title: string;
  url: string;
  hostname: string;
  excerpt: string;
  excerptChars: number;
  truncated: boolean;
}

export interface GestureExtractionRecord {
  gesture: ManualGesture;
  tabId: number;
  extractedAt: string;
  durationMs: number;
  page: ExtractedPageInfo;
}

export interface FollowUpRecord {
  attemptedAt: string;
  targetTabId: number;
  sameTabAsGesture: boolean;
  navigatedSinceGesture: boolean;
  succeeded: boolean;
  error?: string;
  page?: ExtractedPageInfo;
}

export interface NavigationRecord {
  at: string;
  tabId: number;
  url?: string;
  reason: "navigated" | "closed";
}

export interface ActiveTabSpikeState {
  lastGestureExtraction: GestureExtractionRecord | null;
  lastFollowUp: FollowUpRecord | null;
  navigationSinceGrant: NavigationRecord | null;
}

function emptyState(): ActiveTabSpikeState {
  return {
    lastGestureExtraction: null,
    lastFollowUp: null,
    navigationSinceGrant: null,
  };
}

export async function getActiveTabSpikeState(): Promise<ActiveTabSpikeState> {
  const stored = await chrome.storage.local.get(ACTIVE_TAB_STATE_STORAGE_KEY);
  const existing = stored[ACTIVE_TAB_STATE_STORAGE_KEY] as
    ActiveTabSpikeState | undefined;
  return { ...emptyState(), ...existing };
}

async function patchActiveTabSpikeState(
  patch: Partial<ActiveTabSpikeState>,
): Promise<ActiveTabSpikeState> {
  const next = { ...(await getActiveTabSpikeState()), ...patch };
  await chrome.storage.local.set({ [ACTIVE_TAB_STATE_STORAGE_KEY]: next });
  return next;
}

export async function clearActiveTabSpikeState(): Promise<void> {
  await chrome.storage.local.set({
    [ACTIVE_TAB_STATE_STORAGE_KEY]: emptyState(),
  });
}

/**
 * Runs inside the page. Must stay self-contained: it is serialized by
 * `chrome.scripting.executeScript`, so it can only use its arguments and page
 * globals. Form controls are excluded so no field values are ever read.
 */
function extractCompactPageInfo(maxChars: number): ExtractedPageInfo {
  const excludedAncestors =
    "form, input, textarea, select, option, button, script, style, noscript, template";
  const root = document.body ?? document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let total = 0;

  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!parent || parent.closest(excludedAncestors)) {
      continue;
    }
    const text = (walker.currentNode.nodeValue ?? "").replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    parts.push(text);
    total += text.length + 1;
    if (total > maxChars) {
      break;
    }
  }

  const joined = parts.join(" ");
  const excerpt = joined.slice(0, maxChars);

  return {
    title: document.title,
    url: location.href,
    hostname: location.hostname,
    excerpt,
    excerptChars: excerpt.length,
    truncated: joined.length > excerpt.length,
  };
}

interface InjectionAttempt {
  succeeded: boolean;
  page?: ExtractedPageInfo;
  error?: string;
  durationMs: number;
}

async function injectExtractor(tabId: number): Promise<InjectionAttempt> {
  const startedAt = Date.now();
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractCompactPageInfo,
      args: [EXCERPT_CHAR_LIMIT],
    });
    const page = injection?.result;
    if (!page) {
      throw new Error("Injection returned no result.");
    }
    return { succeeded: true, page, durationMs: Date.now() - startedAt };
  } catch (error) {
    return {
      succeeded: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function describePage(page: ExtractedPageInfo): string {
  return `${page.hostname} · "${page.title}" · ${page.excerptChars} chars${
    page.truncated ? " (truncated)" : ""
  }`;
}

/**
 * Called from a gesture handler in the service worker while the `activeTab`
 * grant is fresh. This is the pattern Manual mode is expected to ship with.
 */
export async function runGestureExtraction(
  tabId: number,
  gesture: ManualGesture,
): Promise<void> {
  await setSpikeStatus(SPIKE_ID, "running");
  await appendSpikeLog(
    SPIKE_ID,
    "info",
    `Gesture "${gesture}" on tab ${tabId} — injecting extractor with activeTab only (no host_permissions).`,
  );

  const attempt = await injectExtractor(tabId);

  if (!attempt.succeeded || !attempt.page) {
    await appendSpikeLog(
      SPIKE_ID,
      "error",
      `Gesture extraction failed: ${attempt.error ?? "unknown error"}`,
    );
    await setSpikeStatus(SPIKE_ID, "fail");
    return;
  }

  const record: GestureExtractionRecord = {
    gesture,
    tabId,
    extractedAt: new Date().toISOString(),
    durationMs: attempt.durationMs,
    page: attempt.page,
  };

  await patchActiveTabSpikeState({
    lastGestureExtraction: record,
    lastFollowUp: null,
    navigationSinceGrant: null,
  });

  await appendSpikeLog(
    SPIKE_ID,
    "success",
    `Extracted on gesture in ${attempt.durationMs} ms — ${describePage(attempt.page)}`,
  );
  await appendSpikeLog(
    SPIKE_ID,
    "info",
    'Next: press "Run panel follow-up" below to test panel-driven re-scripting without a new gesture.',
  );
  await setSpikeStatus(SPIKE_ID, "idle");
}

async function warnIfBroadHostsGranted(): Promise<void> {
  const hasBroadHosts = await chrome.permissions.contains({
    origins: ["<all_urls>"],
  });
  if (hasBroadHosts) {
    await appendSpikeLog(
      SPIKE_ID,
      "warn",
      "Optional <all_urls> is currently GRANTED (from S0.6). Injection may succeed for that reason, not because of activeTab — revoke it before trusting this result.",
    );
  }
}

/**
 * Panel-driven follow-up: the key question of S0.5. This runs in the service
 * worker in response to a side-panel click, i.e. deliberately outside any
 * `activeTab`-granting gesture.
 *
 * Status semantics for this spike: `pass` = observed behavior matches the
 * documented Chrome expectation for the current state, `fail` = surprising
 * result that needs a product decision, `blocked` = prerequisite missing.
 */
export async function runManualActiveTabSpike(spikeId: SpikeId): Promise<void> {
  await setSpikeStatus(spikeId, "running");
  await warnIfBroadHostsGranted();

  const state = await getActiveTabSpikeState();
  const gestureRecord = state.lastGestureExtraction;

  if (!gestureRecord) {
    await appendSpikeLog(
      spikeId,
      "warn",
      "No gesture extraction recorded yet. Click the toolbar action (or use the context menu / keyboard shortcut) on a normal http(s) page first.",
    );
    await setSpikeStatus(spikeId, "blocked");
    return;
  }

  const navigated = state.navigationSinceGrant;
  await appendSpikeLog(
    spikeId,
    "info",
    `Follow-up attempt from the side panel (no new gesture) on tab ${gestureRecord.tabId}, granted at ${gestureRecord.extractedAt} via ${gestureRecord.gesture}.`,
  );
  if (navigated) {
    await appendSpikeLog(
      spikeId,
      "info",
      `Tab ${navigated.tabId} ${navigated.reason} at ${navigated.at}${
        navigated.url ? ` (${navigated.url})` : ""
      } — Chrome should have revoked the activeTab grant.`,
    );
  }

  const attempt = await injectExtractor(gestureRecord.tabId);

  const followUp: FollowUpRecord = {
    attemptedAt: new Date().toISOString(),
    targetTabId: gestureRecord.tabId,
    sameTabAsGesture: true,
    navigatedSinceGesture: Boolean(navigated),
    succeeded: attempt.succeeded,
    error: attempt.error,
    page: attempt.page,
  };
  await patchActiveTabSpikeState({ lastFollowUp: followUp });

  if (attempt.succeeded && attempt.page) {
    await appendSpikeLog(
      spikeId,
      "success",
      `Panel follow-up SUCCEEDED without a new gesture — ${describePage(attempt.page)}`,
    );
    if (navigated) {
      await appendSpikeLog(
        spikeId,
        "warn",
        "Unexpected: injection still works after the tab navigated. Re-check whether a broad host permission is active.",
      );
    } else {
      await appendSpikeLog(
        spikeId,
        "info",
        "Implication: the panel can re-fetch page context on the same tab until navigation — but the first extraction must still come from a gesture.",
      );
    }
  } else {
    await appendSpikeLog(
      spikeId,
      navigated ? "success" : "error",
      `Panel follow-up FAILED: ${attempt.error ?? "unknown error"}`,
    );
    await appendSpikeLog(
      spikeId,
      "info",
      navigated
        ? "Expected: navigation revoked the grant. Manual mode must ask the user to invoke the action again."
        : "Implication: activeTab does not survive panel-driven calls. Manual mode must extract everything it needs during the gesture.",
    );
  }

  await probeOtherTab(spikeId, gestureRecord.tabId);

  const matchedExpectation = navigated ? !attempt.succeeded : attempt.succeeded;
  await setSpikeStatus(spikeId, matchedExpectation ? "pass" : "fail");
}

/**
 * Control check: a tab that never had a gesture should never be injectable.
 * If it is, some broad host permission is in play and the S0.5 result is void.
 */
async function probeOtherTab(spikeId: SpikeId, grantedTabId: number): Promise<void> {
  // The granted tab is usually still the active one while the panel is open,
  // so fall back to any other tab in the window.
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const otherTab = tabs.find((tab) => tab.id !== undefined && tab.id !== grantedTabId);

  if (!otherTab?.id) {
    await appendSpikeLog(
      spikeId,
      "info",
      "Control check skipped: no second tab open to verify that access is scoped to the granted tab.",
    );
    return;
  }

  const attempt = await injectExtractor(otherTab.id);
  if (attempt.succeeded) {
    await appendSpikeLog(
      spikeId,
      "warn",
      `Control check: injection into never-granted tab ${otherTab.id} SUCCEEDED — a broad host permission is active, results above are not activeTab-only.`,
    );
    return;
  }

  await appendSpikeLog(
    spikeId,
    "info",
    `Control check: injection into never-granted tab ${otherTab.id} was refused as expected (${attempt.error ?? "no error message"}). A restricted page would refuse for other reasons, so use a normal http(s) tab.`,
  );
}

export async function noteGrantedTabNavigation(
  tabId: number,
  url: string | undefined,
  reason: NavigationRecord["reason"],
): Promise<void> {
  const state = await getActiveTabSpikeState();
  const granted = state.lastGestureExtraction;
  if (!granted || granted.tabId !== tabId || state.navigationSinceGrant) {
    return;
  }

  // A urlless "loading" tick right after the gesture is usually the page the
  // user extracted still settling, not a navigation away from it.
  const sinceGrant = Date.now() - new Date(granted.extractedAt).getTime();
  if (!url && reason === "navigated" && sinceGrant < 1000) {
    return;
  }

  const record: NavigationRecord = {
    at: new Date().toISOString(),
    tabId,
    url,
    reason,
  };
  await patchActiveTabSpikeState({ navigationSinceGrant: record });
  await appendSpikeLog(
    SPIKE_ID,
    "info",
    `Granted tab ${tabId} ${reason}${url ? ` → ${url}` : ""}. Run the follow-up again to confirm the grant is revoked.`,
  );
}
