/**
 * Compact URL for narrow panel chrome — hostname + shortened path.
 * Full URL belongs in `title` / aria for discovery.
 */
export function formatDisplayUrl(raw: string, maxLen = 52): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./i, "");
    const pathAndQuery = `${url.pathname}${url.search}${url.hash}`;
    const path =
      pathAndQuery === "/" || pathAndQuery === "" ? "" : pathAndQuery;
    const full = `${host}${path}`;

    if (full.length <= maxLen) {
      return full;
    }

    if (!path) {
      return host.length <= maxLen ? host : `${host.slice(0, maxLen - 1)}…`;
    }

    const ellipsis = "…";
    const budget = maxLen - host.length;
    if (budget < 4) {
      return host.length <= maxLen ? host : `${host.slice(0, maxLen - 1)}…`;
    }

    const keepEnd = Math.min(14, Math.max(6, Math.floor(budget / 3)));
    const keepStart = Math.max(1, budget - keepEnd - ellipsis.length);
    if (keepStart + keepEnd + ellipsis.length >= path.length) {
      return full.slice(0, maxLen - 1) + ellipsis;
    }

    return `${host}${path.slice(0, keepStart)}${ellipsis}${path.slice(-keepEnd)}`;
  } catch {
    if (trimmed.length <= maxLen) {
      return trimmed;
    }
    return `${trimmed.slice(0, maxLen - 1)}…`;
  }
}
