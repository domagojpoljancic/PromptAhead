/**
 * First-run overlay in the side panel. Persists only via background messages.
 */

import { sendToBackground as defaultSendToBackground } from "../shared/messaging";
import {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  isDestinationId,
  type DestinationId,
} from "../shared/storage/schema";
import {
  buildOnboardingCompletion,
  isOnboardingStepId,
  nextOnboardingStep,
  previousOnboardingStep,
  type OnboardingStepId,
} from "./onboarding-flow";

export type OnboardingDeps = {
  sendToBackground: typeof defaultSendToBackground;
};

let wired = false;
let currentStep: OnboardingStepId = "welcome";
let chosenDestination: DestinationId = "copy";
let onComplete: (() => void) | undefined;
let activeSend: typeof defaultSendToBackground = defaultSendToBackground;

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

async function persistCompletion(skipped: boolean): Promise<boolean> {
  const destinationSelect = destinationSelectEl();
  if (destinationSelect && isDestinationId(destinationSelect.value)) {
    chosenDestination = destinationSelect.value;
  }

  const { onboarding, settings } = buildOnboardingCompletion({
    destination: chosenDestination,
    skipped,
    nanoSkipped: true,
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

  showOverlay(false);
  onComplete?.();
  return true;
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
    const action = target.closest<HTMLElement>("[data-onboarding-action]")
      ?.dataset.onboardingAction;
    if (!action) {
      return;
    }

    if (action === "next") {
      const next = nextOnboardingStep(currentStep);
      if (next === "complete") {
        void persistCompletion(false);
        return;
      }
      showStep(next);
      return;
    }

    if (action === "back") {
      const previous = previousOnboardingStep(currentStep);
      if (previous) {
        showStep(previous);
      }
      return;
    }

    if (action === "skip" || action === "finish") {
      void persistCompletion(action === "skip");
    }
  });
}

/**
 * Shows the first-run overlay when `onboarding.completed === false`.
 * Returns true when the overlay is shown (caller may still warm the workflow).
 */
export async function maybeStartOnboarding(
  afterComplete?: () => void,
  deps: Partial<OnboardingDeps> = {},
): Promise<boolean> {
  activeSend = deps.sendToBackground ?? defaultSendToBackground;
  onComplete = afterComplete;
  wireControls();

  const response = await activeSend({ type: "GET_ONBOARDING" });
  if (!response.ok) {
    setText(statusLineEl(), `Background unreachable — ${response.error}`);
    showOverlay(false);
    return false;
  }

  if (response.onboarding.completed) {
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
  activeSend = deps.sendToBackground ?? defaultSendToBackground;
  const response = await activeSend({ type: "GET_ONBOARDING" });
  if (!response.ok || response.onboarding.completed) {
    showOverlay(false);
    return;
  }
  showStep("welcome");
  showOverlay(true);
}

export function readCurrentOnboardingStep(): OnboardingStepId | null {
  return isOnboardingStepId(currentStep) ? currentStep : null;
}

/** Test helper — resets module wiring between jsdom mounts. */
export function resetOnboardingForTests(): void {
  wired = false;
  currentStep = "welcome";
  chosenDestination = "copy";
  onComplete = undefined;
  activeSend = defaultSendToBackground;
}
