import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  RECENT_HISTORY_LIMIT,
  STORAGE_KEYS,
  addRecentPrompt,
  clearAllPromptAheadData,
  ensureDefaults,
  readOnboarding,
  readRecentHistory,
  readSettings,
  updateSettings,
} from "../../extension/src/shared/storage";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from "./helpers/chrome-mock";

let mock: ChromeMock;

beforeEach(() => {
  mock = installChromeMock();
});

afterEach(() => {
  uninstallChromeMock();
});

describe("settings storage", () => {
  it("returns Manual-first defaults when nothing is stored", async () => {
    const settings = await readSettings();

    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.mode).toBe("manual");
    expect(settings.smartModeAvailable).toBe(false);
    expect(settings.nanoPreference).toBe("skipped");
    expect(settings.defaultDestination).toBe("copy");
  });

  it("writes defaults for missing records on install", async () => {
    await ensureDefaults();

    expect(mock.storage[STORAGE_KEYS.settings]).toEqual(DEFAULT_SETTINGS);
    expect(await readOnboarding()).toMatchObject({
      schemaVersion: 1,
      completed: false,
    });
  });

  it("merges patches and keeps the schema version", async () => {
    const updated = await updateSettings({
      defaultDestination: "claude",
      developerMode: true,
    });

    expect(updated.defaultDestination).toBe("claude");
    expect(updated.developerMode).toBe(true);
    expect(updated.schemaVersion).toBe(1);
    expect(await readSettings()).toEqual(updated);
  });

  it("serializes concurrent updates instead of losing one", async () => {
    await Promise.all([
      updateSettings({ defaultDestination: "gemini" }),
      updateSettings({ developerMode: true }),
      updateSettings({ languageOverride: "hr" }),
    ]);

    const settings = await readSettings();
    expect(settings.defaultDestination).toBe("gemini");
    expect(settings.developerMode).toBe(true);
    expect(settings.languageOverride).toBe("hr");
  });
});

describe("settings migration", () => {
  it("upgrades an unversioned v0 record on read and persists it", async () => {
    uninstallChromeMock();
    mock = installChromeMock({
      initialStorage: {
        [STORAGE_KEYS.settings]: {
          mode: "manual",
          destination: "perplexity",
          language: "hr",
          history: "full",
        },
      },
    });

    const settings = await readSettings();

    expect(settings.schemaVersion).toBe(1);
    expect(settings.defaultDestination).toBe("perplexity");
    expect(settings.languageOverride).toBe("hr");
    expect(settings.historyMode).toBe("full");
    expect(mock.storage[STORAGE_KEYS.settings]).toEqual(settings);
  });

  it("falls back to defaults for records from a newer schema", async () => {
    uninstallChromeMock();
    mock = installChromeMock({
      initialStorage: {
        [STORAGE_KEYS.settings]: { schemaVersion: 99, defaultDestination: "chatgpt" },
      },
    });

    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("drops malformed history entries", async () => {
    uninstallChromeMock();
    mock = installChromeMock({
      initialStorage: {
        [STORAGE_KEYS.recentHistory]: {
          schemaVersion: 1,
          entries: [
            { prompt: "kept", title: "t", url: "u", destination: "copy" },
            { junk: true },
          ],
        },
      },
    });

    const history = await readRecentHistory();
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]?.prompt).toBe("kept");
  });
});

describe("recent history", () => {
  it("keeps only the latest three prompts, newest first", async () => {
    for (const prompt of ["one", "two", "three", "four"]) {
      await addRecentPrompt({
        title: prompt,
        url: `https://example.com/${prompt}`,
        prompt,
        destination: "copy",
      });
    }

    const history = await readRecentHistory();
    expect(history.entries).toHaveLength(RECENT_HISTORY_LIMIT);
    expect(history.entries.map((entry) => entry.prompt)).toEqual([
      "four",
      "three",
      "two",
    ]);
  });
});

describe("clearAllPromptAheadData", () => {
  it("removes every PromptAhead-owned key and nothing else", async () => {
    uninstallChromeMock();
    mock = installChromeMock({
      initialStorage: {
        [STORAGE_KEYS.settings]: { schemaVersion: 1 },
        [STORAGE_KEYS.recentHistory]: { schemaVersion: 1, entries: [] },
        [STORAGE_KEYS.fullHistory]: { schemaVersion: 1, entries: [] },
        [STORAGE_KEYS.learningAggregates]: { schemaVersion: 1 },
        [STORAGE_KEYS.devLogs]: { schemaVersion: 1, events: [] },
        [STORAGE_KEYS.onboarding]: { schemaVersion: 1 },
        "someone-elses-key": { keep: true },
      },
    });

    await clearAllPromptAheadData();

    expect(Object.keys(mock.storage)).toEqual(["someone-elses-key"]);
    expect(await readSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
