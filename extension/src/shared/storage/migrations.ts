/**
 * Migration-on-read. Records written before versioning existed (no
 * `schemaVersion` field) are treated as v0 and upgraded field by field.
 * Records from a *newer* schema than this build understands fall back to
 * defaults rather than being partially trusted.
 */

import {
  DEFAULT_ONBOARDING,
  DEFAULT_RECENT_HISTORY,
  DEFAULT_SETTINGS,
  EMPTY_INVITE_RUNTIME,
  RECENT_HISTORY_LIMIT,
  STORAGE_SCHEMA_VERSION,
  isDestinationId,
  type ActiveInviteRecord,
  type HistoryMode,
  type InviteRuntimeState,
  type NanoPreference,
  type OnboardingState,
  type PromptAheadMode,
  type PromptHistoryEntry,
  type RecentHistory,
  type Settings,
} from "./schema";

export type MigrationResult<T> = {
  value: T;
  /** True when the stored record differed from the current schema. */
  migrated: boolean;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function readVersion(record: UnknownRecord): number {
  return typeof record.schemaVersion === "number" ? record.schemaVersion : 0;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function pickStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...(value as string[])]
    : fallback;
}

function pickMode(value: unknown): PromptAheadMode {
  return value === "smart" ? "smart" : DEFAULT_SETTINGS.mode;
}

function pickNanoPreference(value: unknown): NanoPreference {
  return value === "enabled" || value === "basic" || value === "skipped"
    ? value
    : DEFAULT_SETTINGS.nanoPreference;
}

function pickHistoryMode(value: unknown): HistoryMode {
  return value === "full" ? "full" : DEFAULT_SETTINGS.historyMode;
}

export function migrateSettings(raw: unknown): MigrationResult<Settings> {
  const record = asRecord(raw);
  if (!record) {
    return { value: { ...DEFAULT_SETTINGS }, migrated: false };
  }

  const version = readVersion(record);
  if (version > STORAGE_SCHEMA_VERSION) {
    return { value: { ...DEFAULT_SETTINGS }, migrated: true };
  }

  // v0 used flat, unversioned names; keep reading them so early installs survive.
  const destination = record.defaultDestination ?? record.destination;
  const language = record.languageOverride ?? record.language;
  const historyMode = record.historyMode ?? record.history;

  const value: Settings = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    mode: pickMode(record.mode),
    smartModeAvailable: pickBoolean(
      record.smartModeAvailable,
      DEFAULT_SETTINGS.smartModeAvailable,
    ),
    defaultDestination: isDestinationId(destination)
      ? destination
      : DEFAULT_SETTINGS.defaultDestination,
    languageOverride:
      typeof language === "string" && language.length > 0 ? language : null,
    nanoPreference: pickNanoPreference(record.nanoPreference ?? record.nano),
    historyMode: pickHistoryMode(historyMode),
    proactivePaused: pickBoolean(
      record.proactivePaused,
      DEFAULT_SETTINGS.proactivePaused,
    ),
    excludedDomains: pickStringArray(record.excludedDomains, [
      ...DEFAULT_SETTINGS.excludedDomains,
    ]),
    developerMode: pickBoolean(record.developerMode, DEFAULT_SETTINGS.developerMode),
  };

  return { value, migrated: version !== STORAGE_SCHEMA_VERSION };
}

function migrateHistoryEntry(raw: unknown): PromptHistoryEntry | null {
  const record = asRecord(raw);
  if (!record || typeof record.prompt !== "string") {
    return null;
  }

  return {
    id: pickString(record.id, crypto.randomUUID()),
    createdAt: pickString(record.createdAt, new Date(0).toISOString()),
    title: pickString(record.title, ""),
    url: pickString(record.url, ""),
    prompt: record.prompt,
    destination: isDestinationId(record.destination) ? record.destination : "copy",
  };
}

