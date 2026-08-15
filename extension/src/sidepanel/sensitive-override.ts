/**
 * Manual sensitive-page override overlay (DOM-39).
 * Blocking confirm only — never “remember forever”.
 */

import {
  sensitiveOverrideCopy,
  type SensitiveCategory,
} from "../domain/sensitive";

export type SensitiveOverrideShow = {
  tabId: number;
  category: SensitiveCategory;
  url?: string;
};

function setHidden(el: Element | null, hidden: boolean): void {
  if (!el) {
    return;
  }
  if (hidden) {
    el.setAttribute("hidden", "");
  } else {
    el.removeAttribute("hidden");
  }
}

export function isSensitiveOverrideVisible(): boolean {
  const root = document.getElementById("sensitive-override");
  return Boolean(root && !root.hasAttribute("hidden"));
}

export function hideSensitiveOverride(): void {
  setHidden(document.getElementById("sensitive-override"), true);
  document.body.classList.remove("sensitive-override-active");
}

export function showSensitiveOverride(detail: SensitiveOverrideShow): void {
  const copy = sensitiveOverrideCopy(detail.category);
  const title = document.getElementById("sensitive-override-title");
  const lead = document.getElementById("sensitive-override-lead");
  const what = document.getElementById("sensitive-override-what");
  const urlEl = document.getElementById("sensitive-override-url");

  if (title) {
    title.textContent = copy.title;
  }
  if (lead) {
    lead.textContent = copy.lead;
  }
  if (what) {
    what.textContent = copy.whatWillBeRead;
  }
  if (urlEl) {
    if (detail.url) {
      urlEl.textContent = detail.url;
      setHidden(urlEl, false);
    } else {
      urlEl.textContent = "";
      setHidden(urlEl, true);
    }
  }

  setHidden(document.getElementById("sensitive-override"), false);
  document.body.classList.add("sensitive-override-active");
}
