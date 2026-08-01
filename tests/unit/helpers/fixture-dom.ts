/**
 * Runs the injected snapshot collector against an HTML fixture.
 *
 * `collectPageSnapshotInPage` only sees page globals in Chrome, so the harness
 * installs a jsdom document/location for the duration of the call. That keeps
 * the tested function byte-identical to the one Chrome stringifies.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

import {
  RAW_SNAPSHOT_LIMITS,
  collectPageSnapshotInPage,
  type RawPageSnapshot,
} from "../../../extension/src/domain/extraction";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "html",
);

type PageGlobals = {
  document?: Document;
  location?: Location;
  window?: Window & typeof globalThis;
};

export function readFixture(name: string): string {
  return readFileSync(join(FIXTURE_DIR, `${name}.html`), "utf8");
}

export function snapshotFromHtml(
  html: string,
  url: string,
  collector: typeof collectPageSnapshotInPage = collectPageSnapshotInPage,
): RawPageSnapshot {
  const dom = new JSDOM(html, { url });
  const scope = globalThis as PageGlobals;
  const previous: PageGlobals = {
    document: scope.document,
    location: scope.location,
    window: scope.window,
  };

  scope.document = dom.window.document as unknown as Document;
  scope.location = dom.window.location as unknown as Location;
  scope.window = dom.window as unknown as Window & typeof globalThis;

  try {
    const result = collector(RAW_SNAPSHOT_LIMITS);
    if (!result.ok) {
      throw new Error(`Snapshot collection failed: ${result.error}`);
    }
    return result.snapshot;
  } finally {
    scope.document = previous.document;
    scope.location = previous.location;
    scope.window = previous.window;
    dom.window.close();
  }
}

export function snapshotFromFixture(name: string, url: string): RawPageSnapshot {
  return snapshotFromHtml(readFixture(name), url);
}
