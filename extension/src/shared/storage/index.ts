/**
 * The only module allowed to touch `chrome.storage` (architecture §3).
 * UI and domain code go through these helpers or through background messages.
 */

import {
  migrateOnboarding,
  migrateRecentHistory,
  migrateSettings,
  type MigrationResult,
} from "./migrations";
import {
  ALL_STORAGE_KEYS,
  DEFAULT_RECENT_HISTORY,
  RECENT_HISTORY_LIMIT,
  STORAGE_KEYS,
  STORAGE_SCHEMA_VERSION,
  type OnboardingPatch,
  type OnboardingState,
  type PromptHistoryEntry,
  type RecentHistory,
  type Settings,
  type SettingsPatch,
  type StorageKey,
} from "./schema";

export * from "./schema";
export { migrateOnboarding, migrateRecentHistory, migrateSettings } from "./migrations";
export type { MigrationResult } from "./migrations";

function localArea(): chrome.storage.StorageArea {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    throw new Error("chrome.storage.local is unavailable in this context");
  }
  return chrome.storage.local;
}

async function readRaw(key: StorageKey): Promise<unknown> {
  const stored = (await localArea().get(key)) as Record<string, unknown>;
  return stored[key];
}

async function writeRaw(key: StorageKey, value: unknown): Promise<void> {
  await localArea().set({ [key]: value });
}

/**
 * Read-modify-write cycles from the panel, options page and service worker can
 * interleave, so all mutations run one at a time through a single chain.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function readMigrated<T>(
  key: StorageKey,
  migrate: (raw: unknown) => MigrationResult<T>,
): Promise<T> {
  const { value, migrated } = migrate(await readRaw(key));
  if (migrated) {
    await enqueueWrite(() => writeRaw(key, value));
  }
  return value;
}

export async function readSettings(): Promise<Settings> {
  return readMigrated(STORAGE_KEYS.settings, migrateSettings);
}

export async function writeSettings(settings: Settings): Promise<Settings> {
  const next: Settings = { ...settings, schemaVersion: STORAGE_SCHEMA_VERSION };
  await enqueueWrite(() => writeRaw(STORAGE_KEYS.settings, next));
  return next;
}

export async function updateSettings(patch: SettingsPatch): Promise<Settings> {
  return enqueueWrite(async () => {
    const current = migrateSettings(await readRaw(STORAGE_KEYS.settings)).value;
    const next: Settings = {
      ...current,
      ...patch,
      schemaVersion: STORAGE_SCHEMA_VERSION,
    };
    await writeRaw(STORAGE_KEYS.settings, next);
    return next;
  });
}

export async function readOnboarding(): Promise<OnboardingState> {
  return readMigrated(STORAGE_KEYS.onboarding, migrateOnboarding);
}

export async function updateOnboarding(
  patch: OnboardingPatch,
): Promise<OnboardingState> {
  return enqueueWrite(async () => {
    const current = migrateOnboarding(await readRaw(STORAGE_KEYS.onboarding)).value;
    const next: OnboardingState = {
      ...current,
      ...patch,
      schemaVersion: STORAGE_SCHEMA_VERSION,
    };
    await writeRaw(STORAGE_KEYS.onboarding, next);
    return next;
  });
}

export async function readRecentHistory(): Promise<RecentHistory> {
  return readMigrated(STORAGE_KEYS.recentHistory, migrateRecentHistory);
}

export type NewPromptHistoryEntry = Omit<PromptHistoryEntry, "id" | "createdAt"> &
  Partial<Pick<PromptHistoryEntry, "id" | "createdAt">>;

export async function addRecentPrompt(
  entry: NewPromptHistoryEntry,
): Promise<RecentHistory> {
  return enqueueWrite(async () => {
    const current = migrateRecentHistory(
      await readRaw(STORAGE_KEYS.recentHistory),
    ).value;
    const stored: PromptHistoryEntry = {
      id: entry.id ?? crypto.randomUUID(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      title: entry.title,
      url: entry.url,
      prompt: entry.prompt,
      destination: entry.destination,
    };
    const next: RecentHistory = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      entries: [stored, ...current.entries].slice(0, RECENT_HISTORY_LIMIT),
    };
    await writeRaw(STORAGE_KEYS.recentHistory, next);
    return next;
  });
}

export async function clearRecentHistory(): Promise<RecentHistory> {
  const empty: RecentHistory = { ...DEFAULT_RECENT_HISTORY, entries: [] };
  await enqueueWrite(() => writeRaw(STORAGE_KEYS.recentHistory, empty));
  return empty;
}

/** Wipes category-level aggregates (M3 learning). Safe no-op when unused. */
export async function clearLearningAggregates(): Promise<void> {
  await enqueueWrite(() => localArea().remove(STORAGE_KEYS.learningAggregates));
}

/** Writes defaults for any record missing on first run (or after a wipe). */
export async function ensureDefaults(): Promise<{
  settings: Settings;
  onboarding: OnboardingState;
}> {
  return enqueueWrite(async () => {
    const stored = (await localArea().get([
      STORAGE_KEYS.settings,
      STORAGE_KEYS.onboarding,
    ])) as Record<string, unknown>;

    const settings = migrateSettings(stored[STORAGE_KEYS.settings]).value;
    const onboarding = migrateOnboarding(stored[STORAGE_KEYS.onboarding]).value;

    await localArea().set({
      [STORAGE_KEYS.settings]: settings,
      [STORAGE_KEYS.onboarding]: onboarding,
    });

    return { settings, onboarding };
  });
}

/**
 * Handoff §19 "Clear all local PromptAhead data" — wipes every owned key,
 * then restores Manual-first defaults and incomplete onboarding.
 */
export async function clearAllPromptAheadData(): Promise<{
  settings: Settings;
  onboarding: OnboardingState;
}> {
  await enqueueWrite(() => localArea().remove([...ALL_STORAGE_KEYS]));
  return ensureDefaults();
}
