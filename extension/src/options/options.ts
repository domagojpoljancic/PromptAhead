import { sendToBackground } from "../shared/messaging";
import {
  DESTINATION_IDS,
  DESTINATION_LABELS,
  isDestinationId,
  type Settings,
} from "../shared/storage/schema";

const destinationSelect = document.getElementById(
  "destination",
) as HTMLSelectElement | null;
const clearButton = document.getElementById("clear-all") as HTMLButtonElement | null;
const debugLine = document.getElementById("debug-line");

function setDebugLine(text: string): void {
  if (debugLine) {
    debugLine.textContent = text;
  }
}

function renderSettings(settings: Settings): void {
  if (destinationSelect) {
    destinationSelect.value = settings.defaultDestination;
  }
  setDebugLine(
    [
      `mode: ${settings.mode}`,
      `destination: ${DESTINATION_LABELS[settings.defaultDestination]}`,
      `nano: ${settings.nanoPreference}`,
      `history: ${settings.historyMode}`,
      `settings schema: v${settings.schemaVersion}`,
    ].join(" · "),
  );
}

function populateDestinations(): void {
  if (!destinationSelect) {
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
  const response = await sendToBackground({ type: "GET_SETTINGS" });
  if (!response.ok) {
    setDebugLine(`Background unreachable — ${response.error}`);
    return;
  }
  renderSettings(response.settings);
}

destinationSelect?.addEventListener("change", () => {
  const value = destinationSelect.value;
  if (!isDestinationId(value)) {
    return;
  }

  void sendToBackground({
    type: "SET_SETTINGS",
    patch: { defaultDestination: value },
  }).then((response) => {
    if (!response.ok) {
      setDebugLine(`Could not save — ${response.error}`);
      return;
    }
    renderSettings(response.settings);
  });
});

clearButton?.addEventListener("click", () => {
  if (!globalThis.confirm("Delete all local PromptAhead data on this device?")) {
    return;
  }

  void sendToBackground({ type: "CLEAR_ALL_DATA" }).then((response) => {
    if (!response.ok) {
      setDebugLine(`Could not clear data — ${response.error}`);
      return;
    }
    setDebugLine("All local PromptAhead data cleared. Reloading defaults…");
    void loadSettings();
  });
});

populateDestinations();
void loadSettings();

export {};
