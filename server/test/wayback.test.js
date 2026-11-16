/** Wayback CDX client tests (Phase 4) — deterministic mock fetcher. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createWaybackClient } from '../src/providers/wayback.js';
import { LrError, ERROR_CODES } from '../src/util/errors.js';

const config = {
  cacheTtlMs: 10_000,
  fetchTimeoutMs: 5000,
  maxResponseBytes: 1024 * 1024,
  wayback: {
    cdxEndpoint: 'https://web.archive.org/cdx/search/cdx',
    webEndpoint: 'https://web.archive.org/web/',
    minIntervalMs: 0, // no rate gate delay in tests
    maxCdxRows: 40,
  },
  maxSnapshotsAnalyzed: 4,
};

const CDX_HEADER = ['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length'];

function cdxBody(rows) {
  return JSON.stringify([CDX_HEADER, ...rows]);
}

function snapshot(ts, original, extra = {}) {
  return {
    timestamp: ts,
    original: original ?? 'https://old.example/',
    statuscode: '200',
    mimetype: 'text/html',
    digest: `digest-${ts}`,
    length: '1000',
    ...extra,
  };
}

test('querySnapshots parses CDX JSON, filters 200-HTML and reports availability', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: cdxBody([
        [snapshot('20220101').timestamp, 'https://old.example/', '200', 'text/html', 'd1', '1000'],
        [snapshot('20230601').timestamp, 'https://old.example/', '200', 'text/html', 'd2', '1000'],
        [snapshot('20240901').timestamp, 'https://old.example/', '200', 'text/html', 'd3', '1000'],
      ]),
      contentType: 'application/json',
      chain: [],
      finalUrl: url,
      elapsedMs: 1,
    };
  };
  const wayback = createWaybackClient({ fetcher, config, logger: { debug: () => {} } });

  const result = await wayback.querySnapshots('https://old.example/');
  assert.equal(result.available, true);
  assert.equal(result.snapshots.length, 3);
  assert.equal(result.snapshots[0].timestamp, '20220101');
  assert.ok(calls[0].includes('web.archive.org/cdx'));
  assert.ok(calls[0].includes('filter=statuscode%3A200'));
});

test('querySnapshots reports NO_ARCHIVED_SNAPSHOTS when the archive is empty', async () => {
  const fetcher = async () => ({
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: '[]',
    contentType: 'application/json',
    chain: [],
    finalUrl: '',
    elapsedMs: 1,
  });
  const wayback = createWaybackClient({ fetcher, config, logger: { debug: () => {} } });
  const result = await wayback.querySnapshots('https://nothing.example/');
  assert.equal(result.available, false);
  assert.equal(result.reason, ERROR_CODES.NO_ARCHIVED_SNAPSHOTS);
});

test('querySnapshots surfaces rate limiting and server errors as WAYBACK_UNAVAILABLE', async () => {
  const rateLimited = createWaybackClient({
    fetcher: async () => ({ status: 429, headers: {}, body: '', contentType: '', chain: [], finalUrl: '', elapsedMs: 1 }),
    config,
    logger: { debug: () => {} },
  });
  await assert.rejects(rateLimited.querySnapshots('https://x.example/'), (error) =>
    error.code === ERROR_CODES.WAYBACK_UNAVAILABLE && /rate limiting/i.test(error.message)
  );

  const broken = createWaybackClient({
    fetcher: async () => ({ status: 503, headers: {}, body: 'nope', contentType: '', chain: [], finalUrl: '', elapsedMs: 1 }),
    config,
    logger: { debug: () => {} },
  });
  await assert.rejects(broken.querySnapshots('https://x.example/'), (error) =>
    error.code === ERROR_CODES.WAYBACK_UNAVAILABLE
  );
});

test('malformed CDX data produces a structured error, never a crash', async () => {
  const wayback = createWaybackClient({
    fetcher: async () => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '<<<not json>>>',
      contentType: 'application/json',
      chain: [],
      finalUrl: '',
      elapsedMs: 1,
    }),
    config,
    logger: { debug: () => {} },
  });
  await assert.rejects(wayback.querySnapshots('https://x.example/'), (error) =>
    error.code === ERROR_CODES.WAYBACK_UNAVAILABLE && /malformed/i.test(error.message)
  );
});

test('fetchSnapshotContent requests the raw id_ playback variant', async () => {
  let requestedUrl = '';
  const fetcher = async (url) => {
    requestedUrl = String(url);
    return {
      status: 200,
      headers: { 'content-type': 'text/html' },
      body: '<html><body>archived content</body></html>',
      contentType: 'text/html',
      chain: [],
      finalUrl: url,
      elapsedMs: 1,
    };
  };
  const wayback = createWaybackClient({ fetcher, config, logger: { debug: () => {} } });
  const response = await wayback.fetchSnapshotContent(snapshot('20230615'));
  assert.ok(/web\/20230615id_\//.test(requestedUrl), `raw id_ URL expected, got ${requestedUrl}`);
  assert.match(response.body, /archived content/);
});

test('playbackUrl builds the user-facing historical fallback URL', () => {
  const wayback = createWaybackClient({ fetcher: async () => {}, config, logger: { debug: () => {} } });
  assert.equal(
    wayback.playbackUrl(snapshot('20230615')),
    'https://web.archive.org/web/20230615/https://old.example/'
  );
  assert.equal(wayback.playbackUrl(null), null);
});

test('identical repeated queries are served from cache (single fetch)', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls += 1;
    return {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: cdxBody([[snapshot('20230101').timestamp, 'https://cached.example/', '200', 'text/html', 'd1', '100']]),
      contentType: 'application/json',
      chain: [],
      finalUrl: '',
      elapsedMs: 1,
    };
  };
  const wayback = createWaybackClient({ fetcher, config, logger: { debug: () => {} } });
  const first = await wayback.querySnapshots('https://cached.example/');
  const second = await wayback.querySnapshots('https://cached.example/');
  assert.equal(calls, 1);
  assert.equal(first.snapshots.length, second.snapshots.length);
});
