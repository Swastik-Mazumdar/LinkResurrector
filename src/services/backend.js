/**
 * Backend client for the Resurrector engine.
 *
 * Talks to the local recovery backend (server/index.js):
 *   POST /api/resurrect              — start a recovery job
 *   GET  /api/resurrect/:jobId       — poll job status
 *   GET  /api/resurrect/:jobId/events— SSE live progress
 *   POST /api/verify                 — verify a single candidate URL
 *   GET  /api/health                 — availability probe
 *
 * The endpoint defaults to the local dev backend; it can be overridden via
 * settings (`backendEndpoint`). Everything here degrades honestly: if the
 * backend is offline the UI is told, and no results are ever fabricated.
 */

import { getSettings } from './linkService.js';

export const DEFAULT_BACKEND_ENDPOINT = 'http://localhost:8787';

export async function getBackendEndpoint() {
  const settings = await getSettings();
  return (settings.backendEndpoint || DEFAULT_BACKEND_ENDPOINT).replace(/\/+$/, '');
}

/** Honest availability probe — never fabricates. */
export async function checkBackendHealth(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(`${endpoint}/api/health`, { signal: controller.signal });
    if (!response.ok) return { available: false, reason: `HTTP ${response.status}` };
    const info = await response.json();
    return { available: Boolean(info?.ok), info };
  } catch (error) {
    return { available: false, reason: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Starts a recovery job and streams live progress.
 *
 * @param {string} url
 * @param {{ onEvent?: (event: object) => void, signal?: AbortSignal }} opts
 * @returns {Promise<{ job: object, result: object }>} terminal job snapshot
 */
export async function resurrectUrl(url, { onEvent, signal } = {}) {
  const endpoint = await getBackendEndpoint();

  const startResponse = await fetch(`${endpoint}/api/resurrect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  if (!startResponse.ok) {
    const body = await startResponse.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Backend responded ${startResponse.status}`);
  }
  const { jobId } = await startResponse.json();
  if (!jobId) throw new Error('Backend did not return a jobId');
  onEvent?.({ type: 'progress', phase: 'job_created', detail: jobId });

  // Live progress over SSE, with polling as an honest fallback.
  try {
    return await consumeSseStream(`${endpoint}/api/resurrect/${jobId}/events`, onEvent, signal);
  } catch {
    return await pollJobUntilDone(endpoint, jobId, onEvent, signal);
  }
}

/** Verifies a single candidate URL independently. */
export async function verifyCandidate(url, signal) {
  const endpoint = await getBackendEndpoint();
  const response = await fetch(`${endpoint}/api/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return body;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

async function consumeSseStream(eventsUrl, onEvent, signal) {
  const response = await fetch(eventsUrl, { signal });
  if (!response.ok || !response.body) throw new Error('SSE unavailable');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal = null;

  while (terminal === null) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLine = rawEvent
        .split('\n')
        .find((line) => line.startsWith('data:'));
      if (!dataLine) continue;

      let event;
      try {
        event = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue; // malformed frame — skip, never fabricate
      }

      if (event.type === 'progress') onEvent?.(event);
      else if (event.type === 'done') terminal = event;
      else if (event.type === 'error') terminal = event;
    }
  }

  if (!terminal) throw new Error('SSE stream ended without a terminal event');
  if (terminal.type === 'error') throw new Error(terminal.error?.message ?? 'Recovery failed');
  return { job: terminal.job ?? null, result: terminal.result ?? null };
}

async function pollJobUntilDone(endpoint, jobId, onEvent, signal) {
  const deadline = Date.now() + 4 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (signal?.aborted) throw new Error('Aborted');
    const response = await fetch(`${endpoint}/api/resurrect/${jobId}`, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const job = await response.json();
    onEvent?.({ type: 'progress', phase: job.phase ?? 'working', detail: job.status });
    if (job.status === 'failed') throw new Error(job.error?.message ?? 'Recovery failed');
    if (job.status !== 'running' && job.status !== 'queued') {
      return { job, result: job.result ?? null };
    }
  }
  throw new Error('Recovery job timed out while polling');
}
