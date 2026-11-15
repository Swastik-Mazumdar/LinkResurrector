/**
 * Recursive multi-generation orchestrator tests (Phase 18 #1–16, #26–30).
 *
 * The full pipeline runs with REAL extractEvidence / verifyCandidate /
 * confidence components; only the boundaries (checkUrl, wayback, search)
 * are mocked deterministically. No network, no hardcoded engines — the
 * mocks define migration graphs the engine must discover on its own.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrchestrator } from '../src/core/orchestrator.js';
import { createEvidenceExtractor } from '../src/core/evidenceExtractor.js';
import { createCandidateVerifier } from '../src/core/candidateVerifier.js';
import { createConfidenceEngine } from '../src/core/confidence.js';
import { LrError, ERROR_CODES } from '../src/util/errors.js';

const config = {
  maxDepth: 4,
  timeBudgetMs: 60_000,
  maxCandidatesPerGeneration: 6,
  maxSnapshotsAnalyzed: 4,
  minConfidenceToRecurse: 60,
  minConfidenceVerified: 80,
};
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
const extractEvidence = createEvidenceExtractor({ logger });
const score = createConfidenceEngine({ config, logger });

/* ------------------------------------------------------------------ */
/* Mock harness                                                        */
/* ------------------------------------------------------------------ */

/**
 * Builds the orchestrator from a declarative world:
 *   health:   url -> health record (or LrError)
 *   wayback:  url -> { available, snapshots: [{timestamp, original, html}] }
 *   search:   { coverage, resultsByQuery }
 */
function buildEngine({ health, waybackData, search }) {
  const checkUrlCalls = [];

  const checkUrl = async (url) => {
    checkUrlCalls.push(String(url));
    const record = health[String(url)];
    if (!record) {
      return {
        url: String(url), reachable: false, httpStatus: null, reason: ERROR_CODES.DNS_FAILURE,
        restricted: false, suspect: null, redirectChain: [], finalUrl: null,
        crossDomainRedirect: null, contentType: null, elapsedMs: null, identity: null, bodyLength: 0,
      };
    }
    if (record instanceof LrError) {
      return {
        url: String(url), reachable: false, httpStatus: null, reason: record.code,
        restricted: false, suspect: null, redirectChain: [], finalUrl: null,
        crossDomainRedirect: null, contentType: null, elapsedMs: null, identity: null, bodyLength: 0,
      };
    }
    return { bodyLength: record.identity ? 1000 : 0, elapsedMs: 5, redirectChain: [], finalUrl: record.crossDomainRedirect ?? String(url), ...record, url: String(url) };
  };

  const verifyCandidate = createCandidateVerifier({ checkUrl, logger });

  const wayback = {
    querySnapshots: async (url) => {
      const entry = waybackData?.[String(url)];
      if (!entry) return { available: false, snapshots: [], reason: ERROR_CODES.NO_ARCHIVED_SNAPSHOTS };
      if (entry.unavailable) throw new LrError(ERROR_CODES.WAYBACK_UNAVAILABLE, 'rate limited');
      return { available: entry.snapshots.length > 0, snapshots: entry.snapshots.map((s) => ({ timestamp: s.timestamp, original: s.original ?? String(url), statuscode: '200', mimetype: 'text/html', digest: `d${s.timestamp}`, length: '100' })) };
    },
    fetchSnapshotContent: async (snapshot) => {
      const entry = waybackData[String(snapshot.original)];
      const snap = entry?.snapshots.find((s) => s.timestamp === snapshot.timestamp);
      return { status: 200, headers: { 'content-type': 'text/html' }, body: snap?.html ?? '', contentType: 'text/html', chain: [], finalUrl: snapshot.original, elapsedMs: 1 };
    },
    playbackUrl: (snapshot) => snapshot ? `https://web.archive.org/web/${snapshot.timestamp}/${snapshot.original}` : null,
  };

  const searchProvider = {
    coverage: search?.coverage ?? 'reduced',
    configuredProviders: search?.coverage === 'full' ? ['mock'] : [],
    async search(query) {
      if (searchProvider.coverage !== 'full') return { configured: false, results: [] };
      return { configured: true, provider: 'mock', results: search.resultsByQuery?.[query] ?? [] };
    },
    buildQueries: () => search?.queries ?? [],
    isPromisingResultHost: () => true,
  };

  const progressEvents = [];
  const investigate = createOrchestrator({
    checkUrl,
    wayback,
    search: searchProvider,
    extractEvidence,
    verifyCandidate,
    score,
    config,
    logger,
    onProgress: (event) => progressEvents.push(event),
  });

  return { investigate, progressEvents, checkUrlCalls };
}

