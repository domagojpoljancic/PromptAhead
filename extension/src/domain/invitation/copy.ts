/**
 * Deterministic invite copy by page type (handoff §32).
 * Shown before Nano runs — no page-content personalization.
 */

import type { PageType } from "../../shared/types/page-context";

export const INVITE_COPY: Readonly<Record<PageType, string>> = {
  article: "Want to take this story further?",
  product: "Still considering it? PromptAhead can help investigate.",
  generic: "There may be a useful next question here.",
};

export function inviteCopyFor(pageType: PageType): string {
  return INVITE_COPY[pageType];
}
