/**
 * First-run overlay in the side panel. Persists only via background messages.
 */

import {
  SMART_PERMISSION_EDUCATION,
  requestSmartHostPermission,
  syncEngagementContentScripts,
  type PermissionsApi,
} from "../domain/smart";
import {
  destroyNanoSession,
  downloadNanoModel,
  formatDownloadProgress,
  getLanguageModel,
  probeNanoReadiness,
  progressFractionToPercent,
  type LanguageModelLike,
  type NanoReadinessState,
} from "../domain/suggestions";
import { sendToBackground as defaultSendToBackground } from "../shared/messaging";
import {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  isDestinationId,
  type DestinationId,
  type NanoPreference,
  type PromptAheadMode,
} from "../shared/storage/schema";
import {
  buildOnboardingCompletion,
  isOnboardingStepId,
  nanoStepCopy,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStepId,
} from "./onboarding-flow";

export type OnboardingDeps = {
  sendToBackground: typeof defaultSendToBackground;
  /** Injected for tests — defaults to realm LanguageModel. */
  getLanguageModel: () => LanguageModelLike | undefined;
  permissionsApi?: PermissionsApi;
};

let wired = false;
let currentStep: OnboardingStepId = "welcome";
let chosenDestination: DestinationId = "copy";
/** Smart is visually preselected (handoff §8); grant only after explicit continue. */
let chosenMode: PromptAheadMode = "smart";
let smartGranted = false;
let modeBusy = false;
let nanoState: NanoReadinessState = "checking";
let downloading = false;
let onComplete: (() => void) | undefined;
let activeSend: typeof defaultSendToBackground = defaultSendToBackground;
let activeGetModel: () => LanguageModelLike | undefined = getLanguageModel;
let activePermissions: PermissionsApi | undefined;
/** True from gate open until overlay dismissed or onboarding skipped. */
let onboardingGateActive = false;

/**
 * Workflow must not warm while first-run is pending or visible — including the
 * window before the overlay is shown (DOM-31).
 */
export function isOnboardingBlocking(): boolean {
  return onboardingGateActive || isOnboardingVisible();
}

function beginOnboardingGate(): void {
  onboardingGateActive = true;
}

function endOnboardingGate(): void {
  onboardingGateActive = false;
}

function setText(element: HTMLElement | null, text: string): void {
  if (element) {
    element.textContent = text;
  }
}

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

function overlayEl(): HTMLElement | null {
  return document.getElementById("onboarding");
}

function stepRootEl(): HTMLElement | null {
  return document.getElementById("onboarding-steps");
}

function statusLineEl(): HTMLElement | null {
  return document.getElementById("onboarding-status");
}

function destinationSelectEl(): HTMLSelectElement | null {
  return document.getElementById(
    "onboarding-destination",
  ) as HTMLSelectElement | null;
}

function nanoHeadingEl(): HTMLElement | null {
  return document.getElementById("onboarding-nano-heading");
}

function nanoCopyEl(): HTMLElement | null {
  return document.getElementById("onboarding-nano-copy");
}

function nanoPrimaryEl(): HTMLButtonElement | null {
  return document.getElementById(
    "onboarding-nano-primary",
  ) as HTMLButtonElement | null;
}

function nanoDownloadEl(): HTMLButtonElement | null {
  return document.getElementById(
    "onboarding-nano-download",
  ) as HTMLButtonElement | null;
}

function nanoProgressEl(): HTMLElement | null {
  return document.getElementById("onboarding-nano-progress");
}

function nanoProgressBarEl(): HTMLElement | null {
  return document.getElementById("onboarding-nano-progress-bar");
}

function nanoProgressLabelEl(): HTMLElement | null {
  return document.getElementById("onboarding-nano-progress-label");
}

function modeContinueEl(): HTMLButtonElement | null {
  return document.getElementById(
    "onboarding-mode-continue",
  ) as HTMLButtonElement | null;
}

function fillSmartEducation(): void {
  const summary = document.getElementById("onboarding-mode-summary");
  if (summary && !summary.dataset.filled) {
    summary.textContent = SMART_PERMISSION_EDUCATION.summary;
    summary.dataset.filled = "1";
  }
  const bullets = document.getElementById("onboarding-smart-bullets");
  if (bullets && bullets.childElementCount === 0) {
    for (const text of SMART_PERMISSION_EDUCATION.bullets) {
      const li = document.createElement("li");
      li.textContent = text;
      bullets.append(li);
    }
  }
  setText(
    document.getElementById("onboarding-smart-honesty"),
    SMART_PERMISSION_EDUCATION.inviteHonesty,
  );
}

