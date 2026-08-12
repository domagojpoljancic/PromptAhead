/**
 * Origins where Smart engagement must never run (handoff §9 / §10 technical
 * restrictions) plus the usefulness gate (DOM-60) and sensitive-page URL
 * auto-block (DOM-37). Full DOM sensitive checks run when the tracker starts.
 */

import { assessUrlPromptValue } from "../page-value";
import { assessUrlSensitivity } from "../sensitive";

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
 * engagement listeners once Smart host permission is granted, looks worth
 * prompting from, and is not a sensitive URL surface.
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

  if (assessUrlSensitivity(url).blocked) {
    return false;
  }

  return assessUrlPromptValue(url).worthPrompting;
}
