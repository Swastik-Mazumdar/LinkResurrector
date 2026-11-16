import test from 'node:test';
import assert from 'node:assert/strict';
import { createMentionsProvider } from '../src/providers/mentions.js';

const config = {
  fetchTimeoutMs: 1000,
  maxResponseBytes: 8192,
  mentions: {
    reddit: 'https://www.reddit.com/search.json',
    hackerNews: 'https://hn.algolia.com/api/v1/search',
    duckDuckGo: 'https://api.duckduckgo.com/',
  },
};

/** Routes a fake fetch to a canned JSON body per endpoint keyword. */
function mockFetcher(routes) {
  return async (url) => {
    const target = String(url);
    const route = routes.find(([needle]) => target.includes(needle));
    if (!route) throw new Error(`unexpected fetch: ${target}`);
    const [, responder] = route;
    return typeof responder === 'function' ? responder(target) : { status: 200, body: JSON.stringify(responder) };
  };
}

test('mention targets are extracted from forum text across all sources', async () => {
  const provider = createMentionsProvider({
    fetcher: mockFetcher([
      ['search.json', {
        children: [
          { data: { title: 'Where did OldSite go?', selftext: 'They say the new home is https://newsite.example/ — official.', url_overridden_by_dest: 'https://i.redd.it/pic.png' } },
        ],
      }],
      ['hn.algolia.com', {
        hits: [
          { title: 'OldSite moved', story_text: '', comment_text: 'successor: https://newsite.example/about', url: 'https://oldsite.example/' },
        ],
      }],
      ['api.duckduckgo.com', {
        RelatedTopics: [
          { FirstURL: 'https://newsite.example/', Text: 'NewSite — the official successor of OldSite' },
        ],
      }],
    ]),
    config,
  });
  const { results, providers } = await provider.search('OldSite moved to');
  assert.deepEqual(providers, ['reddit', 'hacker-news', 'duckduckgo']);
  // Deduped by registrable host: newsite.example appears in all three
  // sources but is reported once; oldsite.example (the HN story URL) too.
  const hosts = results.map((r) => new URL(r.url).hostname);
  assert.equal(results.filter((r) => r.url.startsWith('https://newsite.example')).length, 1);
  assert.ok(hosts.includes('oldsite.example'));
  assert.ok(results.every((r) => r.source === 'web_mention'));
  assert.ok(results.every((r) => ['reddit', 'hacker-news', 'duckduckgo'].includes(r.provider)));
});

test('platform hosts, infrastructure hosts, and namespace fragments are never candidates', async () => {
  const provider = createMentionsProvider({
    fetcher: mockFetcher([
      ['search.json', {
        children: [
          { data: { title: 'Discussion', selftext: 'see https://www.reddit.com/r/webdev/comments/x/ and https://ogp.me/ns# and https://schema.org/VideoObject and https://web.archive.org/web/2024/https://old.example/ and real one: https://successor.example/' } },
        ],
      }],
      ['hn.algolia.com', { hits: [] }],
      ['api.duckduckgo.com', { RelatedTopics: [] }],
    ]),
    config,
  });
  const { results } = await provider.search('query');
  assert.equal(results.length, 1);
  assert.equal(results[0].url, 'https://successor.example/');
});

test('a failing source degrades to a warning-shaped absence, others still answer', async () => {
  const provider = createMentionsProvider({
    fetcher: mockFetcher([
      ['search.json', () => ({ status: 429, body: '{}' })],
      ['hn.algolia.com', {
        hits: [{ title: 'moved', comment_text: 'now at https://successor.example/', url: '' }],
      }],
      ['api.duckduckgo.com', () => { throw new Error('ddg offline'); }],
    ]),
    config,
  });
  const { results, providers } = await provider.search('OldSite');
  assert.deepEqual(providers, ['hacker-news']);
  assert.equal(results.length, 1);
  assert.equal(results[0].provider, 'hacker-news');
});

test('queries are built from the site title with forum phrasing', () => {
  const provider = createMentionsProvider({ fetcher: async () => { throw new Error('not used'); }, config });
  const queries = provider.buildQueries({ title: 'Example Site — Official Homepage' });
  assert.equal(queries.length, 2);
  assert.match(queries[0], /"Example Site"/);
  assert.match(queries[1], /moved to/);
  // Too-short or missing titles produce no queries (no fabricated searches).
  assert.deepEqual(provider.buildQueries({ title: 'hi' }), []);
  assert.deepEqual(provider.buildQueries({}), []);
});
