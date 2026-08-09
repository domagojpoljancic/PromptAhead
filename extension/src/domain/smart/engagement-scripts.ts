/**
 * Register / unregister the Smart engagement content script when optional
 * host permission is present (DOM-33). Manual mode never registers this.
 */

import { SMART_HOST_ORIGINS } from "./host-permissions";

/** Stable id for `chrome.scripting.registerContentScripts`. */
export const ENGAGEMENT_CONTENT_SCRIPT_ID = "promptahead-engagement";

/**
 * Source path used in `manifest.config.ts` so CRXJS packages engagement-boot.
 * At runtime, prefer the hashed path from `chrome.runtime.getManifest()` —
 * the source path is not present under `extension/dist`.
 */
export const ENGAGEMENT_CONTENT_SCRIPT_JS = [
  "src/content/engagement-boot.ts",
] as const;

/** Dummy match in the static manifest; never used for live injection. */
export const ENGAGEMENT_MANIFEST_PACKAGE_MATCH =
  "https://promptahead.invalid/*";

export const ENGAGEMENT_CONTENT_SCRIPT_MATCHES = [
  "http://*/*",
  "https://*/*",
] as const;

export type ManifestContentScriptsSlice = {
  content_scripts?: Array<{ matches?: string[]; js?: string[] }>;
};

export type RegisteredContentScriptInfo = {
  id: string;
  js?: string[];
  matches?: string[];
};

export type ScriptingRegistrationApi = {
  getRegisteredContentScripts: (filter?: {
    ids?: string[];
  }) => Promise<RegisteredContentScriptInfo[]>;
  registerContentScripts: (
    scripts: Array<{
      id: string;
      js: string[];
      matches: string[];
      runAt?: "document_idle" | "document_start" | "document_end";
      persistAcrossSessions?: boolean;
    }>,
  ) => Promise<void>;
  unregisterContentScripts: (filter?: { ids?: string[] }) => Promise<void>;
};

export function getChromeScriptingRegistrationApi():
  | ScriptingRegistrationApi
  | undefined {
  const scripting = (
    globalThis as { chrome?: { scripting?: ScriptingRegistrationApi } }
  ).chrome?.scripting;
  if (
    !scripting ||
    typeof scripting.getRegisteredContentScripts !== "function" ||
    typeof scripting.registerContentScripts !== "function" ||
    typeof scripting.unregisterContentScripts !== "function"
  ) {
    return undefined;
  }
  return scripting;
}

export function getExtensionManifestContentScripts():
  | ManifestContentScriptsSlice
  | undefined {
  const getManifest = (
    globalThis as {
      chrome?: { runtime?: { getManifest?: () => ManifestContentScriptsSlice } };
    }
  ).chrome?.runtime?.getManifest;
  if (typeof getManifest !== "function") {
    return undefined;
  }
  try {
    return getManifest();
  } catch {
    return undefined;
  }
}

/**
 * Prefer an explicit CRXJS `?script` path, then the packaged dummy manifest
 * entry, then the source path (Vite mid-dev / unit tests).
 */
export function resolveEngagementContentScriptJs(
  manifest: ManifestContentScriptsSlice | undefined = getExtensionManifestContentScripts(),
  preferredJs?: readonly string[],
): string[] {
  if (preferredJs?.length) {
    return [...preferredJs];
  }
  const scripts = manifest?.content_scripts ?? [];
  const packaged =
    scripts.find((script) =>
      script.matches?.includes(ENGAGEMENT_MANIFEST_PACKAGE_MATCH),
    ) ??
    scripts.find((script) =>
      script.js?.some((path) => path.includes("engagement-boot")),
    );

  if (packaged?.js?.length) {
    return [...packaged.js];
  }
  return [...ENGAGEMENT_CONTENT_SCRIPT_JS];
}

function sameJsPaths(a: string[] | undefined, b: string[]): boolean {
  if (!a || a.length !== b.length) {
    return false;
  }
  return a.every((path, index) => path === b[index]);
}

export function smartOriginsGranted(
  origins: string[] | undefined,
): boolean {
  if (!origins?.length) {
    return false;
  }
  return SMART_HOST_ORIGINS.some((wanted) => origins.includes(wanted));
}

