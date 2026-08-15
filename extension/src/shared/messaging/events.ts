/**
 * One-way events the service worker pushes to open extension pages
 * (side panel, options). Not request/response — the panel listens and reacts.
 */

import type { PageContext } from "../types/page-context";
import { isPageContext } from "../types/page-context";
import type { SensitiveCategory } from "../../domain/sensitive";

export type PageContextClearedReason = "navigated" | "closed" | "cleared";

const SENSITIVE_CATEGORIES: ReadonlySet<string> = new Set([
  "banking",
  "payment",
  "email",
  "login",
  "medical",
  "sensitive_input",
  "restricted_origin",
  "private_workspace",
]);

export type BackgroundEvent =
  | {
      type: "PAGE_CONTEXT_CLEARED";
      tabId: number;
      reason: PageContextClearedReason;
    }
  | {
      type: "PAGE_CONTEXT_UPDATED";
      tabId: number;
      pageContext: PageContext;
      /** Why this capture was pushed — panel gates selection/navigation auto-apply. */
      source?: "gesture" | "selection" | "navigation";
    }
  | {
      type: "SENSITIVE_PAGE_BLOCKED";
      tabId: number;
      category: SensitiveCategory;
      reason: string;
      url?: string;
    };

export const BACKGROUND_EVENT_TYPES = [
  "PAGE_CONTEXT_CLEARED",
  "PAGE_CONTEXT_UPDATED",
  "SENSITIVE_PAGE_BLOCKED",
] as const;

const EVENT_TYPES: ReadonlySet<string> = new Set(BACKGROUND_EVENT_TYPES);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBackgroundEvent(value: unknown): value is BackgroundEvent {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return false;
  }
  if (!EVENT_TYPES.has(value.type)) {
    return false;
  }
  if (value.type === "PAGE_CONTEXT_CLEARED") {
    return (
      typeof value.tabId === "number" &&
      (value.reason === "navigated" ||
        value.reason === "closed" ||
        value.reason === "cleared")
    );
  }
  if (value.type === "PAGE_CONTEXT_UPDATED") {
    const sourceOk =
      value.source === undefined ||
      value.source === "gesture" ||
      value.source === "selection" ||
      value.source === "navigation";
    return (
      typeof value.tabId === "number" &&
      isPageContext(value.pageContext) &&
      sourceOk
    );
  }
  if (value.type === "SENSITIVE_PAGE_BLOCKED") {
    return (
      typeof value.tabId === "number" &&
      typeof value.category === "string" &&
      SENSITIVE_CATEGORIES.has(value.category) &&
      typeof value.reason === "string" &&
      (value.url === undefined || typeof value.url === "string")
    );
  }
  return false;
}

/**
 * Fire-and-forget push to open extension pages. Fails quietly when nothing
 * is listening (panel closed) — that is the expected case most of the time.
 */
export function broadcastBackgroundEvent(event: BackgroundEvent): void {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
    return;
  }
  try {
    const result: unknown = chrome.runtime.sendMessage(event);
    if (
      result !== undefined &&
      result !== null &&
      typeof (result as Promise<unknown>).then === "function"
    ) {
      void (result as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // No receiving end.
  }
}
