import { sendToBackground as defaultSendToBackground } from "../shared/messaging";
import {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  isDestinationId,
  type HistoryMode,
  type Settings,
  type SettingsPatch,
} from "../shared/storage/schema";

const LANGUAGE_PRESETS = new Set(["en", "hr", "de", "fr", "es"]);

export type OptionsDeps = {
  sendToBackground: typeof defaultSendToBackground;
  confirm: (message: string) => boolean;
};

export type OptionsController = {
  /** No-op today; reserved for listener teardown in tests. */
  dispose: () => void;
};

function setHidden(element: HTMLElement | null, hidden: boolean): void {
  if (!element) {
    return;
  }
  if (hidden) {
    element.setAttribute("hidden", "");
  } else {
    element.removeAttribute("hidden");
  }
}

/**
 * Wire the options page. Call once after the DOM is present.
 * Production entry boots via the guard at the bottom of this module.
 */
export function initOptions(deps: Partial<OptionsDeps> = {}): OptionsController {
  const send = deps.sendToBackground ?? defaultSendToBackground;
  const confirm =
    deps.confirm ?? ((message: string) => globalThis.confirm(message));

  const statusEl = document.getElementById("status");
  const modeLabel = document.getElementById("mode-label");
  const smartStatus = document.getElementById("smart-status");
  const destinationSelect = document.getElementById(
    "destination",
  ) as HTMLSelectElement | null;
  const languagePreset = document.getElementById(
    "language-preset",
  ) as HTMLSelectElement | null;
  const languageCustomWrap = document.getElementById("language-custom-wrap");
  const languageCustom = document.getElementById(
    "language-custom",
  ) as HTMLInputElement | null;
  const developerMode = document.getElementById(
    "developer-mode",
  ) as HTMLInputElement | null;
  const nanoStatus = document.getElementById("nano-status");
  const debugSection = document.getElementById("debug-section");
  const debugLine = document.getElementById("debug-line");
  const clearHistoryButton = document.getElementById(
    "clear-history",
  ) as HTMLButtonElement | null;
  const clearLearnedButton = document.getElementById(
    "clear-learned",
  ) as HTMLButtonElement | null;
  const clearAllButton = document.getElementById(
    "clear-all",
  ) as HTMLButtonElement | null;

  function setStatus(text: string, kind: "ok" | "error" | "info" = "info"): void {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = text;
    statusEl.classList.remove("banner--ok", "banner--error");
    if (kind === "ok") {
      statusEl.classList.add("banner--ok");
    } else if (kind === "error") {
      statusEl.classList.add("banner--error");
    }
    setHidden(statusEl, text.length === 0);
  }

  function nanoCopy(settings: Settings): string {
    if (settings.nanoPreference === "skipped") {
      return "Nano setup skipped (Manual-first). Curated suggestions work without a download. Real Prompt API setup arrives in M2.";
    }
    if (settings.nanoPreference === "basic") {
      return "Nano preference: basic (coming in M2 — no download in this build).";
    }
    return "Nano preference: enabled (coming in M2 — no download in this build).";
  }

  function languageOverrideFromUi(): string | null {
    if (!languagePreset) {
      return null;
    }
    const preset = languagePreset.value;
    if (preset === "") {
      return null;
    }
    if (preset === "custom") {
      const custom = (languageCustom?.value ?? "").trim();
      return custom.length > 0 ? custom : null;
    }
    return preset;
  }

  function applyLanguageToUi(override: string | null): void {
    if (!languagePreset) {
      return;
    }
    if (override === null || override === "") {
      languagePreset.value = "";
      setHidden(languageCustomWrap, true);
      if (languageCustom) {
        languageCustom.value = "";
      }
      return;
    }
    if (LANGUAGE_PRESETS.has(override)) {
      languagePreset.value = override;
      setHidden(languageCustomWrap, true);
      return;
    }
    languagePreset.value = "custom";
    setHidden(languageCustomWrap, false);
    if (languageCustom) {
      languageCustom.value = override;
    }
  }

  function renderSettings(settings: Settings): void {
    if (destinationSelect) {
      destinationSelect.value = settings.defaultDestination;
    }
    applyLanguageToUi(settings.languageOverride);

    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[name="history-mode"]',
    )) {
      input.checked = input.value === settings.historyMode;
    }

    if (developerMode) {
      developerMode.checked = settings.developerMode;
    }

    if (modeLabel) {
      modeLabel.textContent = settings.mode === "smart" ? "Smart" : "Manual";
    }
    if (smartStatus) {
      smartStatus.textContent = settings.smartModeAvailable
        ? "Smart mode: available"
        : "Smart mode: coming soon (no host permission requested)";
    }
    if (nanoStatus) {
      nanoStatus.textContent = nanoCopy(settings);
    }

    setHidden(debugSection, !settings.developerMode);
    if (debugLine) {
      debugLine.textContent = [
        `mode: ${settings.mode}`,
        `destination: ${DESTINATION_LABELS[settings.defaultDestination]}`,
        `language: ${settings.languageOverride ?? "page"}`,
        `nano: ${settings.nanoPreference}`,
        `history: ${settings.historyMode}`,
        `developer: ${settings.developerMode}`,
        `settings schema: v${settings.schemaVersion}`,
      ].join(" · ");
    }
  }

  async function saveSettingsPatch(patch: SettingsPatch): Promise<boolean> {
    const response = await send({ type: "SET_SETTINGS", patch });
    if (!response.ok) {
      setStatus(`Could not save — ${response.error}`, "error");
      return false;
    }
    renderSettings(response.settings);
    return true;
  }

  function populateDestinations(): void {
    if (!destinationSelect || destinationSelect.options.length > 0) {
      return;
    }
    for (const id of DESTINATION_IDS) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = DESTINATION_LABELS[id];
      destinationSelect.append(option);
    }
  }

  async function loadSettings(): Promise<void> {
    const response = await send({ type: "GET_SETTINGS" });
    if (!response.ok) {
      setStatus(`Background unreachable — ${response.error}`, "error");
      return;
    }
    renderSettings(response.settings);
  }

  destinationSelect?.addEventListener("change", () => {
    const value = destinationSelect.value;
    if (!isDestinationId(value)) {
      return;
    }
    void saveSettingsPatch({ defaultDestination: value });
  });

  languagePreset?.addEventListener("change", () => {
    const isCustom = languagePreset.value === "custom";
    setHidden(languageCustomWrap, !isCustom);
    if (isCustom) {
      languageCustom?.focus();
      return;
    }
    void saveSettingsPatch({ languageOverride: languageOverrideFromUi() });
  });

  languageCustom?.addEventListener("change", () => {
    void saveSettingsPatch({ languageOverride: languageOverrideFromUi() });
  });

  for (const input of document.querySelectorAll<HTMLInputElement>(
    'input[name="history-mode"]',
  )) {
    input.addEventListener("change", () => {
      if (!input.checked) {
        return;
      }
      const mode: HistoryMode = input.value === "full" ? "full" : "recent";
      void saveSettingsPatch({ historyMode: mode });
    });
  }

  developerMode?.addEventListener("change", () => {
    void saveSettingsPatch({ developerMode: Boolean(developerMode.checked) });
  });

  clearHistoryButton?.addEventListener("click", () => {
    if (!confirm("Clear the latest prompt history on this device?")) {
      return;
    }
    void send({ type: "CLEAR_RECENT_HISTORY" }).then((response) => {
      if (!response.ok) {
        setStatus(`Could not clear history — ${response.error}`, "error");
        return;
      }
      setStatus("Prompt history cleared.", "ok");
    });
  });

  clearLearnedButton?.addEventListener("click", () => {
    if (!confirm("Clear learned preference aggregates on this device?")) {
      return;
    }
    void send({ type: "CLEAR_LEARNED_PREFS" }).then((response) => {
      if (!response.ok) {
        setStatus(`Could not clear learned prefs — ${response.error}`, "error");
        return;
      }
      setStatus("Learned preferences cleared.", "ok");
    });
  });

  clearAllButton?.addEventListener("click", () => {
    if (!confirm("Delete all local PromptAhead data on this device?")) {
      return;
    }

    void send({ type: "CLEAR_ALL_DATA" }).then((response) => {
      if (!response.ok) {
        setStatus(`Could not clear data — ${response.error}`, "error");
        return;
      }
      renderSettings(response.settings);
      setStatus(
        "All local data cleared. Defaults restored — open the side panel to run setup again.",
        "ok",
      );
    });
  });

  populateDestinations();
  void loadSettings();

  return {
    dispose: () => undefined,
  };
}

// Production entry — skipped under Vitest so tests can call initOptions with deps.
if (typeof process === "undefined" || process.env.VITEST !== "true") {
  initOptions();
}