/**
 * Ensure the engagement content script is registered iff Smart host access
 * is granted. Idempotent. Re-registers when an existing entry still points at
 * a stale / non-packaged JS path.
 */
export async function syncEngagementContentScripts(
  granted: boolean,
  api: ScriptingRegistrationApi | undefined = getChromeScriptingRegistrationApi(),
  manifest: ManifestContentScriptsSlice | undefined = getExtensionManifestContentScripts(),
  preferredJs?: readonly string[],
): Promise<{ registered: boolean; error?: string; js?: string[] }> {
  if (!api) {
    return {
      registered: false,
      error: "Chrome scripting registration API is unavailable.",
    };
  }

  try {
    const existing = await api.getRegisteredContentScripts({
      ids: [ENGAGEMENT_CONTENT_SCRIPT_ID],
    });
    const current = existing.find(
      (script) => script.id === ENGAGEMENT_CONTENT_SCRIPT_ID,
    );
    const isRegistered = Boolean(current);

    if (!granted) {
      if (isRegistered) {
        await api.unregisterContentScripts({
          ids: [ENGAGEMENT_CONTENT_SCRIPT_ID],
        });
      }
      return { registered: false };
    }

    const js = resolveEngagementContentScriptJs(manifest, preferredJs);
    const needsRegister =
      !isRegistered || !sameJsPaths(current?.js, js);

    if (needsRegister) {
      if (isRegistered) {
        await api.unregisterContentScripts({
          ids: [ENGAGEMENT_CONTENT_SCRIPT_ID],
        });
      }
      await api.registerContentScripts([
        {
          id: ENGAGEMENT_CONTENT_SCRIPT_ID,
          js,
          matches: [...ENGAGEMENT_CONTENT_SCRIPT_MATCHES],
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    }

    // registerContentScripts only applies on next navigation — seed open tabs.
    await injectEngagementIntoOpenTabs(js);
    return { registered: true, js };
  } catch (error) {
    return {
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type TabsQueryApi = {
  query: (queryInfo: {
    url: string[];
  }) => Promise<Array<{ id?: number }>>;
};

export type ScriptingExecuteApi = {
  executeScript: (injection: {
    target: { tabId: number };
    files: string[];
  }) => Promise<unknown>;
};

function getChromeTabsQueryApi(): TabsQueryApi | undefined {
  const tabs = (globalThis as { chrome?: { tabs?: TabsQueryApi } }).chrome
    ?.tabs;
  if (!tabs || typeof tabs.query !== "function") {
    return undefined;
  }
  return tabs;
}

function getChromeExecuteScriptApi(): ScriptingExecuteApi | undefined {
  const scripting = (
    globalThis as { chrome?: { scripting?: ScriptingExecuteApi } }
  ).chrome?.scripting;
  if (!scripting || typeof scripting.executeScript !== "function") {
    return undefined;
  }
  return scripting;
}

/**
 * Best-effort inject into already-open http(s) tabs after Smart grant.
 * Restricted pages (chrome://, Web Store, etc.) fail quietly.
 */
export async function injectEngagementIntoOpenTabs(
  js: string[],
  tabsApi: TabsQueryApi | undefined = getChromeTabsQueryApi(),
  executeApi: ScriptingExecuteApi | undefined = getChromeExecuteScriptApi(),
): Promise<{ attempted: number; injected: number }> {
  if (!js.length || !tabsApi || !executeApi) {
    return { attempted: 0, injected: 0 };
  }

  let tabs: Array<{ id?: number }> = [];
  try {
    tabs = await tabsApi.query({
      url: [...ENGAGEMENT_CONTENT_SCRIPT_MATCHES],
    });
  } catch {
    return { attempted: 0, injected: 0 };
  }

  let injected = 0;
  await Promise.all(
    tabs.map(async (tab) => {
      if (typeof tab.id !== "number") {
        return;
      }
      try {
        await executeApi.executeScript({
          target: { tabId: tab.id },
          files: js,
        });
        injected += 1;
      } catch {
        // chrome://, PDF viewer, no host access on that tab, etc.
      }
    }),
  );
  return { attempted: tabs.length, injected };
}
