import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchProvider } from '../src/providers/search.js';

const config = {
  fetchTimeoutMs: 1000,
  maxResponseBytes: 8192,
  providers: {
    bing: { name: 'bing', apiKey: '', endpoint: 'https://api.bing.microsoft.com/v7.0/search' },
    googleCse: { name: 'google-cse', apiKey: '', cseId: '', endpoint: 'https://www.googleapis.com/customsearch/v1' },
  },
};

test('no search credentials reports reduced coverage without fabricating results', async () => {
  const provider = createSearchProvider({ fetcher: async () => { throw new Error('must not be called'); }, config });
  assert.equal(provider.coverage, 'reduced');
  assert.deepEqual(await provider.search('site query'), { configured: false, results: [] });
});

test('an unavailable configured search provider fails honestly for the caller to report', async () => {
  const configured = {
    ...config,
    providers: {
      ...config.providers,
      bing: { ...config.providers.bing, apiKey: 'test-key' },
    },
  };
  const provider = createSearchProvider({ fetcher: async () => { throw new Error('provider offline'); }, config: configured });
  assert.equal(provider.coverage, 'full');
  await assert.rejects(provider.search('official site query'), /provider offline/);
});

test('provider result payloads are normalized into URL/title/snippet evidence', async () => {
  const configured = {
    ...config,
    providers: {
      ...config.providers,
      googleCse: { ...config.providers.googleCse, apiKey: 'test-key', cseId: 'test-cse' },
    },
  };
  const provider = createSearchProvider({
    fetcher: async (url, options) => {
      assert.match(String(url), /customsearch/);
      assert.equal(options.headers['accept-language'], 'en');
      return { status: 200, body: JSON.stringify({ items: [{ link: 'https://successor.example/', title: 'Example', snippet: 'Official site' }] }) };
    },
    config: configured,
  });
  const result = await provider.search('Example official site');
  assert.equal(result.provider, 'google-cse');
  assert.deepEqual(result.results[0], {
    url: 'https://successor.example/', title: 'Example', snippet: 'Official site', source: 'search_result', provider: 'google-cse',
  });
});
