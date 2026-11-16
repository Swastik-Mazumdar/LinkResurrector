/**
 * Health checker tests (Phase 3) — deterministic mock fetchers plus real
 * loopback servers where HTTP semantics matter.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHealthChecker } from '../src/core/healthChecker.js';
import { LrError, ERROR_CODES } from '../src/util/errors.js';

const config = {
  fetchTimeoutMs: 2000,
  maxResponseBytes: 256 * 1024,
  maxRedirects: 5,
};
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Builds a fetcher that returns a canned response shape (no network). */
function mockFetcher(responses) {
  const calls = [];
  return Object.assign(
    async (url) => {
      calls.push(String(url));
      const spec = responses[String(url)];
      if (!spec) throw new LrError(ERROR_CODES.DNS_FAILURE, `no mock for ${url}`);
      if (spec.error) throw spec.error;
      return {
        status: spec.status ?? 200,
        headers: spec.headers ?? { 'content-type': 'text/html' },
        body: spec.body ?? '',
        contentType: spec.headers?.['content-type'] ?? 'text/html',
        chain: spec.chain ?? [{ url: String(url), status: spec.status ?? 200, location: null }],
        finalUrl: spec.finalUrl ?? String(url),
        elapsedMs: 5,
      };
    },
    { calls }
  );
}

