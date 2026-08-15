import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { kickOffPanelAnalysis } from "../../extension/src/background/panel-analysis";
import {
  captureTabContext,
  clearPageContextCache,
} from "../../extension/src/background/page-context-store";
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
import { snapshotFromFixture } from "./helpers/fixture-dom";

const FIXED_NOW = Date.parse("2026-08-07T12:00:00.000Z");
const STORY_URL = "https://news.example.com/story";
const TAB_ID = 42;

let mock: ChromeMock;

beforeEach(async () => {
  clearPageContextCache();
  mock = installChromeMock({
    activeTab: { id: TAB_ID, url: STORY_URL },
    senderTabId: TAB_ID,
    executeScript: (details) => {
      if (details.args?.[0] === "pa-sensitive") {
        return { blocked: false, category: null, reason: "not_sensitive" };
      }
      return {
        ok: true,
        snapshot: snapshotFromFixture("article-jsonld", STORY_URL),
      };
    },
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
  clearPageContextCache();
  uninstallChromeMock();
});

async function showInviteBadge(): Promise<void> {
  await handleEngagementThreshold(
    {
      tabId: TAB_ID,
      pageUrl: STORY_URL,
      pageType: "article",
      reason: "article-threshold-met",
    },
    mock.api.action,
    FIXED_NOW,
  );
}

describe("applyInviteBadge / clearInviteBadge", () => {
  it("sets badge text, color, and title via chrome.action for a tab", async () => {
    const payload = inviteBadgeFor("article");
    const ok = await applyInviteBadge(payload, mock.api.action, TAB_ID);
    expect(ok).toBe(true);
    expect(mock.badgeTextFor(TAB_ID)).toBe("!");
    expect(mock.badgeBackground).toBe(payload.backgroundColor);
    expect(mock.actionTitle).toBe(payload.title);
    expect(mock.badgeCalls.some((c) => c.kind === "text" && c.tabId === TAB_ID)).toBe(
      true,
    );
  });

  it("clears badge text and restores default title for that tab", async () => {
    await applyInviteBadge(inviteBadgeFor("product"), mock.api.action, TAB_ID);
    const cleared = clearInviteBadgePayload();
    await clearInviteBadge(cleared, mock.api.action, TAB_ID);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.actionTitle).toBe("PromptAhead");
  });
});

describe("invite controller SW wiring", () => {
  it("shows badge on threshold without starting extract or panel", async () => {
    const result = await handleEngagementThreshold(
      {
        tabId: TAB_ID,
        pageUrl: STORY_URL,
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );

    expect(result.handled).toBe(true);
    expect(result.showBadge).toBe(true);
    expect(result.openPanelAndAnalyze).toBe(false);
    expect(result.phase).toBe("invitation_shown");
    expect(mock.badgeTextFor(TAB_ID)).toBe("!");
    expect(mock.actionTitle).toMatch(/story further/i);
    // Threshold/badge must never kick off Manual extract or side panel.
    expect(mock.injections).toEqual([]);
    expect(mock.sidePanelOpens).toEqual([]);

    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      invitesToday: number;
      activeInvite: { tabId: number } | null;
    };
    expect(runtime.invitesToday).toBe(1);
    expect(runtime.activeInvite?.tabId).toBe(TAB_ID);
  });

  it("ignores threshold on low-value URLs without showing a badge (DOM-60)", async () => {
    const result = await handleEngagementThreshold(
      {
        tabId: TAB_ID,
        pageUrl: "https://docs.google.com/document/d/abc/edit",
        pageType: "generic",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );

    expect(result.handled).toBe(false);
    expect(result.showBadge).toBe(false);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.injections).toEqual([]);
  });

  it("skips invite when mode is Manual", async () => {
    await updateSettings({ mode: "manual", smartModeAvailable: false });
    const result = await handleEngagementThreshold(
      {
        tabId: TAB_ID,
        pageUrl: STORY_URL,
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    expect(result.handled).toBe(false);
    expect(result.showBadge).toBe(false);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.injections).toEqual([]);
    expect(mock.sidePanelOpens).toEqual([]);
  });

  it("accept flags openPanelAndAnalyze; kickoff then extracts and opens panel", async () => {
    await showInviteBadge();
    expect(mock.injections).toEqual([]);
    expect(mock.sidePanelOpens).toEqual([]);

    const accepted = await tryAcceptInviteForTab(
      TAB_ID,
      mock.api.action,
      FIXED_NOW,
    );
    expect(accepted.handled).toBe(true);
    expect(accepted.openPanelAndAnalyze).toBe(true);
    expect(accepted.clearBadge).toBe(true);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(accepted.phase).toBe("accepted");
    // Controller alone does not extract — SW/router call kickOffPanelAnalysis.
    expect(mock.injections).toEqual([]);

    const { capture, panel } = kickOffPanelAnalysis(TAB_ID, STORY_URL);
    await Promise.all([capture, panel]);
    expect(mock.injections).toEqual([TAB_ID, TAB_ID]);
    expect(mock.sidePanelOpens).toEqual([TAB_ID]);
  });

  it("dismiss and snooze clear badge without analysis", async () => {
    await showInviteBadge();

    const dismissed = await handleInviteAction(
      "dismiss",
      TAB_ID,
      mock.api.action,
      FIXED_NOW,
    );
    expect(dismissed.handled).toBe(true);
    expect(dismissed.clearBadge).toBe(true);
    expect(dismissed.openPanelAndAnalyze).toBe(false);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.injections).toEqual([]);

    // Re-show for snooze path
    await handleEngagementThreshold(
      {
        tabId: TAB_ID,
        pageUrl: "https://other.example.com/story",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    const snoozed = await handleInviteAction(
      "snooze",
      TAB_ID,
      mock.api.action,
      FIXED_NOW,
    );
    expect(snoozed.handled).toBe(true);
    expect(snoozed.phase).toBe("snoozed");
    expect(snoozed.openPanelAndAnalyze).toBe(false);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.injections).toEqual([]);
    expect(mock.sidePanelOpens).toEqual([]);

    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      snoozeUntilDayKey: string | null;
    };
    expect(runtime.snoozeUntilDayKey).toBe("2026-08-07");
  });

  it("clearInviteForTab drops badge when that tab owned the invite", async () => {
    await showInviteBadge();
    await clearInviteForTab(TAB_ID, mock.api.action);
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      activeInvite: null;
    };
    expect(runtime.activeInvite).toBeNull();
    expect(mock.injections).toEqual([]);
  });

  it("persists global pause and stops proactive invites (Manual extract still allowed)", async () => {
    await updateSettings({ proactivePaused: true });
    const settings = mock.storage[STORAGE_KEYS.settings] as {
      proactivePaused: boolean;
    };
    expect(settings.proactivePaused).toBe(true);

    const blocked = await handleEngagementThreshold(
      {
        tabId: TAB_ID,
        pageUrl: STORY_URL,
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    expect(blocked.handled).toBe(true);
    expect(blocked.showBadge).toBe(false);
    expect(blocked.suppression).toBe("proactive_paused");
    expect(mock.badgeTextFor(TAB_ID)).toBe("");

    // Toolbar Manual path: capture still runs while proactive is paused.
    const result = await captureTabContext(TAB_ID);
    expect(result.ok).toBe(true);
    expect(mock.injections).toEqual([TAB_ID, TAB_ID]);
  });

  it("persists domain exclude and once-per-page page keys", async () => {
    await showInviteBadge();
    const afterShow = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      pagesInvitedToday: string[];
      domainsInvitedToday: string[];
    };
    expect(afterShow.pagesInvitedToday).toContain(
      "https://news.example.com/story",
    );
    expect(afterShow.domainsInvitedToday).toContain("news.example.com");

    await handleInviteAction("disable_domain", TAB_ID, mock.api.action, FIXED_NOW);
    const settings = mock.storage[STORAGE_KEYS.settings] as {
      excludedDomains: string[];
    };
    expect(settings.excludedDomains).toContain("news.example.com");

    const again = await handleEngagementThreshold(
      {
        tabId: TAB_ID,
        pageUrl: "https://news.example.com/other",
        pageType: "article",
        reason: "article-threshold-met",
      },
      mock.api.action,
      FIXED_NOW,
    );
    expect(again.suppression).toBe("domain_excluded");
    expect(again.showBadge).toBe(false);
  });
});

describe("router invite messages", () => {
  it("routes ENGAGEMENT_THRESHOLD without extract or panel", async () => {
    const response = await handleBackgroundRequest(
      {
        type: "ENGAGEMENT_THRESHOLD",
        pageType: "article",
        url: STORY_URL,
        reason: "article-threshold-met",
      },
      { senderTabId: TAB_ID },
    );
    expect(response.ok).toBe(true);
    if (response.ok && response.type === "ENGAGEMENT_THRESHOLD") {
      expect(response.showBadge).toBe(true);
      expect(response.phase).toBe("invitation_shown");
    }
    expect(mock.badgeTextFor(TAB_ID)).toBe("!");
    expect(mock.injections).toEqual([]);
    expect(mock.sidePanelOpens).toEqual([]);
  });

  it("routes INVITE_ACTION accept → panel + extract", async () => {
    await handleBackgroundRequest(
      {
        type: "ENGAGEMENT_THRESHOLD",
        pageType: "article",
        url: STORY_URL,
        reason: "article-threshold-met",
      },
      { senderTabId: TAB_ID },
    );
    expect(mock.injections).toEqual([]);

    const response = await handleBackgroundRequest({
      type: "INVITE_ACTION",
      action: "accept",
      tabId: TAB_ID,
    });
    expect(response.ok).toBe(true);
    if (response.ok && response.type === "INVITE_ACTION") {
      expect(response.handled).toBe(true);
      expect(response.openPanelAndAnalyze).toBe(true);
      expect(response.phase).toBe("accepted");
    }
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.sidePanelOpens).toEqual([TAB_ID]);
    // Extraction is fire-and-forget; wait for assess + snapshot injections.
    await vi.waitFor(() => {
      expect(mock.injections).toEqual([TAB_ID, TAB_ID]);
    });
  });

  it("routes INVITE_ACTION dismiss without analysis", async () => {
    await handleBackgroundRequest(
      {
        type: "ENGAGEMENT_THRESHOLD",
        pageType: "article",
        url: STORY_URL,
        reason: "article-threshold-met",
      },
      { senderTabId: TAB_ID },
    );
    const response = await handleBackgroundRequest({
      type: "INVITE_ACTION",
      action: "dismiss",
      tabId: TAB_ID,
    });
    expect(response.ok).toBe(true);
    if (response.ok && response.type === "INVITE_ACTION") {
      expect(response.handled).toBe(true);
      expect(response.clearBadge).toBe(true);
      expect(response.openPanelAndAnalyze).toBe(false);
      expect(response.phase).toBe("dismissed");
    }
    expect(mock.badgeTextFor(TAB_ID)).toBe("");
    expect(mock.injections).toEqual([]);
    expect(mock.sidePanelOpens).toEqual([]);
  });
});
