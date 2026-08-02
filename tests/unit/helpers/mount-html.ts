/**
 * Mount extension HTML into the Vitest jsdom document for click-through tests.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_SRC = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "extension",
  "src",
);

export function mountExtensionHtml(
  relativePath: "sidepanel/index.html" | "options/index.html",
): void {
  const html = readFileSync(join(EXTENSION_SRC, relativePath), "utf8");
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  document.head.replaceChildren(...Array.from(doc.head.childNodes));
  document.body.replaceChildren(...Array.from(doc.body.childNodes));
  // Drop script tags — tests call init* explicitly.
  for (const script of document.querySelectorAll("script")) {
    script.remove();
  }
}

export function click(selector: string): void {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) {
    throw new Error(`click: missing ${selector}`);
  }
  el.click();
}

export function isVisible(selector: string): boolean {
  const el = document.querySelector(selector);
  return Boolean(el && !el.hasAttribute("hidden"));
}

export function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}

export async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
