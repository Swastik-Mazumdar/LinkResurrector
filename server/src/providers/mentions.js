/**
 * Public web-mention discovery (Phase 7 extension).
 *
 * Asks the places where people talk about sites — forums and the open web —
 * where a moved domain went. Uses OFFICIAL, key-free JSON endpoints only
 * (no scraping, no ToS violations):
 *   - Reddit public search JSON
 *   - Hacker News (Algolia) search API
 *   - DuckDuckGo Instant Answer API
 *
 * Platform hosts themselves are NEVER candidates; only target URLs found in
 * the mention text/results are, and every candidate still has to pass the
 * same independent verification + confidence gates as any other lead.
 */

import { LrError, ERROR_CODES } from '../util/errors.js';
import { isInfraHost } from '../util/html.js';

const PLATFORM_HOSTS = new Set([
  'reddit.com', 'news.ycombinator.com', 'hn.algolia.com', 'duckduckgo.com',
  'old.reddit.com', 'np.reddit.com', 'redd.it',
]);

function hostOfUrl(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Absolute URLs mentioned inside a text blob. */
function extractUrls(text) {
  const found = [];
  for (const match of String(text ?? '').matchAll(/https?:\/\/[^\s"'<>)\]]+/gi)) {
    try {
      found.push(new URL(match[0].replace(/[.,;:!?)\]]+$/, '')));
    } catch {
      continue;
    }
  }
  return found;
}

function isPlatformHost(host) {
  return PLATFORM_HOSTS.has(host) || [...PLATFORM_HOSTS].some((blocked) => host.endsWith(`.${blocked}`));
}

/** Keeps only target-site URLs — never the platform we asked. */
function targetUrlsFromMention(mention) {
  const targets = new Map();
  const consider = (raw) => {
    const parsed = extractUrls(raw);
    for (const url of parsed) {
      const host = url.hostname.toLowerCase();
      if (!host) continue;
      if (url.hash) continue; // namespace identifiers, not pages
      if (isPlatformHost(host) || isInfraHost(host)) continue;
      if (host.endsWith('.archive.org') || host === 'web.archive.org') continue;
      const clean = `${url.protocol}//${url.hostname}${url.pathname}`;
      if (!targets.has(clean)) targets.set(clean, { url: clean, host });
    }
  };
  if (mention.url) consider(mention.url);
  consider(mention.text);
  return [...targets.values()];
}

export function createMentionsProvider({ fetcher, config }) {
  const sources = [
    {
      name: 'reddit',
      async search(query) {
        const url = `${config.mentions.reddit}?q=${encodeURIComponent(query)}&limit=10&sort=relevance`;
        const response = await fetcher(url, {
          timeoutMs: config.fetchTimeoutMs,
          maxBytes: config.maxResponseBytes,
          headers: { accept: 'application/json' },
        });
        if (response.status === 429 || response.status === 403) {
          throw new LrError(ERROR_CODES.RATE_LIMITED, 'Reddit refused the mention query.');
        }
        if (response.status !== 200) {
          throw new LrError(ERROR_CODES.INTERNAL_SERVER_ERROR, `Reddit mention lookup failed (HTTP ${response.status}).`);
        }
        const data = JSON.parse(String(response.body ?? '{}'));
        return (data?.children ?? [])
          .map((child) => child?.data)
          .filter(Boolean)
          .map((post) => ({
            title: String(post.title ?? ''),
            text: `${post.title ?? ''} ${post.selftext ?? ''} ${post.url_overridden_by_dest ?? ''}`.slice(0, 1200),
            url: '',
            provider: 'reddit',
          }));
      },
    },
    {
      name: 'hacker-news',
      async search(query) {
        const url = `${config.mentions.hackerNews}?query=${encodeURIComponent(query)}&hitsPerPage=10`;
        const response = await fetcher(url, {
          timeoutMs: config.fetchTimeoutMs,
          maxBytes: config.maxResponseBytes,
        });
        if (response.status !== 200) {
          throw new LrError(ERROR_CODES.INTERNAL_SERVER_ERROR, `Hacker News mention lookup failed (HTTP ${response.status}).`);
        }
        const data = JSON.parse(String(response.body ?? '{}'));
        return (data?.hits ?? [])
          .filter(Boolean)
          .map((hit) => ({
            title: String(hit.title ?? hit.story_title ?? ''),
            text: `${hit.title ?? ''} ${hit.story_text ?? ''} ${hit.comment_text ?? ''} ${hit.url ?? ''}`.slice(0, 1200),
            url: hit.url ?? '',
            provider: 'hacker-news',
          }));
      },
    },
    {
      name: 'duckduckgo',
      async search(query) {
        const url = `${config.mentions.duckDuckGo}?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`;
        const response = await fetcher(url, {
          timeoutMs: config.fetchTimeoutMs,
          maxBytes: config.maxResponseBytes,
        });
        if (response.status === 429 || response.status === 403) {
          throw new LrError(ERROR_CODES.RATE_LIMITED, 'DuckDuckGo refused the mention query.');
        }
        if (response.status !== 200) {
          throw new LrError(ERROR_CODES.INTERNAL_SERVER_ERROR, `DuckDuckGo mention lookup failed (HTTP ${response.status}).`);
        }
        const data = JSON.parse(String(response.body ?? '{}'));
        return (data?.RelatedTopics ?? [])
          .filter(Boolean)
          .map((topic) => ({
            title: String(topic.Text ?? '').slice(0, 200),
            text: `${topic.FirstURL ?? ''} ${topic.Text ?? ''}`.slice(0, 1200),
            url: topic.FirstURL ?? '',
            provider: 'duckduckgo',
          }));
      },
    },
  ];

  return {
    sources: sources.map((source) => source.name),

    /**
     * Queries every source; a failing source degrades to a warning, never
     * blocks the others. @returns {Promise<{ results: Array, providers: Array }>}
     */
    async search(query) {
      const results = [];
      const usedProviders = [];
      const seen = new Set();
      await Promise.allSettled(sources.map(async (source) => {
        let mentions;
        try {
          mentions = await source.search(query);
        } catch (error) {
          if (error?.code !== ERROR_CODES.RATE_LIMITED) throw error;
          throw error;
        }
        for (const mention of mentions) {
          for (const target of targetUrlsFromMention(mention)) {
            const key = target.host;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({
              url: target.url,
              title: mention.title,
              snippet: mention.text,
              provider: mention.provider,
              source: 'web_mention',
            });
          }
        }
        usedProviders.push(source.name);
      }));
      return { results, providers: usedProviders };
    },

    /**
     * Queries built from the original site's identity: exact title plus a
     * "where does X live now" phrasing that forum posts use.
     */
    buildQueries(identity) {
      const queries = [];
      const title = (identity?.title ?? '').replace(/\s*[|–—-]\s*[^|–—-]{2,}$/, '').trim();
      if (title && title.length >= 8) {
        queries.push(`"${title}" new website`);
        queries.push(`"${title}" moved to`);
      }
      return queries.slice(0, 2);
    },
  };
}
