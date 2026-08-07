/**
 * Badge-first invite surface (handoff §32 / spike S0.7).
 * Pure payload — service worker applies via `chrome.action.setBadge*`.
 * System notifications stay optional and deferred.
 */

import type { PageType } from "../../shared/types/page-context";
import { inviteCopyFor } from "./copy";

export type InviteBadgePayload = {
  /** Compact action badge text (Chrome truncates aggressively). */
  text: string;
  /** Tooltip / title — full deterministic invite copy. */
  title: string;
  backgroundColor: string;
};

const BADGE_BACKGROUND = "#1a5f4a";

export function inviteBadgeFor(pageType: PageType): InviteBadgePayload {
  return {
    text: "!",
    title: inviteCopyFor(pageType),
    backgroundColor: BADGE_BACKGROUND,
  };
}

export function clearInviteBadgePayload(): InviteBadgePayload {
  return {
    text: "",
    title: "PromptAhead",
    backgroundColor: BADGE_BACKGROUND,
  };
}
