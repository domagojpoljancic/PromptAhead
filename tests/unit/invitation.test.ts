import { describe, expect, it } from "vitest";

import {
  DEFAULT_DAILY_INVITE_CAP,
  EMPTY_INVITE_QUOTA,
  acceptInvitation,
  canInviteAgainOnPage,
  clearInviteBadgePayload,
  createInvitationSession,
  disableDomainInvitation,
  dismissInvitation,
  domainFromUrl,
  evaluateInviteSuppression,
  inviteBadgeFor,
  inviteCopyFor,
  mayStartAnalysis,
  onThresholdReached,
  recordInviteShown,
  shouldShowInviteBadge,
  snoozeInvitation,
  type InvitePolicy,
  type InviteQuota,
} from "../../extension/src/domain/invitation";

function policy(overrides: Partial<InvitePolicy> = {}): InvitePolicy {
  const dayKey = overrides.dayKey ?? "2026-08-07";
  return {
    dayKey,
    proactivePaused: false,
    excludedDomains: [],
    snoozeUntilDayKey: null,
    quota: EMPTY_INVITE_QUOTA(dayKey),
    ...overrides,
  };
}

describe("inviteCopyFor", () => {
  it("returns deterministic copy per page type (handoff §32)", () => {
    expect(inviteCopyFor("article")).toBe("Want to take this story further?");
    expect(inviteCopyFor("product")).toBe(
      "Still considering it? PromptAhead can help investigate.",
    );
    expect(inviteCopyFor("generic")).toBe(
      "There may be a useful next question here.",
    );
  });
});

describe("inviteBadgeFor", () => {
  it("uses compact badge text and full copy as title", () => {
    const badge = inviteBadgeFor("article");
    expect(badge.text).toBe("!");
    expect(badge.title).toBe(inviteCopyFor("article"));
    expect(clearInviteBadgePayload().text).toBe("");
  });
});

describe("caps helpers", () => {
  it("parses domains and records daily quota", () => {
    expect(domainFromUrl("https://News.Example.com/a")).toBe("news.example.com");
    let quota: InviteQuota = EMPTY_INVITE_QUOTA("2026-08-07");
    quota = recordInviteShown(quota, "news.example.com", "2026-08-07");
    expect(quota.invitesToday).toBe(1);
    expect(quota.domainsInvitedToday).toEqual(["news.example.com"]);
  });

  it("resets when the calendar day changes", () => {
    const stale = recordInviteShown(
      EMPTY_INVITE_QUOTA("2026-08-06"),
      "a.example",
      "2026-08-06",
    );
    const next = recordInviteShown(stale, "b.example", "2026-08-07");
    expect(next.dayKey).toBe("2026-08-07");
    expect(next.invitesToday).toBe(1);
    expect(next.domainsInvitedToday).toEqual(["b.example"]);
  });
});

