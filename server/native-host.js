#!/usr/bin/env node
/** Chrome Native Messaging host. stdout is reserved for framed JSON only. */
import { createEngine, config } from './src/engine.js';
import { createLogger } from './src/logger.js';
import { createNativeDecoder, encodeNativeMessage } from './src/nativeProtocol.js';
import { appendFileSync } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const logger = createLogger('native-host');
let activeRecovery = false;
let inputFailed = false;
const engine = createEngine();
// LR_LOCK_PATH exists for deterministic testing; production uses the
// per-user tmpdir lock so concurrent helpers on one machine cooperate.
const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
const lockPath = process.env.LR_LOCK_PATH
  ?? join(tmpdir(), `linkresurrector-${uid}.lock`);

/**
 * Content-free diagnostics: timestamps, PIDs and event kinds only — never
 * URLs or recovered data. Chrome discards the helper's stderr, so this
 * append-only log is the only way to see whether/why the process died.
 */
const diagPath = join(tmpdir(), `linkresurrector-helper-diag-${uid}.log`);
function diag(event, fields = {}) {
  try {
    appendFileSync(diagPath, `${JSON.stringify({ ts: new Date().toISOString(), event, pid: process.pid, ...fields })}\n`);
  } catch { /* diagnostics must never break the host */ }
}
diag('launch', { node: process.versions.node });
process.on('uncaughtException', (error) => {
  diag('crash', { kind: 'uncaughtException', message: String(error?.message ?? error), at: String(error?.stack ?? '').split('\n')[1] ?? '' });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  diag('crash', { kind: 'unhandledRejection', message: String(reason?.message ?? reason) });
  process.exit(1);
});

function send(message) {
  try { process.stdout.write(encodeNativeMessage(message)); }
  catch (error) { logger.error('could not write native response', { message: error.message }); process.exitCode = 1; }
}

function validUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

async function handle(message) {
  const requestId = typeof message?.requestId === 'string' && /^[\w-]{1,100}$/.test(message.requestId)
    ? message.requestId
    : null;
  if (!requestId) return;
  diag('request', { type: message?.type ?? null });
  try {
    if (message.type === 'health') {
      send({ requestId, type: 'done', result: { ok: true, runtime: 'native-messaging', searchCoverage: engine.coverage, mentionSources: engine.mentionSources, maxDepth: config.maxDepth } });
      return;
    }
    const url = validUrl(message.url);
    if (!url) {
      send({ requestId, type: 'error', error: { code: 'INVALID_URL', message: 'Provide a valid HTTP or HTTPS URL without embedded credentials.' } });
      return;
    }
    if (message.type === 'verify') {
      send({ requestId, type: 'done', result: await engine.verify(url) });
      return;
    }
    if (message.type !== 'recover') {
      send({ requestId, type: 'error', error: { code: 'INVALID_REQUEST', message: 'Unknown native helper request.' } });
      return;
    }
    // Claim the slot synchronously (before any await) so two requests decoded
    // back-to-back cannot both pass this check-then-act guard.
    if (activeRecovery) {
      send({ requestId, type: 'error', error: { code: 'RATE_LIMITED', message: 'A recovery job is already running on this helper.' } });
      return;
    }
    activeRecovery = true;
    let releaseLock = null;
    try {
      releaseLock = await acquireRecoveryLock();
      if (!releaseLock) {
        send({ requestId, type: 'error', error: { code: 'RATE_LIMITED', message: 'Another LinkResurrector recovery is already running for this computer user.' } });
        return;
      }
      const result = await engine.recover(url, {
        titleHint: typeof message.titleHint === 'string' ? message.titleHint.slice(0, 300) : undefined,
        onProgress: (event) => send({ requestId, type: 'progress', phase: String(event.phase ?? '').slice(0, 80), detail: String(event.detail ?? '').slice(0, 1000) }),
      });
      // Release the cross-process slot BEFORE answering: the extension starts
      // its next queued recovery as soon as this frame lands, and a helper
      // launched in that window must not see a finished job's lock.
      await releaseLock();
      releaseLock = null;
      send({ requestId, type: 'done', result });
    } finally {
      activeRecovery = false;
      if (releaseLock) await releaseLock();
    }
  } catch (error) {
    logger.error('native request failed', { requestId, code: error?.code ?? 'INTERNAL_SERVER_ERROR', message: error?.message });
    diag('error-reply', { code: error?.code ?? 'INTERNAL_SERVER_ERROR' });
    send({ requestId, type: 'error', error: { code: error?.code ?? 'INTERNAL_SERVER_ERROR', message: String(error?.message ?? 'Recovery failed.').slice(0, 500) } });
  }
}

async function acquireRecoveryLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: Date.now() }));
      await handle.close();
      return async () => { try { await unlink(lockPath); } catch { /* already removed */ } };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        const [raw, info] = await Promise.all([import('node:fs/promises').then((fs) => fs.readFile(lockPath, 'utf8')), stat(lockPath)]);
        let record = null;
        try { record = JSON.parse(raw); } catch { /* corrupt record */ }
        let alive = false;
        if (record && Number.isInteger(record.pid) && record.pid > 0) {
          try { process.kill(record.pid, 0); alive = true; } catch (probeError) { alive = probeError.code === 'EPERM'; }
        }
        // A live owner holds the job (unless it timed out after 2 minutes).
        // A dead owner has provably released it, so reclaim immediately;
        // a corrupt record gets the safety window.
        if (alive && Date.now() - (record?.startedAt ?? 0) < 120_000) return null;
        if (!record && Date.now() - info.mtimeMs < 5 * 60_000) return null;
        await unlink(lockPath);
      } catch (inspectError) {
        if (inspectError.code === 'ENOENT') continue;
        return null;
      }
    }
  }
  return null;
}

process.stdin.on('data', createNativeDecoder((message) => { void handle(message); }, (error) => {
  inputFailed = true;
  logger.error('invalid native input', { message: error.message });
  diag('invalid-input', { message: error.message });
  process.exitCode = 1;
  process.stdin.destroy();
}));
process.stdin.on('end', () => {
  if (!inputFailed) process.exitCode ??= 0;
  diag('exit', { code: process.exitCode ?? 0 });
});
process.stdin.on('error', (error) => {
  logger.error('native input failed', { message: error.message });
  diag('input-error', { message: error.message });
  process.exitCode = 1;
});