test('200 with real content classifies as LIVE_OK with identity', async () => {
  const fetcher = mockFetcher({
    'https://site.example/': {
      status: 200,
      body: '<html><head><title>The Example Project</title><meta name="description" content="Docs for the Example Project"></head><body>Welcome to the Example Project homepage. Many words here.</body></html>',
    },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  const record = await checkUrl('https://site.example/');
  assert.equal(record.reachable, true);
  assert.equal(record.httpStatus, 200);
  assert.equal(record.reason, 'LIVE_OK');
  assert.equal(record.suspect, null);
  assert.equal(record.identity.title, 'The Example Project');
  assert.equal(record.identity.description, 'Docs for the Example Project');
});

test('HTTP 403 is restricted, NOT dead', async () => {
  const fetcher = mockFetcher({
    'https://guard.example/': {
      status: 403,
      headers: { 'content-type': 'text/html' },
      body: '<html><body>Access Denied</body></html>',
    },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  const record = await checkUrl('https://guard.example/');
  assert.equal(record.reachable, true);
  assert.equal(record.restricted, true);
  assert.equal(record.reason, 'HTTP_403_RESTRICTED');
  assert.equal(record.suspect, null);
});

test('429 and 401 are restricted; 404 and 410 classify as gone', async () => {
  const fetcher = mockFetcher({
    'https://a.example/': { status: 429, body: 'slow down' },
    'https://b.example/': { status: 401, body: 'auth' },
    'https://c.example/': { status: 404, body: 'not found page content' },
    'https://d.example/': { status: 410, body: 'gone forever' },
    'https://e.example/': { status: 500, body: 'oops' },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  assert.equal((await checkUrl('https://a.example/')).reason, 'HTTP_429_RESTRICTED');
  assert.equal((await checkUrl('https://b.example/')).reason, 'HTTP_401_RESTRICTED');
  assert.equal((await checkUrl('https://c.example/')).reason, 'HTTP_404_NOT_FOUND');
  assert.equal((await checkUrl('https://d.example/')).reason, 'HTTP_410_GONE');
  assert.equal((await checkUrl('https://e.example/')).reason, 'HTTP_500_SERVER_ERROR');
});

test('error responses are NOT reachable — 404/410/5xx can never read as alive', async () => {
  // Regression: `reachable` used to be set true for ANY HTTP response, so
  // hard 404 originals were shown as 'active' in the vault.
  const fetcher = mockFetcher({
    'https://a.example/': { status: 404, body: 'not found page content' },
    'https://b.example/': { status: 410, body: 'gone forever' },
    'https://c.example/': { status: 500, body: 'oops' },
    'https://d.example/': { status: 502, body: 'bad gateway' },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  assert.equal((await checkUrl('https://a.example/')).reachable, false);
  assert.equal((await checkUrl('https://b.example/')).reachable, false);
  assert.equal((await checkUrl('https://c.example/')).reachable, false);
  assert.equal((await checkUrl('https://d.example/')).reachable, false);
});

test('HTTP 200 error pages are flagged as suspect (not trusted as valid)', async () => {
  const fetcher = mockFetcher({
    'https://err.example/': {
      status: 200,
      body: '<html><head><title>404 Not Found</title></head><body>Page not found</body></html>',
    },
    'https://parked.example/': {
      status: 200,
      body: '<html><head><title>Domain Parking</title></head><body>This domain is for sale. Buy this domain at sedoparking.</body></html>',
    },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  assert.equal((await checkUrl('https://err.example/')).suspect, 'error_page');
  assert.equal((await checkUrl('https://parked.example/')).suspect, 'parked_domain');
});

test('cross-domain redirects are detected with the full chain', async () => {
  const fetcher = mockFetcher({
    'https://old.example/': {
      status: 200,
      finalUrl: 'https://new-site.example/',
      chain: [
        { url: 'https://old.example/', status: 301, location: 'https://new-site.example/' },
        { url: 'https://new-site.example/', status: 200, location: null },
      ],
      body: '<html><head><title>New Site</title></head><body></body></html>',
    },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  const record = await checkUrl('https://old.example/');
  assert.equal(record.crossDomainRedirect, 'https://new-site.example/');
  assert.equal(record.reason, 'REDIRECTED_OFFSITE');
  assert.equal(record.redirectChain.length, 2);
});

test('same-domain redirects are not cross-domain', async () => {
  const fetcher = mockFetcher({
    'https://site.example/a': {
      status: 200,
      finalUrl: 'https://site.example/b',
      chain: [
        { url: 'https://site.example/a', status: 302, location: '/b' },
        { url: 'https://site.example/b', status: 200, location: null },
      ],
      body: '<html><head><title>OK</title></head><body></body></html>',
    },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });
  const record = await checkUrl('https://site.example/a');
  assert.equal(record.crossDomainRedirect, null);
  assert.equal(record.reason, 'LIVE_REDIRECT_SAME_SITE');
});

test('network failures map to structured codes without throwing', async () => {
  const fetcher = mockFetcher({
    'https://dead.example/': {
      error: new LrError(ERROR_CODES.DNS_FAILURE, 'DNS lookup failed for dead.example'),
    },
    'https://slow.example/': {
      error: new LrError(ERROR_CODES.CONNECTION_TIMEOUT, 'Connection timed out.'),
    },
  });
  const checkUrl = createHealthChecker({ fetcher, config, logger });

  const deadRecord = await checkUrl('https://dead.example/');
  assert.equal(deadRecord.reachable, false);
  assert.equal(deadRecord.reason, 'DNS_FAILURE');

  const slowRecord = await checkUrl('https://slow.example/');
  assert.equal(slowRecord.reachable, false);
  assert.equal(slowRecord.reason, 'CONNECTION_TIMEOUT');
});

test('real loopback integration: live server checked end-to-end', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><head><title>Loopback Live</title></head><body>Fine.</body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { createSafeFetch } = await import('../src/security/ssrf.js');
    const safeFetch = createSafeFetch();
    const testFetcher = (url, options) => safeFetch(url, { ...options, allowPrivateForTesting: true });
    const checkUrlLoopback = createHealthChecker({ fetcher: testFetcher, config, logger });
    const { port } = server.address();
    const record = await checkUrlLoopback(`http://127.0.0.1:${port}/`);
    assert.equal(record.reachable, true);
    assert.equal(record.reason, 'LIVE_OK');
    assert.equal(record.identity.title, 'Loopback Live');
  } finally {
    server.close();
  }
});
