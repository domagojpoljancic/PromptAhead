/**
 * Proactive invite caps (handoff §9 / §32).
 * - ≤3 invites per calendar day globally
 * - ≤1 invite per domain per day
 */

export const DEFAULT_DAILY_INVITE_CAP = 3 as const;

export type InviteQuota = {
  /** Calendar day the counters belong to (`YYYY-MM-DD`). */
  dayKey: string;
  invitesToday: number;
  domainsInvitedToday: readonly string[];
};

export const EMPTY_INVITE_QUOTA = (dayKey: string): InviteQuota => ({
  dayKey,
  invitesToday: 0,
  domainsInvitedToday: [],
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

export function isDomainExcluded(
  domain: string,
  excludedDomains: readonly string[],
): boolean {
  const needle = normalizeDomain(domain);
  return excludedDomains.some((entry) => normalizeDomain(entry) === needle);
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

/** Record a successful invitation show against the day's quota. */
export function recordInviteShown(
  quota: InviteQuota,
  domain: string,
  dayKey: string,
): InviteQuota {
  if (quota.dayKey !== dayKey) {
    return {
      dayKey,
      invitesToday: 1,
      domainsInvitedToday: [normalizeDomain(domain)],
    };
  }
  const normalized = normalizeDomain(domain);
  const domains = quota.domainsInvitedToday.includes(normalized)
    ? [...quota.domainsInvitedToday]
    : [...quota.domainsInvitedToday, normalized];
  return {
    dayKey,
    invitesToday: quota.invitesToday + 1,
    domainsInvitedToday: domains,
  };
}
