import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyInviteBadge,
  clearInviteBadge,
} from "../../extension/src/shared/chrome";
import {
  clearInviteBadgePayload,
  inviteBadgeFor,
} from "../../extension/src/domain/invitation";
import {
  clearInviteForTab,
  handleEngagementThreshold,
  handleInviteAction,
  rememberActiveInviteTab,
  tryAcceptInviteForTab,
} from "../../extension/src/background/invite-controller";
import { handleBackgroundRequest } from "../../extension/src/background/router";
import {
  STORAGE_KEYS,
  updateSettings,
} from "../../extension/src/shared/storage";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from "./helpers/chrome-mock";

const FIXED_NOW = Date.parse("2026-08-07T12:00:00.000Z");

let mock: ChromeMock;

beforeEach(async () => {
  mock = installChromeMock({
    activeTab: { id: 42, url: "https://news.example.com/story" },
    senderTabId: 42,
  });
  rememberActiveInviteTab(null);
  await updateSettings({
    mode: "smart",
    smartModeAvailable: true,
    proactivePaused: false,
    excludedDomains: [],
  });
});

afterEach(() => {
  uninstallChromeMock();
});

describe("applyInviteBadge / clearInviteBadge", () => {
  it("sets badge text, color, and title via chrome.action", async () => {
    const payload = inviteBadgeFor("article");
    const ok = await applyInviteBadge(payload, mock.api.action);
    expect(ok).toBe(true);
    expect(mock.badgeText).toBe("!");
    expect(mock.badgeBackground).toBe(payload.backgroundColor);
    expect(mock.actionTitle).toBe(payload.title);
  });

  it("clears badge text and restores default title", async () => {
    await applyInviteBadge(inviteBadgeFor("product"), mock.api.action);
    const cleared = clearInviteBadgePayload();
    await clearInviteBadge(cleared, mock.api.action);
    expect(mock.badgeText).toBe("");
    expect(mock.actionTitle).toBe("PromptAhead");
  });
});

describe("invite controller SW wiring", () => {
  it("shows badge on threshold when Smart mode is on", async () => {
    const result = await handleEngagementThreshold(
      {
        tabId: 42,
        pageUrl: "https://news.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );

    expect(result.handled).toBe(true);
    expect(result.showBadge).toBe(true);
    expect(result.phase).toBe("invitation_shown");
    expect(mock.badgeText).toBe("!");
    expect(mock.actionTitle).toMatch(/story further/i);

    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      invitesToday: number;
      activeInvite: { tabId: number } | null;
    };
    expect(runtime.invitesToday).toBe(1);
    expect(runtime.activeInvite?.tabId).toBe(42);
  });

  it("skips invite when mode is Manual", async () => {
    await updateSettings({ mode: "manual", smartModeAvailable: false });
    const result = await handleEngagementThreshold(
      {
        tabId: 42,
        pageUrl: "https://news.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    expect(result.handled).toBe(false);
    expect(result.showBadge).toBe(false);
    expect(mock.badgeText).toBe("");
  });

  it("accept clears badge and requests panel open", async () => {
    await handleEngagementThreshold(
      {
        tabId: 42,
        pageUrl: "https://news.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );

    const accepted = await tryAcceptInviteForTab(42, mock.api.action, FIXED_NOW);
    expect(accepted.handled).toBe(true);
    expect(accepted.openPanelAndAnalyze).toBe(true);
    expect(accepted.clearBadge).toBe(true);
    expect(mock.badgeText).toBe("");
    expect(accepted.phase).toBe("accepted");
  });

  it("dismiss and snooze clear badge and update state", async () => {
    await handleEngagementThreshold(
      {
        tabId: 42,
        pageUrl: "https://news.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );

    const dismissed = await handleInviteAction(
      "dismiss",
      42,
      mock.api.action,
      FIXED_NOW,
    );
    expect(dismissed.handled).toBe(true);
    expect(dismissed.clearBadge).toBe(true);
    expect(mock.badgeText).toBe("");

    // Re-show for snooze path
    await handleEngagementThreshold(
      {
        tabId: 42,
        pageUrl: "https://other.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    const snoozed = await handleInviteAction(
      "snooze",
      42,
      mock.api.action,
      FIXED_NOW,
    );
    expect(snoozed.handled).toBe(true);
    expect(snoozed.phase).toBe("snoozed");
    expect(mock.badgeText).toBe("");

    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      snoozeUntilDayKey: string | null;
    };
    expect(runtime.snoozeUntilDayKey).toBe("2026-08-07");
  });

  it("clearInviteForTab drops badge when that tab owned the invite", async () => {
    await handleEngagementThreshold(
      {
        tabId: 42,
        pageUrl: "https://news.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    await clearInviteForTab(42, mock.api.action);
    expect(mock.badgeText).toBe("");
    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      activeInvite: null;
    };
    expect(runtime.activeInvite).toBeNull();
  });
});

describe("router invite messages", () => {
  it("routes ENGAGEMENT_THRESHOLD with sender tab id", async () => {
    const response = await handleBackgroundRequest(
      {
        type: "ENGAGEMENT_THRESHOLD",
        pageType: "article",
        url: "https://news.example.com/story",
        reason: "article-threshold-met",
      },
      { senderTabId: 42 },
    );
    expect(response.ok).toBe(true);
    if (response.ok && response.type === "ENGAGEMENT_THRESHOLD") {
      expect(response.showBadge).toBe(true);
      expect(response.phase).toBe("invitation_shown");
    }
    expect(mock.badgeText).toBe("!");
  });

  it("routes INVITE_ACTION dismiss", async () => {
    await handleBackgroundRequest(
      {
        type: "ENGAGEMENT_THRESHOLD",
        pageType: "article",
        url: "https://news.example.com/story",
        reason: "article-threshold-met",
      },
      { senderTabId: 42 },
    );
    const response = await handleBackgroundRequest({
      type: "INVITE_ACTION",
      action: "dismiss",
      tabId: 42,
    });
    expect(response.ok).toBe(true);
    if (response.ok && response.type === "INVITE_ACTION") {
      expect(response.handled).toBe(true);
      expect(response.clearBadge).toBe(true);
      expect(response.phase).toBe("dismissed");
    }
    expect(mock.badgeText).toBe("");
  });
});