describe("invitation state machine", () => {
  it("shows badge on threshold without allowing analysis yet", () => {
    const session = createInvitationSession({
      pageUrl: "https://news.example.com/story",
      pageType: "article",
    });
    expect(session.phase).toBe("eligible");
    expect(mayStartAnalysis(session)).toBe(false);

    const shown = onThresholdReached(session, policy());
    expect(shown.session.phase).toBe("invitation_shown");
    expect(shown.showBadge).toBe(true);
    expect(shown.openPanelAndAnalyze).toBe(false);
    expect(shouldShowInviteBadge(shown.session)).toBe(true);
    expect(mayStartAnalysis(shown.session)).toBe(false);
    expect(shown.quota.invitesToday).toBe(1);
  });

  it("accept opens panel path and only then mayStartAnalysis", () => {
    const session = createInvitationSession({
      pageUrl: "https://shop.example.com/p/1",
      pageType: "product",
    });
    const shown = onThresholdReached(session, policy());
    const accepted = acceptInvitation(shown.session, {
      ...policy(),
      quota: shown.quota,
    });

    expect(accepted.session.phase).toBe("accepted");
    expect(accepted.openPanelAndAnalyze).toBe(true);
    expect(accepted.clearBadge).toBe(true);
    expect(mayStartAnalysis(accepted.session)).toBe(true);
    expect(shouldShowInviteBadge(accepted.session)).toBe(false);
  });

  it("dismiss suppresses further invites on that page session", () => {
    const session = createInvitationSession({
      pageUrl: "https://news.example.com/story",
      pageType: "article",
    });
    const shown = onThresholdReached(session, policy());
    const dismissed = dismissInvitation(shown.session, {
      ...policy(),
      quota: shown.quota,
    });

    expect(dismissed.session.phase).toBe("dismissed");
    expect(canInviteAgainOnPage(dismissed.session)).toBe(false);
    expect(mayStartAnalysis(dismissed.session)).toBe(false);

    const again = onThresholdReached(dismissed.session, {
      ...policy(),
      quota: shown.quota,
    });
    expect(again.session.phase).toBe("dismissed");
    expect(again.showBadge).toBe(false);
  });

  it("snooze suppresses globally for the rest of the day", () => {
    const session = createInvitationSession({
      pageUrl: "https://news.example.com/a",
      pageType: "article",
    });
    const shown = onThresholdReached(session, policy());
    const snoozed = snoozeInvitation(shown.session, {
      ...policy(),
      quota: shown.quota,
    });

    expect(snoozed.session.phase).toBe("snoozed");
    expect(snoozed.snoozeUntilDayKey).toBe("2026-08-07");

    const other = createInvitationSession({
      pageUrl: "https://other.example.com/b",
      pageType: "article",
    });
    const blocked = onThresholdReached(other, {
      ...policy(),
      snoozeUntilDayKey: snoozed.snoozeUntilDayKey,
      quota: shown.quota,
    });
    expect(blocked.session.phase).toBe("suppressed");
    expect(blocked.session.suppression).toBe("global_snooze");
    expect(blocked.showBadge).toBe(false);
  });

  it("domain disabled excludes the site and clears the badge", () => {
    const session = createInvitationSession({
      pageUrl: "https://shop.example.com/p/2",
      pageType: "product",
    });
    const shown = onThresholdReached(session, policy());
    const disabled = disableDomainInvitation(shown.session, {
      ...policy(),
      quota: shown.quota,
    });

    expect(disabled.session.phase).toBe("domain_disabled");
    expect(disabled.excludeDomain).toBe("shop.example.com");
    expect(disabled.clearBadge).toBe(true);

    const again = onThresholdReached(
      createInvitationSession({
        pageUrl: "https://shop.example.com/p/3",
        pageType: "product",
      }),
      policy({
        excludedDomains: [disabled.excludeDomain!],
        quota: shown.quota,
      }),
    );
    expect(again.session.suppression).toBe("domain_excluded");
  });

  it("honors daily global cap and once-per-domain-per-day", () => {
    const dayKey = "2026-08-07";
    let quota = EMPTY_INVITE_QUOTA(dayKey);
    for (let i = 0; i < DEFAULT_DAILY_INVITE_CAP; i++) {
      const host = `site${i}.example.com`;
      const result = onThresholdReached(
        createInvitationSession({
          pageUrl: `https://${host}/x`,
          pageType: "article",
        }),
        policy({ dayKey, quota }),
      );
      expect(result.showBadge).toBe(true);
      quota = result.quota;
    }
    expect(quota.invitesToday).toBe(DEFAULT_DAILY_INVITE_CAP);

    const capped = onThresholdReached(
      createInvitationSession({
        pageUrl: "https://another.example.com/x",
        pageType: "article",
      }),
      policy({ dayKey, quota }),
    );
    expect(capped.session.suppression).toBe("daily_cap");

    const sameDomain = onThresholdReached(
      createInvitationSession({
        pageUrl: "https://site0.example.com/other",
        pageType: "article",
      }),
      policy({
        dayKey,
        quota: recordInviteShown(EMPTY_INVITE_QUOTA(dayKey), "site0.example.com", dayKey),
      }),
    );
    expect(sameDomain.session.suppression).toBe("domain_already_invited_today");
  });

  it("suppresses when proactive pause is on", () => {
    const session = createInvitationSession({
      pageUrl: "https://news.example.com/a",
      pageType: "article",
    });
    expect(
      evaluateInviteSuppression(session, policy({ proactivePaused: true })),
    ).toBe("proactive_paused");
    const blocked = onThresholdReached(session, policy({ proactivePaused: true }));
    expect(blocked.session.phase).toBe("suppressed");
    expect(blocked.showBadge).toBe(false);
  });

  it("ignores accept/dismiss when not invitation_shown", () => {
    const session = createInvitationSession({
      pageUrl: "https://news.example.com/a",
      pageType: "article",
    });
    const p = policy();
    expect(acceptInvitation(session, p).openPanelAndAnalyze).toBe(false);
    expect(dismissInvitation(session, p).session.phase).toBe("eligible");
  });
});
