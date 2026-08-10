/**
 * Manual-mode extraction, driven from the service worker.
 *
 * Locked S0.5 pattern: injection happens while the `activeTab` grant from a
 * toolbar / context-menu / keyboard gesture is still fresh. The panel may ask
 * for the same tab again until it navigates; after that Chrome refuses and the
 * user has to invoke PromptAhead again.
 */

import { executeScriptInTab, isInjectableUrl } from "../shared/chrome";
import {
  RAW_SNAPSHOT_LIMITS,
  buildPageContextWithReason,
  collectPageSnapshotInPage,
  type PageContext,
  type SnapshotCollectionResult,
  type SnapshotLimits,
} from "../domain/extraction";
import { assessUrlPromptValue } from "../domain/page-value";

export type ExtractionOutcome =
  { ok: true; pageContext: PageContext; reason: string } | { ok: false; error: string };

export const RESTRICTED_PAGE_ERROR =
  "PromptAhead can't read this page — Chrome blocks extensions on chrome://, the Web Store and other internal pages.";

export const ACCESS_LOST_ERROR =
  "PromptAhead no longer has access to this tab. Chrome revokes it when the page navigates — click the PromptAhead icon on the page again.";

/** App/editor hosts: capture selection (+ title/url) only — never body text. */
export const SELECTION_ONLY_SNAPSHOT_LIMITS: SnapshotLimits = {
  ...RAW_SNAPSHOT_LIMITS,
  headings: 0,
  textBlocks: 0,
  specCandidates: 0,
  jsonLdBlocks: 0,
};

const ACCESS_ERROR_PATTERN =
  /must request permission|cannot access|no tab with id|extension manifest/i;

function describeInjectionFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return ACCESS_ERROR_PATTERN.test(message) ? ACCESS_LOST_ERROR : message;
}

function snapshotLimitsForUrl(knownUrl?: string): SnapshotLimits {
  if (
    knownUrl !== undefined &&
    assessUrlPromptValue(knownUrl).reason === "app-or-editor"
  ) {
    return SELECTION_ONLY_SNAPSHOT_LIMITS;
  }
  return RAW_SNAPSHOT_LIMITS;
}

export async function extractPageContextForTab(
  tabId: number,
  knownUrl?: string,
): Promise<ExtractionOutcome> {
  // Only refuse on a URL we actually know: without an `activeTab` grant Chrome
  // hides it, and a missing URL must not be mistaken for a restricted page.
  if (knownUrl !== undefined && !isInjectableUrl(knownUrl)) {
    return { ok: false, error: RESTRICTED_PAGE_ERROR };
  }

  let result: SnapshotCollectionResult | null;
  try {
    result = await executeScriptInTab<[SnapshotLimits], SnapshotCollectionResult>(
      tabId,
      collectPageSnapshotInPage,
      [snapshotLimitsForUrl(knownUrl)],
    );
  } catch (error) {
    return { ok: false, error: describeInjectionFailure(error) };
  }

  if (!result) {
    return { ok: false, error: "The page returned no content to extract." };
  }
  if (!result.ok) {
    return { ok: false, error: `Extraction failed in the page: ${result.error}` };
  }

  const { pageContext, classification } = buildPageContextWithReason(result.snapshot);
  return { ok: true, pageContext, reason: classification.reason };
}
