/**
 * Sensitive-page detection for Smart proactive auto-block (DOM-37) and
 * Manual override gating (DOM-39).
 *
 * URL + DOM heuristics only — never extracts form values.
 */

export type SensitiveCategory =
  | "banking"
  | "payment"
  | "email"
  | "login"
  | "medical"
  | "sensitive_input"
  | "restricted_origin"
  | "private_workspace";

export type SensitiveAssessment = {
  /** When true, Smart must not invite / engage proactively; Manual needs override. */
  blocked: boolean;
  category: SensitiveCategory | null;
  reason: string;
};

const ALLOWED: SensitiveAssessment = {
  blocked: false,
  category: null,
  reason: "not_sensitive",
};

const DISALLOWED_PROTOCOLS = new Set([
  "chrome:",
  "chrome-extension:",
  "chrome-search:",
  "chrome-untrusted:",
  "devtools:",
  "edge:",
  "brave:",
  "about:",
  "view-source:",
  "data:",
  "blob:",
  "file:",
  "javascript:",
]);

/** Path segments that strongly indicate auth / account security surfaces. */
const LOGIN_SEGMENTS = new Set([
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "auth",
  "oauth",
  "sso",
  "password",
  "passwd",
  "reset-password",
  "forgot-password",
  "change-password",
  "account-security",
  "security-settings",
  "two-factor",
  "2fa",
  "mfa",
]);

const PAYMENT_SEGMENTS = new Set([
  "checkout",
  "payment",
  "payments",
  "billing",
  "pay",
  "cart",
  "order-payment",
  "wallet",
]);

const MEDICAL_SEGMENTS = new Set([
  "patient",
  "patients",
  "myhealth",
  "my-chart",
  "mychart",
  "ehr",
  "portal",
]);

const EMAIL_HOST_PREFIXES = [
  "mail.",
  "webmail.",
  "outlook.",
  "imap.",
  "smtp.",
];

const EMAIL_HOST_SUFFIXES = [
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  "mail.yahoo.com",
];

const BANKING_HOST_HINTS = [
  "bank",
  "banking",
  "chase",
  "wellsfargo",
  "bankofamerica",
  "capitalone",
  "americanexpress",
  "amex",
  "citi.com",
  "schwab",
  "fidelity",
  "vanguard",
];

const PRIVATE_WORKSPACE_HOSTS = [
  "docs.google.com",
  "drive.google.com",
  "sheets.google.com",
  "slides.google.com",
  "notion.so",
  "www.notion.so",
  "dropbox.com",
  "www.dropbox.com",
  "onedrive.live.com",
];

const CATEGORY_LABELS: Record<SensitiveCategory, string> = {
  banking: "Banking",
  payment: "Payment",
  email: "Email",
  login: "Sign-in",
  medical: "Medical",
  sensitive_input: "Sensitive form",
  restricted_origin: "Restricted page",
  private_workspace: "Private document",
};

function blocked(
  category: SensitiveCategory,
  reason: string,
): SensitiveAssessment {
  return { blocked: true, category, reason };
}

function pathSegments(pathname: string): string[] {
  return pathname
    .toLowerCase()
    .split("/")
    .map((segment) => segment.replace(/\.[a-z0-9]+$/i, ""))
    .filter((segment) => segment.length > 0);
}

function hostLooksLikeBanking(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return BANKING_HOST_HINTS.some(
    (hint) => host === hint || host.endsWith(`.${hint}`) || host.includes(hint),
  );
}

function hostLooksLikeEmail(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (EMAIL_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return true;
  }
  return EMAIL_HOST_PREFIXES.some((prefix) => host.startsWith(prefix));
}

/**
 * URL-only gate (safe in SW / eligibility). Conservative path segments and
 * known host patterns — not free-text “bank” anywhere in the path.
 */
