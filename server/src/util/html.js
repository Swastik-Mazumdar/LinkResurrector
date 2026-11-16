/**
 * Safe HTML metadata extraction (Phase 5).
 *
 * The engine never executes retrieved JavaScript and never interprets HTML
 * structurally. Everything is extracted with strict regexes over the raw
 * text and aggressively sanitized (tags stripped, entities decoded,
 * lengths clamped) before use.
 */

const MIGRATION_PATTERNS = [
  /we (?:have|has|had) moved/i,
  /moved to (?:our |a )?new (?:domain|address|home|website|site|url)/i,
  /new (?:official )?(?:website|domain|address|url|home)/i,
  /find us at/i,
  /(?:is |are now |can now be found )?(?:now )?(?:at|available at) (?:our |the )?new/i,
  /(?:previous|old) (?:domain|site|address|website) (?:is |has )?(?:no longer active|retired)/i,
  /has (?:permanently )?moved/i,
  /is now (?:at|located at)/i,
  /please update your (?:bookmarks|links|records)/i,
  /redirecting (?:you )?to/i,
  /you (?:will be|are being) redirected/i,
  /visit(?:ing)? us (?:at|on) our new/i,
];

const INFRA_HOSTS = new Set([
  // Ad/analytics/social infra — extracted links to these are never candidates.
  'doubleclick.net', 'googlesyndication.com', 'google-analytics.com',
  'googletagmanager.com', 'facebook.com', 'twitter.com', 'x.com',
  'instagram.com', 'youtube.com', 'linkedin.com', 'tiktok.com',
  'pinterest.com', 'reddit.com', 'whatsapp.com', 't.me',
]);

const ENTITY_MAP = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function decodeEntities(text) {
  return String(text ?? '').replace(
    /&(?:amp|lt|gt|quot|#39|apos|nbsp);/g,
    (entity) => ENTITY_MAP[entity] ?? entity
  );
}

/** Strips tags, decodes entities, removes remaining angle brackets, clamps length. */
export function sanitizeText(raw, max = 300) {
  return decodeEntities(String(raw ?? ''))
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function metaContent(html, attributePattern) {
  const pattern = new RegExp(
    `<meta\\s+[^>]*?${attributePattern}[^>]*?>`,
    'i'
  );
  const tag = html.match(pattern)?.[0] ?? '';
  const content = tag.match(/content\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  return content ? sanitizeText(content[2] ?? content[3] ?? content[4] ?? '', 500) : '';
}

/**
 * Extracts identity, redirect hints and candidate successor URLs from a
 * (historical or live) HTML document.
 *
 * @param {string} html raw HTML text
 * @param {string} baseUrl absolute URL of the document
 * @returns {object} see extractIdentity
 */
export function extractIdentity(html, baseUrl) {
  const safeHtml = String(html ?? '').slice(0, 512 * 1024); // defensive cap

  const title = sanitizeText(
    safeHtml.match(/<title[^>]*>([\s\S]{0,500}?)<\/title>/i)?.[1] ?? '',
    200
  );
  const description = metaContent(safeHtml, 'name\\s*=\\s*["\']?description');
  const canonical = extractLinkHref(safeHtml, 'canonical', baseUrl);
  const ogUrl = metaContent(safeHtml, 'property\\s*=\\s*["\']?og:url');
  const metaRefresh = extractMetaRefresh(safeHtml, baseUrl);

  // Absolute http(s) URLs in the document, host-classified.
  const externalLinks = [];
  const seenHosts = new Set();
  const urlPattern = /https?:\/\/[a-z0-9-._~%]+[a-z0-9-._~%/:?#[\]@!$&'()*+,;=]*/gi;
  const baseHost = safeHost(baseUrl);
  for (const match of safeHtml.matchAll(urlPattern)) {
    let candidate;
    try {
      candidate = new URL(match[0].replace(/[.,;:)>'"]+$/, ''));
    } catch {
      continue;
    }
    if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') continue;
    if (!candidate.hostname) continue;
    if (seenHosts.has(candidate.hostname)) continue;
    seenHosts.add(candidate.hostname);
    if (candidate.hostname === baseHost) continue;
    externalLinks.push({
      url: `${candidate.protocol}//${candidate.hostname}${candidate.pathname}`,
      host: candidate.hostname,
    });
  }

  // Migration announcements: phrase match → URLs found near the phrase.
  const announcements = [];
  for (const pattern of MIGRATION_PATTERNS) {
    const match = safeHtml.match(pattern);
    if (!match) continue;
    const index = match.index ?? 0;
    const window = safeHtml.slice(Math.max(0, index - 200), index + 400);
    const urls = [];
    for (const urlMatch of window.matchAll(urlPattern)) {
      try {
        const candidate = new URL(urlMatch[0].replace(/[.,;:)>'"]+$/, ''));
        if (
          (candidate.protocol === 'http:' || candidate.protocol === 'https:') &&
          candidate.hostname &&
          candidate.hostname !== baseHost
        ) {
          urls.push(`${candidate.protocol}//${candidate.hostname}${candidate.pathname}`);
        }
      } catch {
        continue;
      }
    }
    announcements.push({ text: sanitizeText(window, 400), urls, phrase: match[0] });
  }

  const visibleText = sanitizeText(
    safeHtml
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
    4000
  );

  return { title, description, canonical, ogUrl, metaRefresh, externalLinks, announcements, visibleText };
}

function extractLinkHref(html, rel, baseUrl) {
  const pattern = new RegExp(
    `<link\\s+[^>]*?rel\\s*=\\s*["']?${rel}["']?[^>]*?>`,
    'i'
  );
  const tag = html.match(pattern)?.[0] ?? '';
  const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!href) return '';
  try {
    return new URL(href[2] ?? href[3] ?? href[4] ?? '', baseUrl).href;
  } catch {
    return '';
  }
}

function extractMetaRefresh(html, baseUrl) {
  const tag = html.match(/<meta\s+http-equiv\s*=\s*["']?refresh["']?[^>]*>/i)?.[0];
  if (!tag) return '';
  const content = tag.match(/content\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const value = content ? (content[2] ?? content[3] ?? content[4] ?? '') : '';
  const urlMatch = value.match(/url\s*=\s*(\S+)/i);
  if (!urlMatch) return '';
  try {
    return new URL(urlMatch[1].replace(/['";]+$/, ''), baseUrl).href;
  } catch {
    return '';
  }
}

function safeHost(urlLike) {
  try {
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Hosts that must never become successor candidates (ad/analytics infra). */
export function isInfraHost(host) {
  return INFRA_HOSTS.has(host) || [...INFRA_HOSTS].some((blocked) => host.endsWith(`.${blocked}`));
}