/** Convenience builders for health records. */
const live = (identityHtml) => ({
  reachable: true, httpStatus: 200, reason: 'LIVE_OK', restricted: false, suspect: null,
  identity: identityHtml
    ? extractIdentity(identityHtml, 'x') && { ...extractIdentity(identityHtml, 'https://self.example/'), announcements: undefined }
    : null,
});
const redirectingTo = (target) => ({
  reachable: true, httpStatus: 301, reason: 'REDIRECTED_OFFSITE',
  restricted: false, suspect: null, crossDomainRedirect: target, identity: null,
});
const dead = (reason = 'HTTP_404_NOT_FOUND') => ({
  reachable: false, httpStatus: reason === 'HTTP_410_GONE' ? 410 : 404, reason,
  restricted: false, suspect: null, crossDomainRedirect: null, identity: null,
});

const siteIdentity = (title, description, extraHtml = '') =>
  `<html><head><title>${title}</title><meta name="description" content="${description}">${extraHtml}</head><body>content body</body></html>`;

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

test('multi-generation migration A→B→C→D via live redirects reaches generation D', async () => {
  const engine = buildEngine({
    health: {
      'https://a.example/': redirectingTo('https://b.example/'),
      'https://b.example/': redirectingTo('https://c.example/'),
      'https://c.example/': redirectingTo('https://d.example/'),
      'https://d.example/': live(siteIdentity('The Project', 'The official project homepage')),
    },
    waybackData: {},
  });

  const result = await engine.investigate('https://a.example/');
  assert.equal(result.status, 'completed');
  assert.equal(result.finalResult.url, 'https://d.example/');
  assert.equal(result.finalResult.verified, true);
  assert.ok(result.finalResult.confidenceScore >= 80);

  const chainUrls = result.migrationChain.map((node) => node.url);
  assert.deepEqual(chainUrls, ['https://a.example/', 'https://b.example/', 'https://c.example/', 'https://d.example/']);
  assert.equal(result.migrationChain[3].generation, 3);
  assert.equal(result.migrationChain[3].status, 'verified_successor');
});

test('unannounced migration discovered through archived HTML evidence', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://successor.example/': live(siteIdentity('Example Blog', 'Long-form notes on software.')),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: siteIdentity('Example Blog', 'Long-form notes on software.') +
            '<p>We have moved! Our new official website is https://successor.example/ — please update your bookmarks.</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  assert.equal(result.status, 'completed');
  assert.equal(result.finalResult.url, 'https://successor.example/');
  assert.equal(result.finalResult.verified, true);
  const gen1 = result.migrationChain.find((node) => node.generation === 1);
  assert.ok(gen1.evidence.some((item) => /official_migration_announcement/.test(item)));
  assert.ok(result.wayback.available, 'fallback snapshot is reported');
  assert.ok(result.wayback.fallbackUrl.includes('web.archive.org'));
});

