export type SpikeId =
  | "S0.1"
  | "S0.2"
  | "S0.3"
  | "S0.4"
  | "S0.5"
  | "S0.6"
  | "S0.7";

/**
 * Prompt API spikes must execute in the realm under test (side panel / options
 * page), so the service worker refuses to run them on a caller's behalf.
 */
export type DocumentSpikeId = Extract<SpikeId, "S0.1" | "S0.2" | "S0.3">;

export const DOCUMENT_SPIKE_IDS: readonly DocumentSpikeId[] = [
  "S0.1",
  "S0.2",
  "S0.3",
];

export function isDocumentSpike(spikeId: string): spikeId is DocumentSpikeId {
  return (DOCUMENT_SPIKE_IDS as readonly string[]).includes(spikeId);
}

export type SpikeLogLevel = "info" | "warn" | "error" | "success";

export type SpikeStatus = "idle" | "running" | "pass" | "fail" | "blocked";

export interface SpikeLogEntry {
  timestamp: string;
  level: SpikeLogLevel;
  message: string;
}

export interface SpikeResult {
  spikeId: SpikeId;
  status: SpikeStatus;
  entries: SpikeLogEntry[];
  updatedAt: string;
}

export interface SpikeDefinition {
  id: SpikeId;
  title: string;
  question: string;
}

export const SPIKE_DEFINITIONS: SpikeDefinition[] = [
  {
    id: "S0.1",
    title: "Prompt API contexts",
    question:
      "Does LanguageModel work in side panel, options page, and service worker?",
  },
  {
    id: "S0.2",
    title: "Availability + download",
    question:
      "availability(), user-activated create(), and downloadprogress events",
  },
  {
    id: "S0.3",
    title: "Structured JSON",
    question: "responseConstraint schema for action list generation",
  },
  {
    id: "S0.4",
    title: "Side Panel open paths",
    question: "Open from toolbar, notification click, and context menu",
  },
  {
    id: "S0.5",
    title: "Manual activeTab",
    question:
      "Extract on action click without host_permissions; panel follow-up scripting",
  },
  {
    id: "S0.6",
    title: "Optional hosts",
    question: "permissions.request / remove / contains grant and revoke",
  },
  {
    id: "S0.7",
    title: "Notifications",
    question: "Badge + compact notification opens panel without page injection",
  },
];