function renderModeChoiceUi(): void {
  const root = document.getElementById("onboarding-mode-choices");
  if (root) {
    for (const button of root.querySelectorAll<HTMLButtonElement>(
      "[data-mode-choice]",
    )) {
      const mode = button.dataset.modeChoice;
      const active = mode === chosenMode;
      button.classList.toggle("onboarding__choice--active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    }
  }
  setHidden(
    document.getElementById("onboarding-smart-education"),
    chosenMode !== "smart",
  );
  const continueBtn = modeContinueEl();
  if (continueBtn) {
    continueBtn.disabled = modeBusy;
    continueBtn.textContent =
      chosenMode === "smart"
        ? "Continue and allow website access"
        : "Continue with Manual";
  }
}

function showOverlay(visible: boolean): void {
  setHidden(overlayEl(), !visible);
  document.body.classList.toggle("onboarding-active", visible);
}

function showStep(step: OnboardingStepId): void {
  currentStep = step;
  const stepRoot = stepRootEl();
  if (!stepRoot) {
    return;
  }
  for (const panel of stepRoot.querySelectorAll<HTMLElement>("[data-step]")) {
    const id = panel.dataset.step ?? "";
    setHidden(panel, id !== step);
  }
  setText(statusLineEl(), "");
  if (step === "mode") {
    fillSmartEducation();
    renderModeChoiceUi();
  }
  if (step === "nano") {
    void refreshNanoStep();
  }
}

function populateDestinations(): void {
  const destinationSelect = destinationSelectEl();
  if (!destinationSelect || destinationSelect.options.length > 0) {
    return;
  }
  for (const id of DESTINATION_IDS) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = DESTINATION_LABELS[id];
    destinationSelect.append(option);
  }
  destinationSelect.value = chosenDestination;
}

function setProgressUi(fraction: number | null, visible: boolean): void {
  const wrap = nanoProgressEl();
  const bar = nanoProgressBarEl();
  const label = nanoProgressLabelEl();
  setHidden(wrap, !visible);
  if (!visible || !bar) {
    return;
  }
  const pct = progressFractionToPercent(fraction);
  if (pct === null) {
    bar.dataset.indeterminate = "true";
    bar.style.removeProperty("--progress");
    bar.setAttribute("aria-valuenow", "0");
  } else {
    bar.dataset.indeterminate = "false";
    bar.style.setProperty("--progress", `${pct}%`);
    bar.setAttribute("aria-valuenow", String(pct));
  }
  setText(label, formatDownloadProgress(fraction));
}

function renderNanoStepUi(state: NanoReadinessState): void {
  nanoState = state;
  const copy = nanoStepCopy(state);
  setText(nanoHeadingEl(), copy.heading);
  setText(nanoCopyEl(), copy.body);

  const primary = nanoPrimaryEl();
  const download = nanoDownloadEl();

  setHidden(primary, state !== "ready");
  setHidden(download, state !== "download");
  if (primary) {
    primary.disabled = downloading;
    primary.textContent = "Enable on-device AI";
  }
  if (download) {
    download.disabled = downloading;
    download.textContent = downloading
      ? "Downloading…"
      : "Download on-device model";
  }

  if (!downloading) {
    setProgressUi(null, false);
  }
}

async function refreshNanoStep(): Promise<void> {
  renderNanoStepUi("checking");
  setProgressUi(null, false);
  try {
    const probe = await probeNanoReadiness(activeGetModel);
    if (currentStep !== "nano") {
      return;
    }
    renderNanoStepUi(probe.state);
  } catch {
    if (currentStep !== "nano") {
      return;
    }
    renderNanoStepUi("unsupported");
  }
}

async function persistCompletion(input: {
  skipped: boolean;
  nanoPreference: NanoPreference;
}): Promise<boolean> {
  const destinationSelect = destinationSelectEl();
  if (destinationSelect && isDestinationId(destinationSelect.value)) {
    chosenDestination = destinationSelect.value;
  }

  const mode: PromptAheadMode =
    input.skipped || !smartGranted ? "manual" : chosenMode === "smart" ? "smart" : "manual";

  const { onboarding, settings } = buildOnboardingCompletion({
    destination: chosenDestination,
    skipped: input.skipped,
    nanoPreference: input.nanoPreference,
    mode,
    smartModeAvailable: mode === "smart",
  });

  const settingsResponse = await activeSend({
    type: "SET_SETTINGS",
    patch: settings,
  });
  if (!settingsResponse.ok) {
    setText(statusLineEl(), `Could not save — ${settingsResponse.error}`);
    return false;
  }

  const onboardingResponse = await activeSend({
    type: "SET_ONBOARDING",
    patch: onboarding,
  });
  if (!onboardingResponse.ok) {
    setText(statusLineEl(), `Could not save — ${onboardingResponse.error}`);
    return false;
  }

  endOnboardingGate();
  showOverlay(false);
  onComplete?.();
  return true;
}

async function continueFromModeStep(): Promise<void> {
  if (modeBusy) {
    return;
  }
  if (chosenMode === "manual") {
    smartGranted = false;
    showStep("destination");
    return;
  }

  modeBusy = true;
  renderModeChoiceUi();
  setText(statusLineEl(), "Waiting for Chrome’s permission dialog…");
  const outcome = await requestSmartHostPermission(activePermissions);
  modeBusy = false;
  renderModeChoiceUi();

  if (!outcome.granted) {
    smartGranted = false;
    setText(
      statusLineEl(),
      outcome.error
        ? `Permission not granted — ${outcome.error}. Choose Manual or try again.`
        : "Permission declined. Choose Manual or try again.",
    );
    return;
  }

  smartGranted = true;
  void syncEngagementContentScripts(true);
  setText(statusLineEl(), "");
  showStep("destination");
}

async function startNanoDownload(): Promise<void> {
  if (downloading) {
    return;
  }
  const model = activeGetModel();
  if (!model) {
    setText(
      statusLineEl(),
      "On-device AI is not available in this Chrome. Continue with basic private mode.",
    );
    renderNanoStepUi("unsupported");
    return;
  }

  downloading = true;
  renderNanoStepUi("download");
  setProgressUi(null, true);
  setText(statusLineEl(), "");

  const result = await downloadNanoModel(model, {
    onProgress: (fraction) => {
      setProgressUi(fraction, true);
    },
  });

  destroyNanoSession(result.session);
  downloading = false;

  if (result.session) {
    setProgressUi(1, true);
    renderNanoStepUi("ready");
    setText(statusLineEl(), "Download complete — you can enable on-device AI.");
    return;
  }

  renderNanoStepUi("download");
  setProgressUi(result.lastProgressFraction, Boolean(result.progressEvents));
  if (result.timedOut) {
    setText(
      statusLineEl(),
      "Download is taking too long. Continue with basic private mode, or try again later.",
    );
  } else {
    setText(
      statusLineEl(),
      result.error?.message
        ? `Download failed — ${result.error.message}. Continue with basic private mode anytime.`
        : "Download failed. Continue with basic private mode anytime.",
    );
  }
}

function wireControls(): void {
  if (wired) {
    return;
  }
  wired = true;
  populateDestinations();

  const destinationSelect = destinationSelectEl();
  destinationSelect?.addEventListener("change", () => {
    if (destinationSelect && isDestinationId(destinationSelect.value)) {
      chosenDestination = destinationSelect.value;
    }
  });

  overlayEl()?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const modeChoice = target.closest<HTMLElement>("[data-mode-choice]")
      ?.dataset.modeChoice;
    if (modeChoice === "smart" || modeChoice === "manual") {
      if (modeBusy) {
        return;
      }
      chosenMode = modeChoice;
      renderModeChoiceUi();
      setText(statusLineEl(), "");
      return;
    }

    const action = target.closest<HTMLElement>("[data-onboarding-action]")
      ?.dataset.onboardingAction;
    if (!action) {
      return;
    }

    if (action === "mode-continue") {
      void continueFromModeStep();
      return;
    }

    if (action === "next") {
      const next = nextOnboardingStep(currentStep);
      if (next === "complete") {
        void persistCompletion({ skipped: false, nanoPreference: "skipped" });
        return;
      }
      showStep(next);
      return;
    }

    if (action === "back") {
      if (downloading || modeBusy) {
        return;
      }
      const previous = previousOnboardingStep(currentStep);
      if (previous) {
        showStep(previous);
      }
      return;
    }

    if (action === "skip") {
      smartGranted = false;
      chosenMode = "manual";
      void persistCompletion({ skipped: true, nanoPreference: "skipped" });
      return;
    }

    if (action === "nano-basic") {
      void persistCompletion({ skipped: false, nanoPreference: "basic" });
      return;
    }

    if (action === "nano-primary") {
      void persistCompletion({ skipped: false, nanoPreference: "enabled" });
      return;
    }

    if (action === "nano-download") {
      void startNanoDownload();
    }
  });
}