export function assessUrlSensitivity(url: string): SensitiveAssessment {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return blocked("restricted_origin", "invalid_url");
  }

  if (DISALLOWED_PROTOCOLS.has(parsed.protocol)) {
    return blocked("restricted_origin", `protocol:${parsed.protocol}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return blocked("restricted_origin", `protocol:${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  if (hostLooksLikeEmail(host)) {
    return blocked("email", "email_host");
  }
  if (PRIVATE_WORKSPACE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return blocked("private_workspace", "private_workspace_host");
  }
  if (hostLooksLikeBanking(host)) {
    return blocked("banking", "banking_host");
  }

  const segments = pathSegments(parsed.pathname);
  if (segments.some((segment) => LOGIN_SEGMENTS.has(segment))) {
    return blocked("login", "login_path");
  }
  if (segments.some((segment) => PAYMENT_SEGMENTS.has(segment))) {
    return blocked("payment", "payment_path");
  }
  // Path cues (incl. local fixtures like /sensitive-banking.html) — not bare "bank"
  // in free text; require a path segment that clearly names the surface.
  if (pathLooksLikeBanking(segments)) {
    return blocked("banking", "banking_path");
  }
  if (pathLooksLikeWebmail(segments)) {
    return blocked("email", "email_path");
  }
  if (pathLooksLikePrivateDoc(segments)) {
    return blocked("private_workspace", "private_doc_path");
  }
  // Medical: require a portal-ish segment pair or patient path — avoid
  // blocking news “portal” alone when it’s the only match under /news/.
  if (
    pathLooksLikeMedical(segments) ||
    (segments.some((segment) => MEDICAL_SEGMENTS.has(segment)) &&
      (segments.includes("patient") ||
        segments.includes("patients") ||
        segments.includes("mychart") ||
        segments.includes("my-chart") ||
        segments.includes("myhealth") ||
        segments.includes("ehr") ||
        (segments.includes("portal") &&
          segments.some(
            (s) => s === "health" || s === "medical" || s === "clinic",
          ))))
  ) {
    return blocked("medical", "medical_path");
  }

  return ALLOWED;
}

function pathLooksLikeBanking(segments: string[]): boolean {
  return segments.some(
    (s) =>
      s === "banking" ||
      s.includes("banking") ||
      s === "bank-account" ||
      s === "bank-accounts",
  );
}

function pathLooksLikeWebmail(segments: string[]): boolean {
  return segments.some(
    (s) => s.includes("webmail") || s === "mailbox" || s.endsWith("-mail"),
  );
}

function pathLooksLikePrivateDoc(segments: string[]): boolean {
  return segments.some(
    (s) =>
      s.includes("private-doc") ||
      s.includes("private_doc") ||
      s === "private-document",
  );
}

function pathLooksLikeMedical(segments: string[]): boolean {
  return segments.some(
    (s) =>
      s.includes("medical") ||
      s.includes("mychart") ||
      s.includes("my-chart") ||
      s.includes("patient-portal"),
  );
}

/**
 * In-page DOM signals. Never reads input values — presence of sensitive
 * controls is enough to block.
 */
export function assessDocumentSensitivity(
  doc: Document,
): SensitiveAssessment {
  if (doc.querySelector('input[type="password"]')) {
    return blocked("sensitive_input", "password_input");
  }
  if (
    doc.querySelector(
      'input[autocomplete="cc-number"], input[autocomplete="cc-csc"], input[autocomplete="cc-exp"], input[autocomplete="cc-exp-month"], input[autocomplete="cc-exp-year"]',
    )
  ) {
    return blocked("sensitive_input", "card_autocomplete");
  }

  const named = doc.querySelectorAll("input[name], input[id]");
  for (const node of named) {
    if (!(node instanceof HTMLInputElement)) {
      continue;
    }
    const key = `${node.name} ${node.id}`.toLowerCase();
    if (
      /\b(card[-_]?number|ccnum|cc-num|cvv|cvc|cid)\b/.test(key) ||
      key.includes("cardnumber") ||
      key.includes("card-number")
    ) {
      return blocked("sensitive_input", "card_field_name");
    }
  }
  return ALLOWED;
}

/**
 * Combined assessment. URL first (cheap), then DOM when provided.
 * Benign articles that merely mention “bank” stay allowed.
 */
export function assessSensitivePage(
  url: string,
  doc?: Document | null,
): SensitiveAssessment {
  const fromUrl = assessUrlSensitivity(url);
  if (fromUrl.blocked) {
    return fromUrl;
  }
  if (doc) {
    return assessDocumentSensitivity(doc);
  }
  return ALLOWED;
}

/** Convenience for engagement / invite gates. */
export function isProactiveSensitiveBlocked(
  url: string,
  doc?: Document | null,
): boolean {
  return assessSensitivePage(url, doc).blocked;
}

/**
 * Self-contained for `chrome.scripting.executeScript` (no imports / closures).
 * Must stay in sync with `assessDocumentSensitivity`.
 */
export function assessDocumentSensitivityInPage(
  _marker?: string,
): SensitiveAssessment {
  const doc = document;
  if (doc.querySelector('input[type="password"]')) {
    return {
      blocked: true,
      category: "sensitive_input",
      reason: "password_input",
    };
  }
  if (
    doc.querySelector(
      'input[autocomplete="cc-number"], input[autocomplete="cc-csc"], input[autocomplete="cc-exp"], input[autocomplete="cc-exp-month"], input[autocomplete="cc-exp-year"]',
    )
  ) {
    return {
      blocked: true,
      category: "sensitive_input",
      reason: "card_autocomplete",
    };
  }

  const named = doc.querySelectorAll("input[name], input[id]");
  for (let i = 0; i < named.length; i++) {
    const node = named[i];
    if (!(node instanceof HTMLInputElement)) {
      continue;
    }
    const key = `${node.name} ${node.id}`.toLowerCase();
    if (
      /\b(card[-_]?number|ccnum|cc-num|cvv|cvc|cid)\b/.test(key) ||
      key.includes("cardnumber") ||
      key.includes("card-number")
    ) {
      return {
        blocked: true,
        category: "sensitive_input",
        reason: "card_field_name",
      };
    }
  }
  return { blocked: false, category: null, reason: "not_sensitive" };
}

/** Sober UI label for a blocked category. */
export function sensitiveCategoryLabel(category: SensitiveCategory): string {
  return CATEGORY_LABELS[category];
}

/**
 * Copy for the Manual override overlay — what will be read, never jokes.
 */
export function sensitiveOverrideCopy(category: SensitiveCategory): {
  title: string;
  lead: string;
  whatWillBeRead: string;
} {
  return {
    title: `This looks like a ${CATEGORY_LABELS[category].toLowerCase()} page`,
    lead: "PromptAhead will not analyze it until you confirm. Password and payment field values are never read.",
    whatWillBeRead:
      "If you continue, PromptAhead reads this page’s title, URL, and visible text to build a prompt — not form field values.",
  };
}
