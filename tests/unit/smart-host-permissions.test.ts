import { describe, expect, it, vi } from "vitest";

import {
  ENGAGEMENT_CONTENT_SCRIPT_ID,
  ENGAGEMENT_CONTENT_SCRIPT_JS,
  ENGAGEMENT_CONTENT_SCRIPT_MATCHES,
  SMART_HOST_ORIGINS,
  SMART_PERMISSION_EDUCATION,
  hasSmartHostPermission,
  requestSmartHostPermission,
  revokeSmartHostPermission,
  settingsAfterSmartGrant,
  settingsAfterSmartRevoke,
  smartOriginsGranted,
  syncEngagementContentScripts,
  type PermissionsApi,
  type ScriptingRegistrationApi,
} from "../../extension/src/domain/smart";

function mockPermissions(state: { granted: boolean }): PermissionsApi {
  return {
    contains: vi.fn(async () => state.granted),
    request: vi.fn(async () => {
      state.granted = true;
      return true;
    }),
    remove: vi.fn(async () => {
      state.granted = false;
      return true;
    }),
  };
}

function mockScripting(state: { ids: string[] }): ScriptingRegistrationApi {
  return {
    getRegisteredContentScripts: vi.fn(async () =>
      state.ids.map((id) => ({ id })),
    ),
    registerContentScripts: vi.fn(async (scripts) => {
      for (const script of scripts) {
        if (!state.ids.includes(script.id)) {
          state.ids.push(script.id);
        }
      }
    }),
    unregisterContentScripts: vi.fn(async (filter) => {
      const remove = new Set(filter?.ids ?? []);
      state.ids = state.ids.filter((id) => !remove.has(id));
    }),
  };
}

describe("smart host permissions", () => {
  it("targets optional <all_urls> only", () => {
    expect([...SMART_HOST_ORIGINS]).toEqual(["<all_urls>"]);
  });

  it("education copy never promises a system banner", () => {
    const blob = [
      SMART_PERMISSION_EDUCATION.summary,
      ...SMART_PERMISSION_EDUCATION.bullets,
      SMART_PERMISSION_EDUCATION.inviteHonesty,
    ].join(" ");
    expect(blob).toMatch(/badge first/i);
    expect(blob).toMatch(/macOS can hide/i);
    expect(blob.toLowerCase()).not.toMatch(/will always show a (system )?banner/);
    expect(blob.toLowerCase()).not.toMatch(/guarantees? (a )?notification/);
  });

  it("reports contains / request / remove outcomes", async () => {
    const state = { granted: false };
    const api = mockPermissions(state);

    expect(await hasSmartHostPermission(api)).toBe(false);

    const granted = await requestSmartHostPermission(api);
    expect(granted).toEqual({ ok: true, granted: true });
    expect(api.request).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(await hasSmartHostPermission(api)).toBe(true);

    const revoked = await revokeSmartHostPermission(api);
    expect(revoked).toEqual({ ok: true, granted: false });
    expect(api.remove).toHaveBeenCalledWith({ origins: ["<all_urls>"] });
    expect(await hasSmartHostPermission(api)).toBe(false);
  });

  it("returns a clear error when the permissions API is missing", async () => {
    await expect(requestSmartHostPermission(undefined)).resolves.toMatchObject({
      ok: false,
      granted: false,
      error: expect.stringMatching(/unavailable/i),
    });
  });

  it("maps grant and revoke to Manual/Smart settings patches", () => {
    expect(settingsAfterSmartGrant()).toEqual({
      mode: "smart",
      smartModeAvailable: true,
    });
    expect(settingsAfterSmartRevoke()).toEqual({
      mode: "manual",
      smartModeAvailable: false,
    });
  });
});

describe("engagement content-script sync after Smart grant", () => {
  it("detects Smart host origins in permission payloads", () => {
    expect(smartOriginsGranted(["<all_urls>"])).toBe(true);
    expect(smartOriginsGranted(["https://example.com/*"])).toBe(false);
    expect(smartOriginsGranted(undefined)).toBe(false);
  });

  it("registers the engagement boot script when granted", async () => {
    const state = { ids: [] as string[] };
    const api = mockScripting(state);

    await expect(syncEngagementContentScripts(true, api)).resolves.toEqual({
      registered: true,
    });
    expect(api.registerContentScripts).toHaveBeenCalledWith([
      {
        id: ENGAGEMENT_CONTENT_SCRIPT_ID,
        js: [...ENGAGEMENT_CONTENT_SCRIPT_JS],
        matches: [...ENGAGEMENT_CONTENT_SCRIPT_MATCHES],
        runAt: "document_idle",
        persistAcrossSessions: true,
      },
    ]);
    expect(state.ids).toEqual([ENGAGEMENT_CONTENT_SCRIPT_ID]);

    // Idempotent — second grant must not re-register.
    await syncEngagementContentScripts(true, api);
    expect(api.registerContentScripts).toHaveBeenCalledTimes(1);
  });

  it("unregisters when host access is revoked", async () => {
    const state = { ids: [ENGAGEMENT_CONTENT_SCRIPT_ID] };
    const api = mockScripting(state);

    await expect(syncEngagementContentScripts(false, api)).resolves.toEqual({
      registered: false,
    });
    expect(api.unregisterContentScripts).toHaveBeenCalledWith({
      ids: [ENGAGEMENT_CONTENT_SCRIPT_ID],
    });
    expect(state.ids).toEqual([]);
  });

  it("returns an error when scripting registration is unavailable", async () => {
    await expect(syncEngagementContentScripts(true, undefined)).resolves.toMatchObject({
      registered: false,
      error: expect.stringMatching(/unavailable/i),
    });
  });
});
