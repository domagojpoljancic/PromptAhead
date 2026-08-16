/**
 * Versioned `chrome.storage.local` schemas (architecture §4).
 * Every record carries its own `schemaVersion` so migrations can run on read.
 */

export const STORAGE_SCHEMA_VERSION = 1 as const;

export const STORAGE_KEYS = {
  settings: "settings.v1",
  recentHistory: "history.recent.v1",
  fullHistory: "history.full.v1",
  learningAggregates: "learning.aggregates.v1",
  /** Smart invite quota / snooze / page+domain caps / active badge (DOM-34/35). */
  inviteRuntime: "invite.runtime.v1",
  devLogs: "dev.logs.v1",
  onboarding: "onboarding.v1",
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Every PromptAhead-owned key — "Clear everything" wipes exactly this list. */
export const ALL_STORAGE_KEYS: readonly StorageKey[] = Object.values(STORAGE_KEYS);

export type PromptAheadMode = "manual" | "smart";

export type DestinationId = "copy" | "chatgpt" | "claude" | "gemini" | "perplexity";

export const DESTINATION_IDS: readonly DestinationId[] = [
  "copy",
  "chatgpt",
  "claude",
  "gemini",
  "perplexity",
];

export const DESTINATION_LABELS: Record<DestinationId, string> = {
  copy: "Copy only",
  chatgpt: "ChatGPT",
  claude: "Claude",
  gemini: "Gemini",
  perplexity: "Perplexity",
};

export type HistoryMode = "recent" | "full";

/** Nano stays off until M2; `skipped` is the Manual-first default. */
export type NanoPreference = "skipped" | "enabled" | "basic";

export type Settings = {
  schemaVersion: 1;
  mode: PromptAheadMode;
  /** True when optional Smart host permission (`<all_urls>`) is granted. */
  smartModeAvailable: boolean;
  defaultDestination: DestinationId;
  /** `null` means "follow the page language" (handoff §19). */
  languageOverride: string | null;
  nanoPreference: NanoPreference;
  /**
   * Faster on-device AI (DOM-66): catalog rank + warm session + curated-first UI.
   * Off → legacy full free-form Nano generate.
   */
  nanoFastPath: boolean;
  historyMode: HistoryMode;
  proactivePaused: boolean;
  excludedDomains: string[];
  developerMode: boolean;
};

export type PromptHistoryEntry = {
  id: string;
  createdAt: string;
  title: string;
  url: string;
  prompt: string;
  destination: DestinationId;
};

export type RecentHistory = {
  schemaVersion: 1;
  entries: PromptHistoryEntry[];
};

/** Handoff §16: latest three prompts unless the user opts into full history. */
export const RECENT_HISTORY_LIMIT = 3;

/** Typed but unwritten until M3 opt-in. */
export type FullHistory = {
  schemaVersion: 1;
  entries: PromptHistoryEntry[];
};

/** Typed but unwritten until M3 learning lands — aggregates only, never URLs. */
export type LearningAggregates = {
  schemaVersion: 1;
  actionCategoryCounts: Record<string, number>;
  invitationsAccepted: number;
  invitationsDismissed: number;
};

/** Persisted Smart invite caps + which tab currently owns the badge. */
export type ActiveInviteRecord = {
  tabId: number;
  pageUrl: string;
  domain: string;
  pageType: "article" | "product" | "generic";
};

/** Last engagement→invite machine outcome (developer / smoke diagnostics). */
export type LastInviteEvent = {
  at: string;
  url: string;
  pageType: string;
  showBadge: boolean;
  suppression: string | null;
  reason: string;
  invitesToday: number;
  domainsInvitedToday: string[];
};

export type InviteRuntimeState = {
  schemaVersion: 1;
  quotaDayKey: string;
  invitesToday: number;
  domainsInvitedToday: string[];
  /** Normalized page keys invited today (once-per-page; no browsing-history dump). */
  pagesInvitedToday: string[];
  snoozeUntilDayKey: string | null;
  activeInvite: ActiveInviteRecord | null;
  lastInviteEvent: LastInviteEvent | null;
};

export const EMPTY_INVITE_RUNTIME = (dayKey: string): InviteRuntimeState => ({
  schemaVersion: STORAGE_SCHEMA_VERSION,
  quotaDayKey: dayKey,
  invitesToday: 0,
  domainsInvitedToday: [],
  pagesInvitedToday: [],
  snoozeUntilDayKey: null,
  activeInvite: null,
  lastInviteEvent: null,
});

/** Typed but unwritten until developer mode lands (handoff §20). */
export type DevLogs = {
  schemaVersion: 1;
  events: Array<{ at: string; kind: string; detail?: string }>;
};

export type OnboardingState = {
  schemaVersion: 1;
  completed: boolean;
  completedAt: string | null;
  modeChosen: boolean;
  destinationChosen: boolean;
  /** Nano setup is skippable in M1 and re-offered in M2. */
  nanoStepSkipped: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  mode: "manual",
  smartModeAvailable: false,
  defaultDestination: "copy",
  languageOverride: null,
  nanoPreference: "skipped",
  nanoFastPath: true,
  historyMode: "recent",
  proactivePaused: false,
  excludedDomains: [],
  developerMode: false,
};

export const DEFAULT_RECENT_HISTORY: RecentHistory = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  entries: [],
};

export const DEFAULT_ONBOARDING: OnboardingState = {
  schemaVersion: STORAGE_SCHEMA_VERSION,
  completed: false,
  completedAt: null,
  modeChosen: false,
  destinationChosen: false,
  nanoStepSkipped: false,
};

export type SettingsPatch = Partial<Omit<Settings, "schemaVersion">>;
export type OnboardingPatch = Partial<Omit<OnboardingState, "schemaVersion">>;

export function isDestinationId(value: unknown): value is DestinationId {
  return (
    typeof value === "string" && (DESTINATION_IDS as readonly string[]).includes(value)
  );
}
