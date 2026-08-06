/**
 * Optional Smart-mode host permission (S0.6 / DOM-32).
 *
 * `permissions.request` needs a user gesture in a document context
 * (options / side panel) — never call it from the service worker.
 */

export const SMART_HOST_ORIGINS = ["<all_urls>"] as const;

export type PermissionsApi = {
  contains: (details: { origins?: string[] }) => Promise<boolean>;
  request: (details: { origins?: string[] }) => Promise<boolean>;
  remove: (details: { origins?: string[] }) => Promise<boolean>;
};

export type SmartPermissionEducation = {
  /** Short lead for Settings / onboarding. */
  summary: string;
  /** Bullet points shown before Chrome’s own prompt. */
  bullets: readonly string[];
  /** Honest note — macOS may suppress system notification banners. */
  inviteHonesty: string;
};

/**
 * Plain-language education before `permissions.request` (handoff §8).
 * Never promises a system banner macOS may hide.
 */
export const SMART_PERMISSION_EDUCATION: SmartPermissionEducation = {
  summary:
    "Smart mode needs optional access to websites so PromptAhead can notice when you are reading or shopping and offer help. Chrome will show its own permission dialog next.",
  bullets: [
    "Access is used for local engagement detection and page extraction on this device.",
    "Page content is not sent to a PromptAhead server or to third parties by PromptAhead.",
    "Sensitive pages (banking, passwords, medical, and similar) stay blocked from proactive analysis.",
    "You can switch back to Manual or revoke website access anytime in Settings.",
  ],
  inviteHonesty:
    "Invites use an in-browser badge first. A system notification may appear later when that feature lands — macOS can hide those banners, so PromptAhead never depends on one.",
};

export function getChromePermissionsApi(): PermissionsApi | undefined {
  const permissions = (
    globalThis as { chrome?: { permissions?: PermissionsApi } }
  ).chrome?.permissions;
  if (
    !permissions ||
    typeof permissions.contains !== "function" ||
    typeof permissions.request !== "function" ||
    typeof permissions.remove !== "function"
  ) {
    return undefined;
  }
  return permissions;
}

function originsPayload(): { origins: string[] } {
  return { origins: [...SMART_HOST_ORIGINS] };
}

export async function hasSmartHostPermission(
  api: PermissionsApi | undefined = getChromePermissionsApi(),
): Promise<boolean> {
  if (!api) {
    return false;
  }
  try {
    return Boolean(await api.contains(originsPayload()));
  } catch {
    return false;
  }
}

export type HostPermissionOutcome = {
  ok: boolean;
  /** True when Chrome reports the permission is present after the call. */
  granted: boolean;
  error?: string;
};

export async function requestSmartHostPermission(
  api: PermissionsApi | undefined = getChromePermissionsApi(),
): Promise<HostPermissionOutcome> {
  if (!api) {
    return {
      ok: false,
      granted: false,
      error: "Chrome permissions API is unavailable in this context.",
    };
  }
  try {
    const granted = Boolean(await api.request(originsPayload()));
    return { ok: granted, granted };
  } catch (error) {
    return {
      ok: false,
      granted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function revokeSmartHostPermission(
  api: PermissionsApi | undefined = getChromePermissionsApi(),
): Promise<HostPermissionOutcome> {
  if (!api) {
    return {
      ok: false,
      granted: true,
      error: "Chrome permissions API is unavailable in this context.",
    };
  }
  try {
    const removed = Boolean(await api.remove(originsPayload()));
    const stillGranted = removed ? false : await hasSmartHostPermission(api);
    return {
      ok: removed || !stillGranted,
      granted: stillGranted,
      error: removed
        ? undefined
        : stillGranted
          ? "Chrome did not revoke website access."
          : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      granted: true,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Settings patch after a successful Smart grant. */
export function settingsAfterSmartGrant(): {
  mode: "smart";
  smartModeAvailable: true;
} {
  return { mode: "smart", smartModeAvailable: true };
}

/** Settings patch after revoke (or choosing Manual). */
export function settingsAfterSmartRevoke(): {
  mode: "manual";
  smartModeAvailable: false;
} {
  return { mode: "manual", smartModeAvailable: false };
}