const ONBOARDING_WAKE_ATTEMPTS = 8;
const ONBOARDING_WAKE_BASE_MS = 120;

async function wakeBackgroundForOnboarding(): Promise<void> {
  for (let attempt = 0; attempt < ONBOARDING_WAKE_ATTEMPTS; attempt += 1) {
    const ping = await activeSend({ type: "PING" });
    if (ping.ok) {
      return;
    }
    const delay = ONBOARDING_WAKE_BASE_MS * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function fetchOnboardingState() {
  await wakeBackgroundForOnboarding();
  let last = await activeSend({ type: "GET_ONBOARDING" });
  for (
    let attempt = 1;
    attempt < ONBOARDING_WAKE_ATTEMPTS && !last.ok;
    attempt += 1
  ) {
    const delay = ONBOARDING_WAKE_BASE_MS * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
    last = await activeSend({ type: "GET_ONBOARDING" });
  }
  return last;
}

/**
 * Shows the first-run overlay when `onboarding.completed === false`.
 * Returns true when the overlay is shown — caller should defer workflow warm-up
 * until `afterComplete` (or until this returns false).
 */
export async function maybeStartOnboarding(
  afterComplete?: () => void,
  deps: Partial<OnboardingDeps> = {},
): Promise<boolean> {
  beginOnboardingGate();
  activeSend = deps.sendToBackground ?? defaultSendToBackground;
  activeGetModel = deps.getLanguageModel ?? getLanguageModel;
  activePermissions = deps.permissionsApi;
  onComplete = afterComplete;
  wireControls();
  fillSmartEducation();

  const response = await fetchOnboardingState();
  if (!response.ok) {
    endOnboardingGate();
    setText(statusLineEl(), `Background unreachable — ${response.error}`);
    showOverlay(false);
    return false;
  }

  if (response.onboarding.completed) {
    endOnboardingGate();
    showOverlay(false);
    return false;
  }

  const settings = await activeSend({ type: "GET_SETTINGS" });
  if (settings.ok) {
    chosenDestination = settings.settings.defaultDestination;
    const destinationSelect = destinationSelectEl();
    if (destinationSelect) {
      destinationSelect.value = chosenDestination;
    }
  }

  showStep("welcome");
  showOverlay(true);
  return true;
}

export function isOnboardingVisible(): boolean {
  const overlay = overlayEl();
  return Boolean(overlay && !overlay.hasAttribute("hidden"));
}

/** Re-show after clear-all restores incomplete onboarding. */
export async function refreshOnboardingAfterClear(
  deps: Partial<OnboardingDeps> = {},
): Promise<void> {
  beginOnboardingGate();
  activeSend = deps.sendToBackground ?? defaultSendToBackground;
  activeGetModel = deps.getLanguageModel ?? getLanguageModel;
  const response = await activeSend({ type: "GET_ONBOARDING" });
  if (!response.ok || response.onboarding.completed) {
    endOnboardingGate();
    showOverlay(false);
    return;
  }
  showStep("welcome");
  showOverlay(true);
}

export function readCurrentOnboardingStep(): OnboardingStepId | null {
  return isOnboardingStepId(currentStep) ? currentStep : null;
}

export function readCurrentNanoStateForTests(): NanoReadinessState {
  return nanoState;
}

/** Test helper — resets module wiring between jsdom mounts. */
export function resetOnboardingForTests(): void {
  wired = false;
  currentStep = "welcome";
  chosenDestination = "copy";
  chosenMode = "smart";
  smartGranted = false;
  modeBusy = false;
  nanoState = "checking";
  downloading = false;
  onboardingGateActive = false;
  onComplete = undefined;
  activeSend = defaultSendToBackground;
  activeGetModel = getLanguageModel;
  activePermissions = undefined;
}
