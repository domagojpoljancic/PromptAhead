/**
 * Typed contracts for everything the side panel, options page and content
 * script send to the service worker. The UI never touches `chrome.storage`
 * or the page DOM directly — it asks the background for both.
 */

import type { PageContext, PageType } from "../types/page-context";
import type {
  DestinationId,
  OnboardingPatch,
  OnboardingState,
  PromptHistoryEntry,
  RecentHistory,
  Settings,
  SettingsPatch,
} from "../storage/schema";
import { isDestinationId } from "../storage/schema";

export type AddRecentPromptPayload = {
  title: string;
  url: string;
  prompt: string;
  destination: DestinationId;
};

export type InviteActionKind = "accept" | "dismiss" | "snooze" | "disable_domain";

export type BackgroundRequest =
  /** Liveness probe — cheapest proof the router is wired up. */
  | { type: "PING" }
  | { type: "GET_SETTINGS" }
  | { type: "SET_SETTINGS"; patch: SettingsPatch }
  | { type: "GET_ONBOARDING" }
  | { type: "SET_ONBOARDING"; patch: OnboardingPatch }
  | { type: "GET_RECENT_HISTORY" }
  /** Append a copied prompt to `history.recent.v1` (UI never writes storage). */
  | { type: "ADD_RECENT_PROMPT"; entry: AddRecentPromptPayload }
  /** Empty `history.recent.v1` only (settings / learning untouched). */
  | { type: "CLEAR_RECENT_HISTORY" }
  /** Wipe `learning.aggregates.v1` (unused until M3; still clearable). */
  | { type: "CLEAR_LEARNED_PREFS" }
  | { type: "CLEAR_ALL_DATA" }
  /** Whatever the last gesture extracted for this tab, if anything. */
  | { type: "GET_LATEST_PAGE_CONTEXT"; tabId?: number }
  /** Re-runs extraction on a tab the current gesture still has access to. */
  | { type: "EXTRACT_ACTIVE_TAB"; tabId?: number }
  | { type: "OPEN_SIDE_PANEL"; tabId?: number }
  /** Content-script engagement threshold → SW invite machine (DOM-34). */
  | {
      type: "ENGAGEMENT_THRESHOLD";
      pageType: PageType;
      url: string;
      reason: string;
      tabId?: number;
    }
  /** Accept / dismiss / snooze / disable the active badge invite. */
  | { type: "INVITE_ACTION"; action: InviteActionKind; tabId?: number };

export type BackgroundRequestType = BackgroundRequest["type"];

type OkPayloads = {
  PING: { pong: true };
  GET_SETTINGS: { settings: Settings };
  SET_SETTINGS: { settings: Settings };
  GET_ONBOARDING: { onboarding: OnboardingState };
  SET_ONBOARDING: { onboarding: OnboardingState };
  GET_RECENT_HISTORY: { history: RecentHistory };
  ADD_RECENT_PROMPT: { entry: PromptHistoryEntry; history: RecentHistory };
  CLEAR_RECENT_HISTORY: { history: RecentHistory };
  CLEAR_LEARNED_PREFS: { cleared: true };
  CLEAR_ALL_DATA: { cleared: true; settings: Settings; onboarding: OnboardingState };
  /** `error` explains an empty context (restricted page, revoked access). */
  GET_LATEST_PAGE_CONTEXT: {
    pageContext: PageContext | null;
    error?: string;
    /** Tab the panel should bind stale-context UX to. */
    tabId?: number;
  };
  EXTRACT_ACTIVE_TAB: { pageContext: PageContext; tabId: number };
  OPEN_SIDE_PANEL: { opened: true };
  ENGAGEMENT_THRESHOLD: {
    handled: boolean;
    showBadge: boolean;
    phase: string | null;
    suppression: string | null;
  };
  INVITE_ACTION: {
    handled: boolean;
    clearBadge: boolean;
    openPanelAndAnalyze: boolean;
    phase: string | null;
  };
};

export type BackgroundOk<K extends BackgroundRequestType = BackgroundRequestType> =
  K extends BackgroundRequestType ? { ok: true; type: K } & OkPayloads[K] : never;

export type BackgroundError = {
  ok: false;
  type: BackgroundRequestType | "UNKNOWN";
  error: string;
};

export type BackgroundResponse = BackgroundOk | BackgroundError;

export type ResponseFor<R extends BackgroundRequest> =
  BackgroundOk<R["type"]> | BackgroundError;

export const BACKGROUND_REQUEST_TYPES: readonly BackgroundRequestType[] = [
  "PING",
  "GET_SETTINGS",
  "SET_SETTINGS",
  "GET_ONBOARDING",
  "SET_ONBOARDING",
  "GET_RECENT_HISTORY",
  "ADD_RECENT_PROMPT",
  "CLEAR_RECENT_HISTORY",
  "CLEAR_LEARNED_PREFS",
  "CLEAR_ALL_DATA",
  "GET_LATEST_PAGE_CONTEXT",
  "EXTRACT_ACTIVE_TAB",
  "OPEN_SIDE_PANEL",
  "ENGAGEMENT_THRESHOLD",
  "INVITE_ACTION",
];

const REQUEST_TYPES: ReadonlySet<string> = new Set(BACKGROUND_REQUEST_TYPES);

const INVITE_ACTIONS: ReadonlySet<string> = new Set([
  "accept",
  "dismiss",
  "snooze",
  "disable_domain",
]);

const PAGE_TYPES: ReadonlySet<string> = new Set(["article", "product", "generic"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOptionalTabId(value: Record<string, unknown>): boolean {
  return value.tabId === undefined || typeof value.tabId === "number";
}

/**
 * Messages arrive from other extension contexts, so treat them as untrusted:
 * the discriminant must be known and the payload shaped as declared.
 */
export function isBackgroundRequest(value: unknown): value is BackgroundRequest {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return false;
  }
  if (!REQUEST_TYPES.has(value.type)) {
    return false;
  }

  switch (value.type) {
    case "SET_SETTINGS":
    case "SET_ONBOARDING":
      return isPlainObject(value.patch);
    case "ADD_RECENT_PROMPT":
      return isAddRecentPromptPayload(value.entry);
    case "GET_LATEST_PAGE_CONTEXT":
    case "EXTRACT_ACTIVE_TAB":
    case "OPEN_SIDE_PANEL":
      return hasOptionalTabId(value);
    case "ENGAGEMENT_THRESHOLD":
      return (
        typeof value.url === "string" &&
        typeof value.reason === "string" &&
        typeof value.pageType === "string" &&
        PAGE_TYPES.has(value.pageType) &&
        hasOptionalTabId(value)
      );
    case "INVITE_ACTION":
      return (
        typeof value.action === "string" &&
        INVITE_ACTIONS.has(value.action) &&
        hasOptionalTabId(value)
      );
    default:
      return true;
  }
}

function isAddRecentPromptPayload(value: unknown): value is AddRecentPromptPayload {
  if (!isPlainObject(value)) {
    return false;
  }
  return (
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    typeof value.prompt === "string" &&
    isDestinationId(value.destination)
  );
}

export function isBackgroundResponse(value: unknown): value is BackgroundResponse {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return false;
  }
  if (value.ok === true) {
    return REQUEST_TYPES.has(value.type);
  }
  return value.ok === false && typeof value.error === "string";
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" ? error : "Unknown background error";
}
