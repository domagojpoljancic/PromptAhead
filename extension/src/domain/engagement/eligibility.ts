/**
 * Origins where Smart engagement must never run (handoff §9 / §10 technical
 * restrictions). Full sensitive-page heuristics are separate; this is the
 * hard URL gate so the tracker does not even start. Also respects the
 * usefulness gate (DOM-60) so homepages / editors / listings never invite.
 */

import { assessUrlPromptValue } from "../page-value";

const DISALLOWED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-search:",
  "chrome-untrusted:",
  "devtools:",
  "edge:",
  "brave:",
  "about:",
  "view-source:",
  "data:",
  "blob:",
  "file:",
  "javascript:",
]);

/**
 * True when the page URL is a normal http(s) document that may receive
 * engagement listeners once Smart host permission is granted, and the URL
 * looks worth prompting from (not app/editor, homepage, or listing).
 */
export function isEngagementEligibleUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (DISALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return false;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }

  return assessUrlPromptValue(url).worthPrompting;
}
