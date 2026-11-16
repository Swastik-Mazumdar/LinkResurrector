/**
 * Native Messaging host integration tests (deterministic, no real-site scanning).
 *
 * Spawns server/native-host.js as a child process and speaks the real
 * uint32-LE framed JSON protocol over stdio, exactly like Chrome does.
 * Verifies request validation, requestId correlation, progress forwarding,
 * the per-helper concurrency guard, and that stdout stays protocol-only.
 *
 * Reachability targets use the reserved `.example` TLD (reserved (RFC 2606, fast DNS failure),
 * RFC 2606), so no real website is ever contacted.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNativeDecoder, encodeNativeMessage } from '../src/nativeProtocol.js';
import { tmpdir } from 'node:os';

const HOST_SCRIPT = fileURLToPath(new URL('../native-host.js', import.meta.url));

/** Starts the helper and returns a small request/response harness. */
function startHost() {
  // Hermetic per-test lock so parallel/killed helpers never pollute each other.
  const lockPath = `${tmpdir()}/lr-native-host-test-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`;
  const child = spawn(process.execPath, [HOST_SCRIPT], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, LR_LOCK_PATH: lockPath },
  });
  const state = { messages: [], decodeErrors: [] };
  child.stdout.on('data', createNativeDecoder(
    (message) => state.messages.push(message),
    (error) => state.decodeErrors.push(error.message),
  ));
  child.stderr.on('data', () => { /* logs are expected on stderr; not protocol */ });
  child.on('exit', () => { /* harness closes via close() */ });

  let nextId = 0;
  return {
    state,
    /** Sends a request and returns its requestId. */
    request(payload) {
      const requestId = `req-${nextId++}`;
      child.stdin.write(encodeNativeMessage({ requestId, ...payload }));
      return requestId;
    },
    /** Writes an already-encoded frame verbatim (for malformed-frame tests). */
    rawWrite(frame) {
      child.stdin.write(frame);
    },
    /** Resolves with replies for requestId once the wait condition is met. */
    async repliesFor(requestId, { timeoutMs = 60000, waitAll = 1, terminal = false } = {}) {
      const isTerminal = (m) => m.type === 'done' || m.type === 'error';
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        const replies = state.messages.filter((m) => m.requestId === requestId);
        const ready = terminal
          ? replies.some(isTerminal)
          : replies.length >= waitAll;
        if (ready) return replies;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return state.messages.filter((m) => m.requestId === requestId);
    },
    close() {
      if (!child.killed) child.kill();
      return new Promise((resolve) => child.once('exit', resolve));
    },
  };
}

test('health request returns the on-device runtime descriptor', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  const id = host.request({ type: 'health' });
  const [reply] = await host.repliesFor(id);
  assert.equal(reply.type, 'done');
  assert.equal(reply.result.ok, true);
  assert.equal(reply.result.runtime, 'native-messaging');
  assert.ok(['reduced', 'full'].includes(reply.result.searchCoverage));
});

test('invalid targets are refused with INVALID_URL and never reach the engine', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  const badUrls = [
    'ftp://example.example/file',
    'https://user:pass@example.example/',
    'javascript:alert(1)',
    `https://x.example/${'a'.repeat(9000)}`,
  ];
  const ids = badUrls.map((url) => host.request({ type: 'recover', url }));
  for (const id of ids) {
    const [reply] = await host.repliesFor(id);
    assert.equal(reply.type, 'error', `expected error for ${badUrls[ids.indexOf(id)]}`);
    assert.equal(reply.error.code, 'INVALID_URL');
  }
  // Engine phases must never have started for any of them.
  assert.ok(!host.state.messages.some((m) => m.type === 'progress'));
});

test('unknown request types produce INVALID_REQUEST and echo the requestId', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  const id = host.request({ type: 'teleport', url: 'https://target.example/' });
  const [reply] = await host.repliesFor(id);
  assert.equal(reply.type, 'error');
  assert.equal(reply.error.code, 'INVALID_REQUEST');
  assert.equal(reply.requestId, id);
});

test('frames without a well-formed requestId are ignored (no reply flood)', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  const before = host.state.messages.length;
  host.rawWrite(encodeNativeMessage({ requestId: 'bad id!!', type: 'health' }));
  host.rawWrite(encodeNativeMessage({ type: 'health' }));
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(host.state.messages.length, before, 'no reply may be produced for malformed requestIds');
});

test('a second recovery while one is running is refused with RATE_LIMITED', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  // Both requests are dispatched before either engine run can finish, so the
  // helper must refuse the second via activeRecovery or the cross-process lock.
  const first = host.request({ type: 'recover', url: 'https://slow.example/' });
  const second = host.request({ type: 'recover', url: 'https://slow2.example/' });
  const replies = await host.repliesFor(second);
  const refusal = replies.find((m) => m.type === 'error' && m.error.code === 'RATE_LIMITED');
  assert.ok(refusal, 'the overlapping recovery must be refused');
  assert.ok(host.state.messages.some((m) => m.requestId === first), 'the first job still runs');
});

test('reserved-TLD recovery completes honestly without fabricating a successor', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  const id = host.request({ type: 'recover', url: 'https://definitely-not-real.example/' });
  const replies = await host.repliesFor(id, { terminal: true });
  const done = replies.find((m) => m.type === 'done');
  assert.ok(done, 'recovery must finish with a done frame');
  const result = done.result;
  assert.equal(result.originalUrl, 'https://definitely-not-real.example/');
  assert.equal(result.finalResult, null, 'no successor may be invented');
  assert.ok(['no_successor', 'partial'].includes(result.status));
  assert.ok(Array.isArray(result.warnings) && result.warnings.length > 0);
  assert.equal(host.state.decodeErrors.length, 0, 'stdout must stay a clean framed protocol stream');
});

test('progress frames are forwarded with bounded phase strings', async (t) => {
  const host = startHost();
  t.after(() => host.close());
  const id = host.request({ type: 'recover', url: 'https://definitely-not-real.example/' });
  await host.repliesFor(id, { terminal: true });
  const phases = host.state.messages
    .filter((m) => m.requestId === id && m.type === 'progress')
    .map((m) => m.phase);
  assert.ok(phases.includes('initializing'), `got phases: ${phases.join(', ')}`);
  assert.ok(phases.includes('checking_original'), `got phases: ${phases.join(', ')}`);
  for (const phase of phases) assert.ok(phase.length <= 80, `phase "${phase}" must stay bounded`);
});
