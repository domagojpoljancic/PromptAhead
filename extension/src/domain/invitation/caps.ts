/**
 * Proactive invite caps (handoff §9 / §32 / DOM-35).
 * - ≤1 invite per page (normalized URL) per day
 * - ≤1 invite per domain per day
 * - ≤3 invites per calendar day globally
 * - Domain exclude, snooze-for-today, global proactive pause
 */

export const DEFAULT_DAILY_INVITE_CAP = 3 as const;

export type InviteQuota = {
  /** Calendar day the counters belong to (`YYYY-MM-DD`). */
  dayKey: string;
  invitesToday: number;
  domainsInvitedToday: readonly string[];
  /** Normalized page keys invited today (once-per-page). */
  pagesInvitedToday: readonly string[];
};

export const EMPTY_INVITE_QUOTA = (dayKey: string): InviteQuota => ({
  dayKey,
  invitesToday: 0,
  domainsInvitedToday: [],
  pagesInvitedToday: [],
});

/** UTC calendar day — callers may pass a local key instead for product TZ. */
export function calendarDayKeyUtc(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function normalizeDomain(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, "");
}

export function domainFromUrl(url: string): string | null {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Stable page identity for once-per-page caps: origin + path + search,
 * lowercase host, no hash, no trailing slash (except root).
 */
export function pageKeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = normalizeDomain(parsed.hostname);
    if (!host) {
      return null;
    }
    let path = parsed.pathname || "/";
    if (path.length > 1 && path.endsWith("/")) {
      path = path.slice(0, -1);
    }
    return `${parsed.protocol}//${host}${path}${parsed.search}`;
  } catch {
    return null;
  }
}

export function isDomainExcluded(
  domain: string,
  excludedDomains: readonly string[],
): boolean {
  const needle = normalizeDomain(domain);
  return excludedDomains.some((entry) => normalizeDomain(entry) === needle);
}

/** Immutable append — used when persisting "Don't suggest on this site". */
export function withExcludedDomain(
  excludedDomains: readonly string[],
  domain: string,
): string[] {
  const normalized = normalizeDomain(domain);
  if (!normalized || isDomainExcluded(normalized, excludedDomains)) {
    return [...excludedDomains].map(normalizeDomain);
  }
  return [...excludedDomains.map(normalizeDomain), normalized];
}

export function isGlobalSnoozeActive(
  dayKey: string,
  snoozeUntilDayKey: string | null | undefined,
): boolean {
  if (!snoozeUntilDayKey) {
    return false;
  }
  // Snooze covers the day it was set (and any earlier key left stale).
  return dayKey <= snoozeUntilDayKey;
}

/** Next-calendar-day key after `dayKey` — snooze clears once day advances. */
export function dayAfter(dayKey: string): string {
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`);
  if (Number.isNaN(ms)) {
    return dayKey;
  }
  return calendarDayKeyUtc(ms + 24 * 60 * 60 * 1000);
}

export function isDailyCapReached(
  quota: InviteQuota,
  dayKey: string,
  cap: number = DEFAULT_DAILY_INVITE_CAP,
): boolean {
  if (quota.dayKey !== dayKey) {
    return false;
  }
  return quota.invitesToday >= cap;
}

export function wasDomainInvitedToday(
  quota: InviteQuota,
  domain: string,
  dayKey: string,
): boolean {
  if (quota.dayKey !== dayKey) {
    return false;
  }
  const needle = normalizeDomain(domain);
  return quota.domainsInvitedToday.some((d) => normalizeDomain(d) === needle);
}

export function wasPageInvitedToday(
  quota: InviteQuota,
  pageUrl: string,
  dayKey: string,
): boolean {
  if (quota.dayKey !== dayKey) {
    return false;
  }
  const needle = pageKeyFromUrl(pageUrl);
  if (!needle) {
    return false;
  }
  return quota.pagesInvitedToday.some((p) => p === needle);
}

/** Record a successful invitation show against the day's quota. */
export function recordInviteShown(
  quota: InviteQuota,
  domain: string,
  dayKey: string,
  pageUrl?: string,
): InviteQuota {
  const normalizedDomain = normalizeDomain(domain);
  const pageKey = pageUrl ? pageKeyFromUrl(pageUrl) : null;

  if (quota.dayKey !== dayKey) {
    return {
      dayKey,
      invitesToday: 1,
      domainsInvitedToday: [normalizedDomain],
      pagesInvitedToday: pageKey ? [pageKey] : [],
    };
  }

  const domains = quota.domainsInvitedToday.includes(normalizedDomain)
    ? [...quota.domainsInvitedToday]
    : [...quota.domainsInvitedToday, normalizedDomain];
  const pages =
    pageKey && !quota.pagesInvitedToday.includes(pageKey)
      ? [...quota.pagesInvitedToday, pageKey]
      : [...quota.pagesInvitedToday];

  return {
    dayKey,
    invitesToday: quota.invitesToday + 1,
    domainsInvitedToday: domains,
    pagesInvitedToday: pages,
  };
}
