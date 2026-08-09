/**
 * In-page selection watcher (DOM-61).
 *
 * Injected via `chrome.scripting.executeScript` after Manual shows the
 * low-value empty state. Must stay self-contained inside each exported
 * function (no free variables) — same constraint as `collectPageSnapshotInPage`.
 */

export type SelectionWatchInstallResult = {
  watching: boolean;
  /** True when a previous install was already active. */
  already: boolean;
};

export type SelectionWatchOptions = {
  debounceMs: number;
  /** Ignore tiny accidental selections. */
  minChars: number;
};

/**
 * Start (or no-op if already running). Sends `{ type: "SELECTION_READY" }` to
 * the extension when a stable non-empty selection appears.
 */
export function installSelectionWatchInPage(
  options: SelectionWatchOptions,
): SelectionWatchInstallResult {
  const FLAG = "__promptaheadSelectionWatch";
  type WatchState = { stop: () => void; lastSent: string };
  const win = window as unknown as Window & Record<string, WatchState | undefined>;
  const existing = win[FLAG];
  if (existing) {
    return { watching: true, already: true };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = "";

  const normalize = (value: string): string =>
    value.replace(/\s+/g, " ").trim();

  const stop = (): void => {
    document.removeEventListener("selectionchange", onSelectionChange);
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    delete win[FLAG];
  };

  const notify = (): void => {
    const text = normalize(window.getSelection()?.toString() ?? "");
    if (text.length < options.minChars || text === lastSent) {
      return;
    }
    lastSent = text;
    try {
      void chrome.runtime.sendMessage({
        type: "SELECTION_READY",
        textLength: text.length,
      });
    } catch {
      stop();
    }
  };

  function onSelectionChange(): void {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      notify();
    }, options.debounceMs);
  }

  document.addEventListener("selectionchange", onSelectionChange, {
    passive: true,
  });
  win[FLAG] = { stop, lastSent };

  // Selection may already exist when the empty state appears.
  notify();

  return { watching: true, already: false };
}

/** Tear down the watcher if present. */
export function stopSelectionWatchInPage(): { stopped: boolean } {
  const FLAG = "__promptaheadSelectionWatch";
  type WatchState = { stop: () => void; lastSent: string };
  const win = window as unknown as Window & Record<string, WatchState | undefined>;
  const existing = win[FLAG];
  if (!existing) {
    return { stopped: false };
  }
  existing.stop();
  return { stopped: true };
}
