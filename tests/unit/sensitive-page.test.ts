/**
 * DOM-37: sensitive-page proactive auto-block.
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isEngagementEligibleUrl } from "../../extension/src/domain/engagement";
import {
  assessDocumentSensitivity,
  assessSensitivePage,
  assessUrlSensitivity,
} from "../../extension/src/domain/sensitive";
import { handleEngagementThreshold } from "../../extension/src/background/invite-controller";
import { startEngagementTracker } from "../../extension/src/content/engagement-tracker";
import {
  STORAGE_KEYS,
  updateSettings,
} from "../../extension/src/shared/storage";
import {
  installChromeMock,
  uninstallChromeMock,
  type ChromeMock,
} from "./helpers/chrome-mock";

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/html",
);

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURE_ROOT, name), "utf8");
}

function mountFixture(name: string, url: string): Document {
  document.open();
  document.write(loadFixture(name));
  document.close();
  // jsdom location is awkward to rewrite; callers pass the URL explicitly.
  void url;
  return document;
}

describe("assessUrlSensitivity", () => {
  it("blocks login / checkout path segments", () => {
    expect(assessUrlSensitivity("https://shop.example.com/login").blocked).toBe(
      true,
    );
    expect(
      assessUrlSensitivity("https://shop.example.com/checkout").category,
    ).toBe("payment");
    expect(
      assessUrlSensitivity("https://app.example.com/account/password").category,
    ).toBe("login");
    expect(
      assessUrlSensitivity(
        "https://app.example.com/settings/change-password",
      ).category,
    ).toBe("login");
  });

  it("blocks banking, email, medical portal, and private workspace hosts/paths", () => {
    expect(
      assessUrlSensitivity("https://secure.chase.com/accounts/overview").category,
    ).toBe("banking");
    expect(assessUrlSensitivity("https://mail.google.com/mail/u/0/").category).toBe(
      "email",
    );
    expect(
      assessUrlSensitivity("https://health.example.com/patient/portal").category,
    ).toBe("medical");
    expect(
      assessUrlSensitivity(
        "https://docs.google.com/document/d/abc123/edit",
      ).category,
    ).toBe("private_workspace");
  });

  it("allows a news article URL that only mentions bank in the slug", () => {
    const result = assessUrlSensitivity(
      "https://news.example.com/why-banks-still-matter",
    );
    expect(result.blocked).toBe(false);
  });
});

describe("test-plan sensitive fixture matrix (proactive never fires)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const rows: Array<{
    name: string;
    fixture: string;
    url: string;
    expectCategory?: string;
  }> = [
    {
      name: "Login form",
      fixture: "sensitive-login.html",
      url: "https://shop.example.com/login",
    },
    {
      name: "Password change",
      fixture: "sensitive-password-change.html",
      url: "https://app.example.com/settings/change-password",
    },
    {
      name: "Checkout",
      fixture: "sensitive-checkout.html",
      url: "https://shop.example.com/checkout",
    },
    {
      name: "Card payment",
      fixture: "sensitive-card-payment.html",
      url: "https://shop.example.com/pay",
    },
    {
      name: "Banking dashboard",
      fixture: "sensitive-banking.html",
      url: "https://secure.chase.com/accounts/overview",
      expectCategory: "banking",
    },
    {
      name: "Webmail",
      fixture: "sensitive-webmail.html",
      url: "https://mail.google.com/mail/u/0/#inbox",
      expectCategory: "email",
    },
    {
      name: "Private doc editor",
      fixture: "sensitive-private-doc.html",
      url: "https://docs.google.com/document/d/abc123/edit",
      expectCategory: "private_workspace",
    },
    {
      name: "Medical portal",
      fixture: "sensitive-medical-portal.html",
      url: "https://clinic.example.com/patient/portal",
      expectCategory: "medical",
    },
  ];

  for (const row of rows) {
    it(`blocks ${row.name}`, () => {
      mountFixture(row.fixture, row.url);
      const assessment = assessSensitivePage(row.url, document);
      expect(assessment.blocked, row.name).toBe(true);
      if (row.expectCategory) {
        expect(assessment.category).toBe(row.expectCategory);
      }
      expect(isEngagementEligibleUrl(row.url)).toBe(false);
    });
  }

  it("allows Benign article mentioning bank / password", () => {
    const url = "https://news.example.com/why-banks-still-matter";
    mountFixture("article-mentions-bank.html", url);
    expect(assessSensitivePage(url, document).blocked).toBe(false);
    expect(isEngagementEligibleUrl(url)).toBe(true);
  });

  it("blocks local fixture paths without production hosts", () => {
    expect(
      assessUrlSensitivity("http://127.0.0.1:8765/sensitive-banking.html").category,
    ).toBe("banking");
    expect(
      assessUrlSensitivity("http://127.0.0.1:8765/sensitive-webmail.html").category,
    ).toBe("email");
    expect(
      assessUrlSensitivity(
        "http://127.0.0.1:8765/sensitive-medical-portal.html",
      ).category,
    ).toBe("medical");
    expect(
      assessUrlSensitivity(
        "http://127.0.0.1:8765/sensitive-private-doc.html",
      ).category,
    ).toBe("private_workspace");
  });
});

describe("assessDocumentSensitivity", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("blocks password and card fields without reading values", () => {
    mountFixture(
      "sensitive-login.html",
      "https://shop.example.com/login",
    );
    expect(assessDocumentSensitivity(document).category).toBe("sensitive_input");

    mountFixture(
      "sensitive-checkout.html",
      "https://shop.example.com/checkout",
    );
    expect(assessDocumentSensitivity(document).blocked).toBe(true);

    mountFixture(
      "sensitive-password-change.html",
      "https://app.example.com/settings/change-password",
    );
    expect(assessDocumentSensitivity(document).category).toBe("sensitive_input");
  });

  it("allows a benign article that mentions bank and password in prose", () => {
    mountFixture(
      "article-mentions-bank.html",
      "https://news.example.com/why-banks-still-matter",
    );
    expect(assessDocumentSensitivity(document).blocked).toBe(false);
    expect(
      assessSensitivePage(
        "https://news.example.com/why-banks-still-matter",
        document,
      ).blocked,
    ).toBe(false);
  });
});

describe("engagement + invite gates", () => {
  let mock: ChromeMock;

  afterEach(() => {
    uninstallChromeMock();
    document.body.innerHTML = "";
  });

  it("marks sensitive URLs ineligible for engagement", () => {
    expect(isEngagementEligibleUrl("https://shop.example.com/login")).toBe(
      false,
    );
    expect(isEngagementEligibleUrl("https://shop.example.com/checkout")).toBe(
      false,
    );
    expect(
      isEngagementEligibleUrl("https://news.example.com/why-banks-still-matter"),
    ).toBe(true);
  });

  it("does not start a live tracker on a login fixture", () => {
    mountFixture("sensitive-login.html", "https://shop.example.com/story");
    // URL alone looks eligible; DOM password field must stop the tracker.
    const handle = startEngagementTracker(
      {
        pageType: "generic",
        url: "https://news.example.com/why-banks-still-matter",
        onThresholdReached: () => {
          throw new Error("must not fire on sensitive DOM");
        },
        tickIntervalMs: 50,
      },
      document,
      window,
    );
    expect(handle.getState().fired).toBe(false);
    handle.stop();
  });

  it("SW invite ignores sensitive URLs even if a threshold message arrives", async () => {
    mock = installChromeMock({
      activeTab: { id: 7, url: "https://shop.example.com/login" },
    });
    await updateSettings({
      mode: "smart",
      smartModeAvailable: true,
      proactivePaused: false,
    });

    const result = await handleEngagementThreshold(
      {
        tabId: 7,
        pageUrl: "https://shop.example.com/login",
        pageType: "generic",
        reason: "article-threshold-met",
      },
      mock.api.action,
    );
    expect(result.handled).toBe(false);
    expect(result.showBadge).toBe(false);
    expect(mock.badgeText).toBe("");
    const runtime = mock.storage[STORAGE_KEYS.inviteRuntime] as {
      activeInvite: null | { tabId: number };
    };
    expect(runtime?.activeInvite ?? null).toBeNull();
  });
});
