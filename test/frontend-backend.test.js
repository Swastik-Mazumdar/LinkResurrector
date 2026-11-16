import test from 'node:test';
import assert from 'node:assert/strict';
import { resurrectUrl, getBackendHealth, NATIVE_HOST_NAME } from '../src/services/backend.js';
import { resultToLinkPatch } from '../src/services/linkService.js';

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
