/** Formatting helpers — pure functions, no storage or chrome access. */

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now" | "32m ago" | "5h ago" | "3d ago" */
export function timeAgo(ts) {
  if (!ts) return 'never';
  const diff = Math.max(0, Date.now() - ts);
  if (diff < MIN) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  return `${Math.floor(diff / DAY)}d ago`;
}

/** "https://developer.chrome.com/docs/x" -> "developer.chrome.com/docs/x" */
export function shortenUrl(url, max = 46) {
  let flat = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (flat.length > max) flat = `${flat.slice(0, max - 1)}…`;
  return flat;
}

export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function countByStatus(links) {
  return links.reduce(
    (acc, link) => {
      acc[link.status] = (acc[link.status] ?? 0) + 1;
      return acc;
    },
    { active: 0, checking: 0, resurrected: 0, dead: 0 }
  );
}

/**
 * Validates URLs used in href attributes to prevent protocol-based XSS (javascript:, data:, vbscript:).
 * Only http: and https: URLs are permitted; any other scheme is safely neutralized to '#'.
 */
export function safeHref(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return '#';
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    // Malformed URL
  }
  return '#';
}