export function migrateRecentHistory(raw: unknown): MigrationResult<RecentHistory> {
  const record = asRecord(raw);
  if (!record) {
    return { value: { ...DEFAULT_RECENT_HISTORY, entries: [] }, migrated: false };
  }

  const version = readVersion(record);
  if (version > STORAGE_SCHEMA_VERSION) {
    return { value: { ...DEFAULT_RECENT_HISTORY, entries: [] }, migrated: true };
  }

  // v0 stored a bare array under the key instead of a wrapper object.
  const rawEntries = Array.isArray(record.entries) ? record.entries : [];
  const entries = rawEntries
    .map(migrateHistoryEntry)
    .filter((entry): entry is PromptHistoryEntry => entry !== null)
    .slice(0, RECENT_HISTORY_LIMIT);

  return {
    value: { schemaVersion: STORAGE_SCHEMA_VERSION, entries },
    migrated:
      version !== STORAGE_SCHEMA_VERSION || entries.length !== rawEntries.length,
  };
}

export function migrateOnboarding(raw: unknown): MigrationResult<OnboardingState> {
  const record = asRecord(raw);
  if (!record) {
    return { value: { ...DEFAULT_ONBOARDING }, migrated: false };
  }

  const version = readVersion(record);
  if (version > STORAGE_SCHEMA_VERSION) {
    return { value: { ...DEFAULT_ONBOARDING }, migrated: true };
  }

  const completedAt = record.completedAt;
  const value: OnboardingState = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    completed: pickBoolean(record.completed, DEFAULT_ONBOARDING.completed),
    completedAt: typeof completedAt === "string" ? completedAt : null,
    modeChosen: pickBoolean(record.modeChosen, DEFAULT_ONBOARDING.modeChosen),
    destinationChosen: pickBoolean(
      record.destinationChosen,
      DEFAULT_ONBOARDING.destinationChosen,
    ),
    nanoStepSkipped: pickBoolean(
      record.nanoStepSkipped,
      DEFAULT_ONBOARDING.nanoStepSkipped,
    ),
  };

  return { value, migrated: version !== STORAGE_SCHEMA_VERSION };
}

function pickPageType(value: unknown): ActiveInviteRecord["pageType"] | null {
  return value === "article" || value === "product" || value === "generic"
    ? value
    : null;
}

function migrateActiveInvite(raw: unknown): ActiveInviteRecord | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }
  const pageType = pickPageType(record.pageType);
  if (
    typeof record.tabId !== "number" ||
    typeof record.pageUrl !== "string" ||
    typeof record.domain !== "string" ||
    !pageType
  ) {
    return null;
  }
  return {
    tabId: record.tabId,
    pageUrl: record.pageUrl,
    domain: record.domain,
    pageType,
  };
}

export function migrateInviteRuntime(
  raw: unknown,
  dayKeyFallback: string = new Date().toISOString().slice(0, 10),
): MigrationResult<InviteRuntimeState> {
  const record = asRecord(raw);
  if (!record) {
    return { value: EMPTY_INVITE_RUNTIME(dayKeyFallback), migrated: false };
  }

  const version = readVersion(record);
  if (version > STORAGE_SCHEMA_VERSION) {
    return { value: EMPTY_INVITE_RUNTIME(dayKeyFallback), migrated: true };
  }

  const quotaDayKey = pickString(record.quotaDayKey, dayKeyFallback);
  const invitesToday =
    typeof record.invitesToday === "number" && record.invitesToday >= 0
      ? Math.floor(record.invitesToday)
      : 0;
  const snooze =
    typeof record.snoozeUntilDayKey === "string" ? record.snoozeUntilDayKey : null;

  const domainsInvitedToday = pickStringArray(record.domainsInvitedToday, []);
  const pagesInvitedToday = pickStringArray(record.pagesInvitedToday, []);
  const hadPagesField = Array.isArray(record.pagesInvitedToday);

  const value: InviteRuntimeState = {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    quotaDayKey,
    invitesToday,
    domainsInvitedToday,
    pagesInvitedToday,
    snoozeUntilDayKey: snooze,
    activeInvite: migrateActiveInvite(record.activeInvite),
  };

  return {
    value,
    migrated: version !== STORAGE_SCHEMA_VERSION || !hadPagesField,
  };
}
