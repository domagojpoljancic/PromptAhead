import { describe, expect, it, vi } from "vitest";

import {
  SMART_HOST_ORIGINS,
  SMART_PERMISSION_EDUCATION,
  hasSmartHostPermission,
  requestSmartHostPermission,
  revokeSmartHostPermission,
  settingsAfterSmartGrant,
  settingsAfterSmartRevoke,
  type PermissionsApi,
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
