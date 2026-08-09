import {
  SMART_PERMISSION_EDUCATION,
  hasSmartHostPermission,
  requestSmartHostPermission,
  revokeSmartHostPermission,
  settingsAfterSmartGrant,
  settingsAfterSmartRevoke,
  syncEngagementContentScripts,
  type PermissionsApi,
} from "../domain/smart";
import {
  describeNanoStatus,
  destroyNanoSession,
  downloadNanoModel,
  formatDownloadProgress,
  getLanguageModel,
  probeNanoReadiness,
  progressFractionToPercent,
  type LanguageModelLike,
  type NanoReadinessProbe,
} from "../domain/suggestions";
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
  getLanguageModel: () => LanguageModelLike | undefined;
  /** Injected for tests — defaults to `chrome.permissions`. */
  permissionsApi?: PermissionsApi;
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

function isForceDisabledEnv(): boolean {
  return (
    typeof process !== "undefined" && process.env?.NANO_FORCE_DISABLED === "1"
  );
}

/**
 * Wire the options page. Call once after the DOM is present.
 * Production entry boots via the guard at the bottom of this module.
 */
export function initOptions(deps: Partial<OptionsDeps> = {}): OptionsController {
  const send = deps.sendToBackground ?? defaultSendToBackground;
  const confirm =
    deps.confirm ?? ((message: string) => globalThis.confirm(message));
  const activeGetModel = deps.getLanguageModel ?? getLanguageModel;
  const permissionsApi = deps.permissionsApi;

  const statusEl = document.getElementById("status");
  const modeLabel = document.getElementById("mode-label");
  const smartStatus = document.getElementById("smart-status");
  const smartEducationSummary = document.getElementById(
    "smart-education-summary",
  );
  const smartEducationBullets = document.getElementById(
    "smart-education-bullets",
  );
  const smartEducationHonesty = document.getElementById(
    "smart-education-honesty",
  );
  const smartEnable = document.getElementById(
    "smart-enable",
  ) as HTMLButtonElement | null;
  const smartRevoke = document.getElementById(
    "smart-revoke",
  ) as HTMLButtonElement | null;
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
  const proactivePause = document.getElementById(
    "proactive-pause",
  ) as HTMLInputElement | null;
  const developerMode = document.getElementById(
    "developer-mode",
  ) as HTMLInputElement | null;
  const developerActions = document.getElementById("developer-actions");
  const developerActionsHint = document.getElementById("developer-actions-hint");
  const resetInviteCaps = document.getElementById(
    "reset-invite-caps",
  ) as HTMLButtonElement | null;
  const nanoStatus = document.getElementById("nano-status");
  const nanoForceBasic = document.getElementById(
    "nano-force-basic",
  ) as HTMLInputElement | null;
  const nanoSetup = document.getElementById(
    "nano-setup",
  ) as HTMLButtonElement | null;
  const nanoEnable = document.getElementById(
    "nano-enable",
  ) as HTMLButtonElement | null;
  const nanoProgress = document.getElementById("nano-download-progress");
  const nanoProgressBar = document.getElementById("nano-download-progress-bar");
  const nanoProgressLabel = document.getElementById(
    "nano-download-progress-label",
  );
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

  let latestSettings: Settings | null = null;
  let latestReadiness: NanoReadinessProbe | null = null;
  let downloading = false;
  let smartBusy = false;
  let hostGranted = false;

  function fillSmartEducation(): void {
    if (smartEducationSummary) {
      smartEducationSummary.textContent = SMART_PERMISSION_EDUCATION.summary;
    }
    if (smartEducationBullets && smartEducationBullets.childElementCount === 0) {
      for (const bullet of SMART_PERMISSION_EDUCATION.bullets) {
        const li = document.createElement("li");
        li.textContent = bullet;
        smartEducationBullets.append(li);
      }
    }
    if (smartEducationHonesty) {
      smartEducationHonesty.textContent = SMART_PERMISSION_EDUCATION.inviteHonesty;
    }
  }

  function renderSmartControls(settings: Settings): void {
    if (modeLabel) {
      modeLabel.textContent = settings.mode === "smart" ? "Smart" : "Manual";
    }
    if (smartStatus) {
      smartStatus.textContent = hostGranted
        ? "Website access: granted (Smart available)"
        : "Website access: not granted — Manual stays fully usable";
    }
    setHidden(smartEnable, hostGranted);
    setHidden(smartRevoke, !hostGranted);
    if (smartEnable) {
      smartEnable.disabled = smartBusy;
    }
    if (smartRevoke) {
      smartRevoke.disabled = smartBusy;
    }
  }

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

  function setProgressUi(fraction: number | null, visible: boolean): void {
    setHidden(nanoProgress, !visible);
    if (!visible || !nanoProgressBar) {
      return;
    }
    const pct = progressFractionToPercent(fraction);
    if (pct === null) {
      nanoProgressBar.dataset.indeterminate = "true";
      nanoProgressBar.style.removeProperty("--progress");
      nanoProgressBar.setAttribute("aria-valuenow", "0");
    } else {
      nanoProgressBar.dataset.indeterminate = "false";
      nanoProgressBar.style.setProperty("--progress", `${pct}%`);
      nanoProgressBar.setAttribute("aria-valuenow", String(pct));
    }
    if (nanoProgressLabel) {
      nanoProgressLabel.textContent = formatDownloadProgress(fraction);
    }
  }

  function renderNanoControls(settings: Settings): void {
    if (nanoStatus) {
      nanoStatus.textContent = describeNanoStatus({
        preference: settings.nanoPreference,
        readiness: latestReadiness,
        forceDisabled: isForceDisabledEnv(),
      });
    }
    if (nanoForceBasic) {
      nanoForceBasic.checked = settings.nanoPreference === "basic";
      nanoForceBasic.disabled = downloading || isForceDisabledEnv();
    }

    const state = latestReadiness?.state;
    const canUseNano =
      !isForceDisabledEnv() && settings.nanoPreference !== "basic";
    const showDownload = canUseNano && state === "download";
    const showEnable =
      canUseNano &&
      state === "ready" &&
      settings.nanoPreference !== "enabled";

    setHidden(nanoSetup, !showDownload);
    setHidden(nanoEnable, !showEnable);
    if (nanoSetup) {
      nanoSetup.disabled = downloading;
      nanoSetup.textContent = downloading
        ? "Downloading…"
        : "Download on-device model";
    }
    if (nanoEnable) {
      nanoEnable.disabled = downloading;
    }
    if (!downloading) {
      setProgressUi(null, false);
    }
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

  let engagementDebug = "engagement: unknown";
  let inviteDebug = "invite: unknown";

  async function refreshEngagementDebug(): Promise<void> {
    const response = await send({ type: "SYNC_ENGAGEMENT_SCRIPTS" });
    if (!response.ok || response.type !== "SYNC_ENGAGEMENT_SCRIPTS") {
      engagementDebug = `engagement: sync failed (${response.ok === false ? response.error : "bad reply"})`;
      return;
    }
    const jsHint = response.js[0] ? response.js[0].replace(/^assets\//, "") : "none";
    engagementDebug = [
      `hostGranted: ${response.hostGranted}`,
      `registered: ${response.registered}`,
      `js: ${jsHint}`,
      response.error ? `error: ${response.error}` : null,
    ]
      .filter(Boolean)
      .join(", ");
  }

  async function refreshInviteDebug(): Promise<void> {
    const response = await send({ type: "GET_INVITE_RUNTIME" });
    if (!response.ok || response.type !== "GET_INVITE_RUNTIME") {
      inviteDebug = `invite: read failed (${response.ok === false ? response.error : "bad reply"})`;
      return;
    }
    const last = response.lastInviteEvent;
    const lastBit = last
      ? `last: ${last.showBadge ? "badge" : last.suppression ?? last.reason} @ ${last.url.slice(0, 48)}`
      : "last: none";
    inviteDebug = [
      `invitesToday: ${response.invitesToday}`,
      `domains: [${response.domainsInvitedToday.join(", ") || "—"}]`,
      lastBit,
    ].join(", ");
  }

  function renderSettings(settings: Settings): void {
    latestSettings = settings;
    if (destinationSelect) {
      destinationSelect.value = settings.defaultDestination;
    }
    applyLanguageToUi(settings.languageOverride);

    for (const input of document.querySelectorAll<HTMLInputElement>(
      'input[name="history-mode"]',
    )) {
      input.checked = input.value === settings.historyMode;
    }

    if (proactivePause) {
      proactivePause.checked = settings.proactivePaused;
    }

    if (developerMode) {
      developerMode.checked = settings.developerMode;
    }

    renderSmartControls(settings);

    renderNanoControls(settings);

    setHidden(debugSection, !settings.developerMode);
    setHidden(developerActions, !settings.developerMode);
    setHidden(developerActionsHint, !settings.developerMode);
    if (debugLine) {
      debugLine.textContent = [
        `mode: ${settings.mode}`,
        `destination: ${DESTINATION_LABELS[settings.defaultDestination]}`,
        `language: ${settings.languageOverride ?? "page"}`,
        `nano: ${settings.nanoPreference}`,
        `availability: ${latestReadiness?.availability ?? "unknown"}`,
        `history: ${settings.historyMode}`,
        `proactivePaused: ${settings.proactivePaused}`,
        `developer: ${settings.developerMode}`,
        `settings schema: v${settings.schemaVersion}`,
        engagementDebug,
        inviteDebug,
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

  async function refreshNanoReadiness(): Promise<void> {
    if (isForceDisabledEnv()) {
      latestReadiness = {
        state: "unsupported",
        availability: null,
        apiPresent: false,
      };
      if (latestSettings) {
        renderNanoControls(latestSettings);
      }
      return;
    }
    try {
      latestReadiness = await probeNanoReadiness(activeGetModel);
    } catch {
      latestReadiness = {
        state: "unsupported",
        availability: null,
        apiPresent: false,
      };
    }
    if (latestSettings) {
      renderNanoControls(latestSettings);
      if (debugLine && latestSettings.developerMode) {
        renderSettings(latestSettings);
      }
    }
  }

  async function runNanoSetup(): Promise<void> {
    if (downloading || isForceDisabledEnv()) {
      return;
    }
    const model = activeGetModel();
    if (!model) {
      setStatus(
        "On-device AI is not available in this Chrome. Curated mode stays usable.",
        "error",
      );
      await refreshNanoReadiness();
      return;
    }

    const probe = await probeNanoReadiness(() => model);
    if (probe.state === "ready") {
      const ok = await saveSettingsPatch({ nanoPreference: "enabled" });
      if (ok) {
        setStatus("On-device AI enabled for this profile.", "ok");
      }
      await refreshNanoReadiness();
      return;
    }

    if (probe.state === "unsupported") {
      setStatus(
        "This Chrome or device does not support on-device AI yet.",
        "error",
      );
      await refreshNanoReadiness();
      return;
    }

    downloading = true;
    if (latestSettings) {
      renderNanoControls(latestSettings);
    }
    setProgressUi(null, true);
    setStatus("Downloading on-device model…", "info");

    const result = await downloadNanoModel(model, {
      onProgress: (fraction) => setProgressUi(fraction, true),
    });
    destroyNanoSession(result.session);
    downloading = false;

    if (result.session) {
      setProgressUi(1, true);
      const ok = await saveSettingsPatch({ nanoPreference: "enabled" });
      await refreshNanoReadiness();
      if (ok) {
        setStatus("Download complete — on-device AI is enabled.", "ok");
      }
      setProgressUi(null, false);
      return;
    }

    await refreshNanoReadiness();
    setProgressUi(result.lastProgressFraction, Boolean(result.progressEvents));
    setStatus(
      result.timedOut
        ? "Download timed out. You can retry, or stay on curated suggestions."
        : `Download failed${result.error ? ` — ${result.error.message}` : ""}. Retry anytime.`,
      "error",
    );
  }

  async function refreshHostPermission(): Promise<void> {
    hostGranted = await hasSmartHostPermission(permissionsApi);
    if (latestSettings) {
      renderSmartControls(latestSettings);
      // Heal storage if Chrome grant/revoke drifted from settings flags.
      if (hostGranted && !latestSettings.smartModeAvailable) {
        await saveSettingsPatch(settingsAfterSmartGrant());
      } else if (!hostGranted && latestSettings.mode === "smart") {
        await saveSettingsPatch(settingsAfterSmartRevoke());
      }
    }
  }

  async function enableSmartMode(): Promise<void> {
    if (smartBusy) {
      return;
    }
    if (
      !confirm(
        "Chrome will ask for website access next. PromptAhead uses it only for local Smart features on this device. Continue?",
      )
    ) {
      return;
    }
    smartBusy = true;
    if (latestSettings) {
      renderSmartControls(latestSettings);
    }
    setStatus("Waiting for Chrome’s permission dialog…", "info");
    const outcome = await requestSmartHostPermission(permissionsApi);
    smartBusy = false;
    if (!outcome.granted) {
      hostGranted = false;
      if (latestSettings) {
        renderSmartControls(latestSettings);
      }
      setStatus(
        outcome.error
          ? `Smart mode not enabled — ${outcome.error}`
          : "Permission declined. Manual mode stays fully usable.",
        "error",
      );
      return;
    }
    hostGranted = true;
    void syncEngagementContentScripts(true);
    const ok = await saveSettingsPatch(settingsAfterSmartGrant());
    if (ok) {
      setStatus("Smart mode enabled. You can revoke anytime below.", "ok");
    }
  }

  async function revokeSmartMode(): Promise<void> {
    if (smartBusy) {
      return;
    }
    if (
      !confirm(
        "Revoke website access and switch to Manual? You can still analyze pages by clicking the PromptAhead icon.",
      )
    ) {
      return;
    }
    smartBusy = true;
    if (latestSettings) {
      renderSmartControls(latestSettings);
    }
    const outcome = await revokeSmartHostPermission(permissionsApi);
    smartBusy = false;
    hostGranted = outcome.granted;
    if (!outcome.granted) {
      void syncEngagementContentScripts(false);
    }
    const ok = await saveSettingsPatch(settingsAfterSmartRevoke());
    if (latestSettings) {
      renderSmartControls({
        ...latestSettings,
        ...settingsAfterSmartRevoke(),
      });
    }
    if (!outcome.ok) {
      setStatus(
        outcome.error
          ? `Revoke incomplete — ${outcome.error}. Manual mode is still set.`
          : "Revoke incomplete. Manual mode is still set.",
        "error",
      );
      return;
    }
    if (ok) {
      setStatus(
        "Website access revoked. Manual toolbar/gesture flow still works.",
        "ok",
      );
    }
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
    void refreshNanoReadiness();
    void refreshHostPermission();
    void refreshEngagementDebug().then(() => {
      if (latestSettings) {
        renderSettings(latestSettings);
      }
    });
    void refreshInviteDebug().then(() => {
      if (latestSettings) {
        renderSettings(latestSettings);
      }
    });
  }

  smartEnable?.addEventListener("click", () => {
    void enableSmartMode();
  });

  smartRevoke?.addEventListener("click", () => {
    void revokeSmartMode();
  });

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

  proactivePause?.addEventListener("change", () => {
    const paused = Boolean(proactivePause.checked);
    void saveSettingsPatch({ proactivePaused: paused }).then((ok) => {
      if (ok) {
        setStatus(
          paused
            ? "Proactive Smart invites paused. Manual toolbar analyze still works."
            : "Proactive Smart invites resumed.",
          "ok",
        );
      }
    });
  });

  developerMode?.addEventListener("change", () => {
    void saveSettingsPatch({ developerMode: Boolean(developerMode.checked) }).then(
      (ok) => {
        if (ok) {
          void Promise.all([refreshEngagementDebug(), refreshInviteDebug()]).then(
            () => {
              if (latestSettings) {
                renderSettings(latestSettings);
              }
            },
          );
        }
      },
    );
  });

  resetInviteCaps?.addEventListener("click", () => {
    void (async () => {
      const response = await send({ type: "RESET_INVITE_CAPS" });
      if (!response.ok) {
        setStatus(`Could not reset caps — ${response.error}`, "error");
        return;
      }
      await refreshInviteDebug();
      if (latestSettings) {
        renderSettings(latestSettings);
      }
      setStatus("Today's invite caps cleared. Re-engage on an article to test.", "ok");
    })();
  });

  nanoForceBasic?.addEventListener("change", () => {
    const forceBasic = Boolean(nanoForceBasic.checked);
    void saveSettingsPatch({
      nanoPreference: forceBasic ? "basic" : "skipped",
    }).then((ok) => {
      if (ok) {
        setStatus(
          forceBasic
            ? "Basic private mode on — curated suggestions only."
            : "Basic mode off. Use Set up to enable on-device AI.",
          "ok",
        );
      }
      void refreshNanoReadiness();
    });
  });

  nanoSetup?.addEventListener("click", () => {
    void runNanoSetup();
  });

  nanoEnable?.addEventListener("click", () => {
    void saveSettingsPatch({ nanoPreference: "enabled" }).then((ok) => {
      if (ok) {
        setStatus("On-device AI enabled for this profile.", "ok");
      }
      void refreshNanoReadiness();
    });
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
      latestReadiness = null;
      hostGranted = false;
      renderSettings(response.settings);
      void refreshNanoReadiness();
      void refreshHostPermission();
      setStatus(
        "All local data cleared. Defaults restored — open the side panel to run setup again.",
        "ok",
      );
    });
  });

  fillSmartEducation();
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
