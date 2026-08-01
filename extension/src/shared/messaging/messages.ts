/**
 * Typed contracts for everything the side panel, options page and content
 * script send to the service worker. The UI never touches `chrome.storage`
 * or the page DOM directly — it asks the background for both.
 */

import type { PageContext } from "../types/page-context";
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
  | { type: "CLEAR_ALL_DATA" }
  /** Whatever the last gesture extracted for this tab, if anything. */
  | { type: "GET_LATEST_PAGE_CONTEXT"; tabId?: number }
  /** Re-runs extraction on a tab the current gesture still has access to. */
  | { type: "EXTRACT_ACTIVE_TAB"; tabId?: number }
  | { type: "OPEN_SIDE_PANEL"; tabId?: number };

export type BackgroundRequestType = BackgroundRequest["type"];

type OkPayloads = {
  PING: { pong: true };
  GET_SETTINGS: { settings: Settings };
  SET_SETTINGS: { settings: Settings };
  GET_ONBOARDING: { onboarding: OnboardingState };
  SET_ONBOARDING: { onboarding: OnboardingState };
  GET_RECENT_HISTORY: { history: RecentHistory };
  ADD_RECENT_PROMPT: { entry: PromptHistoryEntry; history: RecentHistory };
  CLEAR_ALL_DATA: { cleared: true };
  /** `error` explains an empty context (restricted page, revoked access). */
  GET_LATEST_PAGE_CONTEXT: { pageContext: PageContext | null; error?: string };
  EXTRACT_ACTIVE_TAB: { pageContext: PageContext };
  OPEN_SIDE_PANEL: { opened: true };
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
  "CLEAR_ALL_DATA",
  "GET_LATEST_PAGE_CONTEXT",
  "EXTRACT_ACTIVE_TAB",
  "OPEN_SIDE_PANEL",
];

const REQUEST_TYPES: ReadonlySet<string> = new Set(BACKGROUND_REQUEST_TYPES);

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
