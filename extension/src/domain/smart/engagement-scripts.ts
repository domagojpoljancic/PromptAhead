/**
 * Register / unregister the Smart engagement content script when optional
 * host permission is present (DOM-33). Manual mode never registers this.
 */

import { SMART_HOST_ORIGINS } from "./host-permissions";

/** Stable id for `chrome.scripting.registerContentScripts`. */
export const ENGAGEMENT_CONTENT_SCRIPT_ID = "promptahead-engagement";

/**
 * Built by CRXJS from `src/content/engagement-boot.ts`. The dummy static
 * content_scripts entry in the manifest ensures the file is packaged; runtime
 * registration uses the real http(s) matches after Smart grant.
 */
export const ENGAGEMENT_CONTENT_SCRIPT_JS = [
  "src/content/engagement-boot.ts",
] as const;

export const ENGAGEMENT_CONTENT_SCRIPT_MATCHES = [
  "http://*/*",
  "https://*/*",
] as const;

export type ScriptingRegistrationApi = {
  getRegisteredContentScripts: (filter?: {
    ids?: string[];
  }) => Promise<Array<{ id: string }>>;
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
 * is granted. Idempotent.
 */
export async function syncEngagementContentScripts(
  granted: boolean,
  api: ScriptingRegistrationApi | undefined = getChromeScriptingRegistrationApi(),
): Promise<{ registered: boolean; error?: string }> {
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
    const isRegistered = existing.some(
      (script) => script.id === ENGAGEMENT_CONTENT_SCRIPT_ID,
    );

    if (!granted) {
      if (isRegistered) {
        await api.unregisterContentScripts({
          ids: [ENGAGEMENT_CONTENT_SCRIPT_ID],
        });
      }
      return { registered: false };
    }

    if (!isRegistered) {
      await api.registerContentScripts([
        {
          id: ENGAGEMENT_CONTENT_SCRIPT_ID,
          js: [...ENGAGEMENT_CONTENT_SCRIPT_JS],
          matches: [...ENGAGEMENT_CONTENT_SCRIPT_MATCHES],
          runAt: "document_idle",
          persistAcrossSessions: true,
        },
      ]);
    }
    return { registered: true };
  } catch (error) {
    return {
      registered: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
