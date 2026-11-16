import test from 'node:test';
import assert from 'node:assert/strict';
import { resurrectUrl, getBackendHealth, NATIVE_HOST_NAME } from '../src/services/backend.js';
import { resultToLinkPatch } from '../src/services/linkService.js';
import { safeHref } from '../src/lib/format.js';

function installNativeMock(reply) {
  const original = globalThis.chrome;
  const requests = [];
  globalThis.chrome = {
    runtime: {
      lastError: null,
      connectNative(name) {
        assert.equal(name, NATIVE_HOST_NAME);
        const messageListeners = [];
        const disconnectListeners = [];
        return {
          onMessage: { addListener(fn) { messageListeners.push(fn); } },
          onDisconnect: { addListener(fn) { disconnectListeners.push(fn); } },
          postMessage(message) { requests.push(message); queueMicrotask(() => reply(message, messageListeners)); },
          disconnect() {},
        };
      },
    },
  };
  return { requests, restore: () => { if (original === undefined) delete globalThis.chrome; else globalThis.chrome = original; } };
}

test('extension sends recovery over native messaging and forwards real progress', async () => {
  const native = installNativeMock((request, listeners) => {
    listeners.forEach((fn) => fn({ requestId: request.requestId, type: 'progress', phase: 'retrieving_snapshots', detail: 'old URL' }));
    listeners.forEach((fn) => fn({ requestId: request.requestId, type: 'done', result: { status: 'no_successor', originalUrl: request.url, finalResult: null } }));
  });
  try {
    const phases = [];
    const result = await resurrectUrl('https://old.example/', { onProgress: (event) => phases.push(event.phase) });
    assert.equal(native.requests[0].type, 'recover');
    assert.equal(native.requests[0].url, 'https://old.example/');
    assert.equal(result.status, 'no_successor');
    assert.deepEqual(phases, ['retrieving_snapshots']);
  } finally { native.restore(); }
});

test('health checks use the native helper without localhost requests', async () => {
  const native = installNativeMock((request, listeners) => listeners.forEach((fn) => fn({ requestId: request.requestId, type: 'done', result: { ok: true, runtime: 'native-messaging', searchCoverage: 'reduced' } })));
  try {
    const health = await getBackendHealth();
    assert.equal(native.requests[0].type, 'health');
    assert.equal(health.runtime, 'native-messaging');
  } finally { native.restore(); }
});

test('verified successor and historical snapshot remain separate in vault data', () => {
  const patch = resultToLinkPatch({
    status: 'completed', originalStatus: { reachable: false, httpStatus: 404 },
    wayback: { fallbackUrl: 'https://web.archive.org/web/20240101/https://old.example/' },
    finalResult: { url: 'https://new.example/article', verified: true, confidenceScore: 91, pageRecovered: false },
  });
  assert.equal(patch.successorUrl, 'https://new.example/article');
  assert.equal(patch.archiveUrl, 'https://web.archive.org/web/20240101/https://old.example/');
  assert.equal(patch.successorVerified, true);
  assert.equal(patch.pageRecovered, false);
});

test('unverified suggestions are never stored as a verified successor', () => {
  const patch = resultToLinkPatch({ finalResult: { url: 'https://possible.example/', verified: false, confidenceScore: 63 } });
  assert.equal(patch.successorUrl, null);
  assert.equal(patch.successorVerified, false);
});

test('HTTP 403 reachable live URL maps to active status', () => {
  const patch = resultToLinkPatch({
    status: 'completed',
    originalStatus: { reachable: true, httpStatus: 403 },
    finalResult: null,
  });
  assert.equal(patch.status, 'active');
  assert.equal(patch.statusCode, 403);
  assert.equal(patch.successorUrl, null);
});

test('HTTP 404 with no successor maps to dead (permanently dead in UI)', () => {
  const patch = resultToLinkPatch({
    status: 'no_successor',
    originalStatus: { reachable: false, httpStatus: 404 },
    wayback: { fallbackUrl: 'https://web.archive.org/web/20230713031404/https://aniwatch.to/' },
    finalResult: null,
  });
  assert.equal(patch.status, 'dead');
  assert.equal(patch.statusCode, 404);
  assert.equal(patch.archiveUrl, 'https://web.archive.org/web/20230713031404/https://aniwatch.to/');
  assert.equal(patch.successorUrl, null);
});

test('safeHref neutralizes dangerous protocol schemes to prevent DOM XSS', () => {
  assert.equal(safeHref('https://example.com/'), 'https://example.com/');
  assert.equal(safeHref('http://example.com/test?q=1'), 'http://example.com/test?q=1');
  assert.equal(safeHref('javascript:alert(1)'), '#');
  assert.equal(safeHref('data:text/html,<script>alert(1)</script>'), '#');
  assert.equal(safeHref('vbscript:msgbox'), '#');
  assert.equal(safeHref('file:///etc/passwd'), '#');
  assert.equal(safeHref(null), '#');
  assert.equal(safeHref(''), '#');
});

test('self-heal: getLinks un-sticks checks interrupted by a crash or reload', async () => {
  const original = globalThis.chrome;
  const store = new Map();
  const stale = Date.now() - 20 * 60_000;
  store.set('lr_links', [
    { id: 'a', url: 'https://a.example/', addedAt: 1, status: 'checking', prevStatus: 'active', checkingStartedAt: stale },
    { id: 'b', url: 'https://b.example/', addedAt: 2, status: 'checking', checkingStartedAt: Date.now() - 10_000 }, // live check
    { id: 'c', url: 'https://c.example/', addedAt: 3, status: 'active' },
    'garbage-row',
  ]);
  globalThis.chrome = { storage: { local: {
    get: async (key) => ({ [key]: store.get(key) }),
    set: async (obj) => { for (const [k, v] of Object.entries(obj)) store.set(k, v); },
  } } };
  try {
    // Fresh module instance: an earlier static import cached isExtensionEnv
    // with chrome undefined, so re-evaluate the storage adapter binding.
    const { getLinks } = await import('../src/services/linkService.js?self-heal-test');
    const links = await getLinks();
    // corrupt row dropped, live check preserved, stale check un-stuck
    assert.equal(links.length, 3);
    const healed = links.find((l) => l.id === 'a');
    assert.equal(healed.status, 'active');
    assert.equal(healed.lastError?.code, 'CHECK_INTERRUPTED');
    assert.equal(links.find((l) => l.id === 'b').status, 'checking');
    // persisted so the fix survives without another heal pass
    const persisted = store.get('lr_links');
    assert.equal(persisted.length, 3);
    assert.equal(persisted.find((l) => l.id === 'a').status, 'active');
  } finally {
    if (original === undefined) delete globalThis.chrome; else globalThis.chrome = original;
  }
});
