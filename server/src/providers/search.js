/**
 * Search-provider abstraction (Phase 7).
 *
 * Multiple providers can be configured independently via environment
 * variables (see config.js). When none are configured the engine continues
 * with Wayback + live-redirect discovery and reports REDUCED coverage —
 * it never fabricates search results.
 *
 * Implemented providers (official APIs only, no ToS-violating scraping):
 *   - Bing Web Search v7  (BING_API_KEY)
 *   - Google CSE          (GOOGLE_API_KEY + GOOGLE_CSE_ID)
 */

import { LrError, ERROR_CODES } from '../util/errors.js';

const PUBLIC_SUFFIXish = /(\.com|\.net|\.org|\.io|\.dev|\.app|\.co|\.info|\.xyz)$/;

function hostOf(urlString) {
  try {
    return new URL(urlString).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function webSearchProvider(definition, fetcher, config) {
  return {
    name: definition.name,
    isConfigured: () =>
      Boolean(definition.apiKey) &&
      (definition.name !== 'google-cse' || Boolean(definition.cseId)),
    async search(query) {
      const headers = { 'accept-language': 'en' };
      let url;
      if (definition.name === 'bing') {
        headers['Ocp-Apim-Subscription-Key'] = definition.apiKey;
        url = `${definition.endpoint}?q=${encodeURIComponent(query)}&count=10&responseFilter=Webpages`;
      } else {
        url = `${definition.endpoint}?key=${encodeURIComponent(definition.apiKey)}&cx=${encodeURIComponent(definition.cseId)}&q=${encodeURIComponent(query)}&num=10`;
      }

      const response = await fetcher(url, {
        timeoutMs: config.fetchTimeoutMs,
        maxBytes: config.maxResponseBytes,
        headers,
      });
      if (response.status === 429 || response.status === 403) {
        throw new LrError(ERROR_CODES.RATE_LIMITED, `Search provider ${definition.name} refused request.`);
      }
      if (response.status !== 200) {
        throw new LrError(ERROR_CODES.INTERNAL_SERVER_ERROR, `Search provider ${definition.name} failed (HTTP ${response.status}).`);
      }

      const data = JSON.parse(String(response.body ?? '{}'));
      const rawResults =
        definition.name === 'bing'
          ? data?.webPages?.value ?? []
          : data?.items ?? [];

      return rawResults
        .map((item) => ({
          url: item.url ?? item.link,
          title: item.name ?? item.title ?? '',
          snippet: item.snippet ?? item.snippet ?? '',
        }))
        .filter((item) => item.url && hostOf(item.url))
        .map((item) => ({
          ...item,
          source: 'search_result',
          provider: definition.name,
        }));
    },
  };
}

export function createSearchProvider({ fetcher, config }) {
  const providers = Object.values(config.providers)
    .filter(Boolean)
    .map((definition) => webSearchProvider(definition, fetcher, config));

  const configured = providers.filter((provider) => provider.isConfigured());

  return {
    /** Coverage is honest: 'full' with keys, 'reduced' without. */
    coverage: configured.length > 0 ? 'full' : 'reduced',
    configuredProviders: configured.map((provider) => provider.name),
    availableProviders: providers.map((provider) => provider.name),

    /**
     * Runs the first available configured provider.
     * @returns {Promise<{ configured: boolean, results: Array, provider?: string }>}
     */
    async search(query) {
      for (const provider of configured) {
        try {
          const results = await provider.search(query);
          return { configured: true, results, provider: provider.name };
        } catch (error) {
          // Try the next configured provider before giving up.
          if (provider === configured.at(-1)) throw error;
        }
      }
      return { configured: false, results: [] };
    },

    /** Builds evidence queries from historical identity. */
    buildQueries(identity) {
      const queries = [];
      const title = (identity?.title ?? '').replace(/\s*[|–—-]\s*[^|–—-]{2,}$/, '').trim();
      if (title && title.length >= 8) queries.push(`"${title}" official site`);
      if (title && title.length >= 8) queries.push(`"${title}" moved new domain`);
      if (identity?.description && identity.description.length >= 20) {
        const distinctive = identity.description.split(/[.,;]/)[0].trim();
        if (distinctive.length >= 15) queries.push(`"${distinctive}"`);
      }
      return queries.slice(0, 3);
    },

    /** Does the result host look like a plausible standalone website? */
    isPromisingResultHost(result) {
      const host = hostOf(result.url);
      if (!host) return false;
      return PUBLIC_SUFFIXish.test(host) || host.split('.').length <= 3;
    },
  };
}
