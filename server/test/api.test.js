/**
 * API layer integration tests — real HTTP against createApiServer with
 * a deterministic engine underneath (no network access).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiServer } from '../src/api/routes.js';
import { createJobStore } from '../src/jobs/jobStore.js';

const config = {
  rateLimitWindowMs: 60_000,
  rateLimitMax: 20,
  maxBodyBytes: 16 * 1024,
  maxDepth: 4,
  timeBudgetMs: 90_000,
  maxCandidatesPerGeneration: 6,
  wayback: { cdxEndpoint: 'https://web.archive.org/cdx/search/cdx' },
};

const search = {
  coverage: 'reduced',
  configuredProviders: [],
};

function startServer({ jobRunner, rateMax } = {}) {
  const jobStore = createJobStore({ config: { ...config, rateLimitMax: rateMax ?? config.rateLimitMax } });
  const verifyUrl = async (url) => ({ url, reachable: true, httpStatus: 200, reason: 'LIVE_OK' });
  const server = createApiServer({
    jobStore,
    jobRunner: jobRunner ?? (async (job, { finishSuccess }) => finishSuccess({ status: 'no_successor', originalUrl: job.url })),
    verifyUrl,
    search,
    config: { ...config, rateLimitMax: rateMax ?? config.rateLimitMax },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}`, jobStore }));
  });
}

const post = (baseUrl, path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('GET /api/health reports engine + provider coverage honestly', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.providers.search.coverage, 'reduced');
    assert.equal(body.providers.search.configured, false);
  } finally {
    server.close();
  }
});

test('POST /api/resurrect validates the URL and returns a jobId', async () => {
  const { server, baseUrl, jobStore } = await startServer();
  try {
    const bad = await post(baseUrl, '/api/resurrect', { url: 'not a url at all' });
    assert.equal(bad.status, 400);
    const badBody = await bad.json();
    assert.equal(badBody.error.code, 'INVALID_URL');

    const missing = await post(baseUrl, '/api/resurrect', {});
    assert.equal(missing.status, 400);

    const ok = await post(baseUrl, '/api/resurrect', { url: 'example.com/dead-page' });
    assert.equal(ok.status, 202);
    const { jobId } = await ok.json();
    assert.ok(jobId);
    assert.equal(jobStore.get(jobId).url, 'https://example.com/dead-page');
  } finally {
    server.close();
  }
});

test('GET /api/resurrect/:jobId returns the completed result; unknown id is 404', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const { jobId } = await (await post(baseUrl, '/api/resurrect', { url: 'https://gone.example/' })).json();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const response = await fetch(`${baseUrl}/api/resurrect/${jobId}`);
    assert.equal(response.status, 200);
    const job = await response.json();
    assert.equal(job.status, 'completed');
    assert.equal(job.result.status, 'no_successor');

    const missing = await fetch(`${baseUrl}/api/resurrect/does-not-exist`);
    assert.equal(missing.status, 404);
    const missingBody = await missing.json();
    assert.equal(missingBody.error.code, 'JOB_NOT_FOUND');
  } finally {
    server.close();
  }
});

test('SSE /events streams progress and a terminal done frame', async () => {
  const { server, baseUrl } = await startServer({
    jobRunner: async (job, { progress, finishSuccess }) => {
      progress('checking_original', job.url);
      await new Promise((resolve) => setTimeout(resolve, 10));
      progress('discovering_successors', '1 candidate');
      finishSuccess({ status: 'no_successor', originalUrl: job.url });
    },
  });
  try {
    const { jobId } = await (await post(baseUrl, '/api/resurrect', { url: 'https://stream.example/' })).json();
    const response = await fetch(`${baseUrl}/api/resurrect/${jobId}/events`);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');

    const text = await response.text();
    const frames = text
      .split('\n\n')
      .filter((frame) => frame.startsWith('data: '))
      .map((frame) => JSON.parse(frame.slice(6)));

    assert.ok(frames.some((frame) => frame.type === 'progress' && frame.phase === 'checking_original'));
    assert.ok(frames.some((frame) => frame.type === 'progress' && frame.phase === 'discovering_successors'));
    const done = frames.at(-1);
    assert.equal(done.type, 'done');
    assert.equal(done.result.status, 'no_successor');
  } finally {
    server.close();
  }
});

test('POST /api/verify returns independent verification', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await post(baseUrl, '/api/verify', { url: 'https://candidate.example/' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.url, 'https://candidate.example/');
    assert.equal(body.reachable, true);
    assert.equal(body.httpStatus, 200);

    const bad = await post(baseUrl, '/api/verify', { url: '::::' });
    assert.equal(bad.status, 400);
  } finally {
    server.close();
  }
});

test('malformed JSON and oversized bodies are rejected cleanly', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const badJson = await post(baseUrl, '/api/resurrect', '{not json');
    assert.equal(badJson.status, 400);

    const huge = await post(baseUrl, '/api/resurrect', JSON.stringify({ url: 'https://x.example/'.padEnd(20_000, 'x') }));
    assert.equal(huge.status, 413);
  } finally {
    server.close();
  }
});

test('per-IP rate limiting rejects bursts with RATE_LIMITED', async () => {
  const { server, baseUrl } = await startServer({ rateMax: 3 });
  try {
    let last;
    for (let i = 0; i < 6; i++) {
      last = await post(baseUrl, '/api/resurrect', { url: `https://burst-${i}.example/` });
    }
    assert.equal(last.status, 429);
    const body = await last.json();
    assert.equal(body.error.code, 'RATE_LIMITED');
  } finally {
    server.close();
  }
});

test('CORS preflight is answered for extension origins', async () => {
  const { server, baseUrl } = await startServer();
  try {
    const response = await fetch(`${baseUrl}/api/resurrect`, { method: 'OPTIONS' });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  } finally {
    server.close();
  }
});