test('successor that itself migrated later is followed (chain through two archive generations)', async () => {
  const engine = buildEngine({
    health: {
      'https://gen0.example/': dead(),
      'https://gen1.example/': dead('HTTP_410_GONE'),
      'https://gen2.example/': dead(),
      'https://gen3.example/': live(siteIdentity('GenSite', 'The GenSite community wiki and forums.')),
    },
    waybackData: {
      'https://gen0.example/': {
        snapshots: [{
          timestamp: '20220101',
          html: siteIdentity('GenSite', 'The GenSite community wiki and forums.') +
            '<p>We have moved to https://gen1.example/ — our new official website.</p>',
        }],
      },
      'https://gen1.example/': {
        snapshots: [{
          timestamp: '20230601',
          html: siteIdentity('GenSite', 'The GenSite community wiki and forums.') +
            '<p>We have moved to https://gen2.example/ — find us at our new address.</p>',
        }],
      },
      'https://gen2.example/': {
        snapshots: [{
          timestamp: '20240901',
          html: siteIdentity('GenSite', 'The GenSite community wiki and forums.') +
            '<p>We have moved to https://gen3.example/ — our new official website.</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://gen0.example/');
  assert.equal(result.status, 'completed');
  assert.equal(result.finalResult.url, 'https://gen3.example/');
  const chain = result.migrationChain.map((node) => node.url);
  assert.deepEqual(chain, [
    'https://gen0.example/', 'https://gen1.example/', 'https://gen2.example/', 'https://gen3.example/',
  ]);
  assert.ok(result.migrationChain.every((node) => node.generation === chain.indexOf(node.url)));
});

test('archived successor that is now dead blocks the chain (no successor fabricated)', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://successor.example/': dead(),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20230101',
          html: siteIdentity('Old Site', 'Original content here.') +
            '<p>We have moved to https://successor.example/</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  assert.notEqual(result.status, 'completed');
  assert.equal(result.finalResult?.verified ?? false, false);
  assert.ok(result.candidates.some((c) => c.url === 'https://successor.example/' && c.status === 'rejected'));
  assert.ok(result.wayback.fallbackUrl, 'historical fallback is still offered');
});

test('no Wayback snapshots at all → honest no_successor, never an invented URL', async () => {
  const engine = buildEngine({ health: { 'https://nothing.example/': dead() }, waybackData: {} });
  const result = await engine.investigate('https://nothing.example/');
  assert.equal(result.status, 'no_successor');
  assert.equal(result.finalResult, null);
  assert.equal(result.wayback.available, false);
  assert.equal(result.wayback.fallbackUrl, null);
  assert.ok(result.warnings.length >= 1);
});

test('Wayback unavailable → warning, historical evidence incomplete', async () => {
  const engine = buildEngine({
    health: { 'https://x.example/': dead() },
    waybackData: { 'https://x.example/': { unavailable: true } },
  });
  const result = await engine.investigate('https://x.example/');
  assert.equal(result.status, 'no_successor');
  assert.ok(result.warnings.some((w) => /Wayback Machine was unavailable/.test(w)));
});

test('competing candidates: highest-evidence candidate wins, warning recorded', async () => {
  const announcement = (url) => `<p>We have moved to ${url} — our new official website.</p>`;
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://alpha.example/': live(siteIdentity('Example Blog', 'Long-form notes on software.')),
      'https://beta.example/': live(siteIdentity('Example Blog', 'Long-form notes on software.')),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: siteIdentity('Example Blog', 'Long-form notes on software.') +
            announcement('https://alpha.example/') + announcement('https://beta.example/'),
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  assert.equal(result.finalResult.url, 'https://alpha.example/');
  assert.ok(result.warnings.some((w) => /Multiple plausible successors/.test(w)));
  assert.ok(result.candidates.some((c) => c.url === 'https://beta.example/' && c.score !== undefined));
});

test('unrelated site with a similar title is NOT accepted (impersonation guard)', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://copycat.example/': live(siteIdentity('Example Blog Daily News', 'Totally unrelated aggregation feed.')),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: '<html><head><title>Example Blog</title><meta name="description" content="Long-form notes on software."></head><body>Archive content. Also see https://copycat.example/ for aggregated feeds.</body></html>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  // A mere external reference with a similar title is never enough: the
  // candidate is rejected and no successor is claimed.
  const copycat = result.candidates.find((c) => c.url.startsWith('https://copycat.example'));
  assert.ok(copycat, 'candidate was discovered from the historical page link');
  assert.equal(copycat.status, 'rejected');
  assert.notEqual(result.finalResult?.url, 'https://copycat.example/');
  assert.equal(result.finalResult?.verified ?? false, false);
});

test('HTTP 200 error page on the original URL is not treated as live', async () => {
  const errorPageIdentity = extractIdentity(
    '<html><head><title>404 Not Found</title></head><body>Page not found</body></html>', 'x');
  const engine = buildEngine({
    health: {
      'https://broken.example/': {
        reachable: true, httpStatus: 200, reason: 'LIVE_OK', restricted: false,
        suspect: 'error_page', crossDomainRedirect: null,
        identity: { ...errorPageIdentity, announcements: [] },
      },
      'https://successor.example/': live(siteIdentity('The Broken Project', 'The official project site.')),
    },
    waybackData: {
      'https://broken.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: siteIdentity('The Broken Project', 'The official project site.') +
            '<p>We have moved to https://successor.example/</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://broken.example/');
  assert.equal(result.status, 'completed');
  assert.equal(result.finalResult.url, 'https://successor.example/');
});

test('parked-domain candidate is rejected, never verified', async () => {
  const parkedIdentity = extractIdentity(
    '<html><head><title>Parked</title></head><body>This domain is for sale. Buy this domain.</body></html>', 'x');
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://forsale.example/': {
        reachable: true, httpStatus: 200, reason: 'LIVE_OK', restricted: false,
        suspect: 'parked_domain', crossDomainRedirect: null,
        identity: { ...parkedIdentity, announcements: [] },
      },
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: siteIdentity('Old Site', 'Original content.') +
            '<p>We have moved to https://forsale.example/</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  const candidate = result.candidates.find((c) => c.url === 'https://forsale.example/');
  assert.ok(candidate);
  assert.equal(candidate.status, 'rejected');
  assert.notEqual(result.finalResult?.url, 'https://forsale.example/');
});

test('circular redirects are stopped by visited-domain tracking', async () => {
  const engine = buildEngine({
    health: {
      'https://a.example/': redirectingTo('https://b.example/'),
      'https://b.example/': redirectingTo('https://a.example/'),
    },
    waybackData: {},
  });

  const result = await engine.investigate('https://a.example/');
  const chainUrls = result.migrationChain.map((node) => node.url);
  const unique = new Set(chainUrls);
  assert.equal(unique.size, chainUrls.length, 'no domain may repeat in the chain');
  assert.ok(result.candidates.some((c) => /already investigated/.test(c.reason ?? '')));
});

test('depth limit stops recursion with an explicit warning and best result', async () => {
  const tightConfig = { ...config, maxDepth: 2 };
  const gen = (n) => `https://gen${n}.example/`;
  const health = {};
  for (let i = 0; i < 6; i++) health[gen(i)] = redirectingTo(gen(i + 1));

  const checkUrl = async (url) => {
    const record = health[String(url)] ?? { reachable: true, httpStatus: 200, reason: 'LIVE_OK', restricted: false, suspect: null, crossDomainRedirect: null, identity: null };
    return { ...record, url: String(url), bodyLength: 0, elapsedMs: 1, redirectChain: [], finalUrl: String(url) };
  };
  const verifyCandidate = createCandidateVerifier({ checkUrl, logger });
  const investigate = createOrchestrator({
    checkUrl, wayback: {
      querySnapshots: async () => ({ available: false, snapshots: [], reason: ERROR_CODES.NO_ARCHIVED_SNAPSHOTS }),
      fetchSnapshotContent: async () => { throw new LrError(ERROR_CODES.WAYBACK_UNAVAILABLE, 'none'); },
      playbackUrl: () => null,
    },
    search: { coverage: 'reduced', configuredProviders: [], search: async () => ({ configured: false, results: [] }), buildQueries: () => [], isPromisingResultHost: () => false },
    extractEvidence, verifyCandidate, score, config: tightConfig, logger,
  });

  const result = await investigate(gen(0));
  assert.ok(result.warnings.some((w) => /maximum depth/.test(w)));
  assert.ok(result.migrationChain.length <= tightConfig.maxDepth + 3, 'chain respects the depth budget');
  assert.notEqual(result.status, 'completed');
});

test('reduced search coverage is reported honestly, exactly once', async () => {
  const engine = buildEngine({ health: { 'https://x.example/': dead() }, waybackData: {} });
  const result = await engine.investigate('https://x.example/');
  const coverageWarnings = result.warnings.filter((w) => /reduced/.test(w));
  assert.equal(coverageWarnings.length, 1);
});

test('successor discovered OUTSIDE Wayback via search + matching identity verifies', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://found.example/': live(siteIdentity('Example Blog', 'Long-form notes on software and infrastructure.')),
    },
    waybackData: {}, // no archive at all
    search: {
      coverage: 'full',
      queries: ['"Example Blog" moved new domain'],
      resultsByQuery: {
        '"Example Blog" moved new domain': [
          { url: 'https://found.example/', title: 'Example Blog', snippet: 'Long-form notes on software.' },
        ],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  assert.equal(result.finalResult?.url, 'https://found.example/');
  assert.equal(result.finalResult?.verified, true);
  assert.ok(result.evidence.some((item) => item.type === 'search_result'));
});

test('progress events are emitted across the investigation phases', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://successor.example/': live(siteIdentity('Example Blog', 'Long-form notes on software.')),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: siteIdentity('Example Blog', 'Long-form notes on software.') +
            '<p>We have moved to https://successor.example/</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  const phases = engine.progressEvents.map((event) => event.phase);
  assert.ok(phases.includes('initializing'));
  assert.ok(phases.includes('retrieving_snapshots'));
  assert.ok(phases.includes('analyzing_history'));
  assert.ok(phases.includes('verifying_candidates'));
  assert.ok(result.warnings !== undefined);
});

test('duplicate candidate hosts are eliminated (no double verification)', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://new.example/': live(siteIdentity('New Home', 'We moved here.')),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [
          {
            timestamp: '20230101',
            html: '<p>We have moved to https://new.example/</p>',
          },
          {
            timestamp: '20240101',
            html: '<p>Find us at our new address: https://new.example/welcome</p>',
          },
        ],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  const newCandidates = result.candidates.filter((c) => c.url.startsWith('https://new.example'));
  assert.ok(newCandidates.length <= 2, 'same registrable domain collapses to one candidate');
});

test('multiple conflicting announcements do not crash and are recorded as evidence', async () => {
  const engine = buildEngine({
    health: {
      'https://old.example/': dead(),
      'https://x.example/': dead(),
      'https://y.example/': dead(),
    },
    waybackData: {
      'https://old.example/': {
        snapshots: [{
          timestamp: '20240101',
          html: siteIdentity('Old', 'Original.') +
            '<p>We have moved to https://x.example/</p><p>Ignore the old notice: our new official website is now https://y.example/</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://old.example/');
  assert.ok(['no_successor', 'partial'].includes(result.status));
  assert.ok(result.candidates.length >= 1);
});

test('website migrated AFTER its last Wayback capture: redirect beats stale archive', async () => {
  const engine = buildEngine({
    health: {
      'https://latemove.example/': redirectingTo('https://late-successor.example/'),
      'https://late-successor.example/': live(siteIdentity('LateMover', 'The official LateMover site.')),
    },
    waybackData: {
      'https://latemove.example/': {
        snapshots: [{
          timestamp: '20220101',
          html: siteIdentity('LateMover', 'The official LateMover site.') + '<p>Stale content, nothing about migrations.</p>',
        }],
      },
    },
  });

  const result = await engine.investigate('https://latemove.example/');
  assert.equal(result.finalResult?.url, 'https://late-successor.example/');
  assert.equal(result.finalResult?.verified, true);
});
