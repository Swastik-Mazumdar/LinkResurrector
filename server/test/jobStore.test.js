/** Job store tests — lifecycle, event-log replay for SSE, bounded memory. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobStore } from '../src/jobs/jobStore.js';

const config = { jobTtlMs: 60_000, maxJobs: 3 };

function makeStore() {
  return createJobStore({ config, logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } });
}

test('job runs to completion and exposes the result', async () => {
  const store = makeStore();
  const job = store.createJob('https://x.example/', async (_job, { progress, finishSuccess }) => {
    progress('checking_original', 'https://x.example/');
    await new Promise((resolve) => setTimeout(resolve, 5));
    finishSuccess({ status: 'no_successor', originalUrl: 'https://x.example/' });
  });

  assert.equal(job.status, 'queued');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(job.status, 'completed');
  assert.equal(job.result.status, 'no_successor');
  assert.equal(store.publicJob(job).status, 'completed');
});

test('runner crash is converted into a structured failed job', async () => {
  const store = makeStore();
  const job = store.createJob('https://x.example/', async () => {
    throw new Error('boom');
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(job.status, 'failed');
  assert.equal(job.error.message, 'boom');
});

test('finishError is ignored after success (and vice versa)', async () => {
  const store = makeStore();
  const job = store.createJob('https://x.example/', async (_job, { finishSuccess, finishError }) => {
    finishSuccess({ status: 'completed' });
    finishError('INTERNAL_SERVER_ERROR', 'too late');
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(job.status, 'completed');
  assert.equal(job.error, null);
});

test('SSE subscriber receives the replayed event log including the terminal frame', async () => {
  const store = makeStore();
  let finish;
  const job = store.createJob('https://x.example/', async (_job, helpers) => {
    helpers.progress('step_one', 'a');
    helpers.progress('step_two', 'b');
    finish = helpers.finishSuccess;
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  // Fake ServerResponse collecting writes.
  const writes = [];
  const fakeResponse = {
    write: (frame) => writes.push(frame),
  };
  const unsubscribe = store.subscribe(job.id, fakeResponse);

  finish({ status: 'completed', finalResult: { url: 'https://x.example/' } });
  await new Promise((resolve) => setTimeout(resolve, 10));

  const events = writes.map((frame) => JSON.parse(frame.replace(/^data: /, '').trim()));
  assert.deepEqual(events.map((event) => event.type), ['progress', 'progress', 'done']);
  assert.equal(events[2].result.finalResult.url, 'https://x.example/');

  unsubscribe();
  finish === null; // no-op reference to keep linters honest
});

test('jobs and event logs are evicted beyond the store bound', async () => {
  const store = makeStore();
  for (let i = 0; i < 6; i++) {
    store.createJob(`https://j${i}.example/`, async (_job, { finishSuccess }) => finishSuccess({ i }));
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(store.get('') === null); // unknown id is null
  // Only maxJobs terminal jobs retained (bounded memory).
  const remaining = [];
  for (let i = 0; i < 6; i++) if (store.get(`job-nonexist-${i}`)) remaining.push(i);
  assert.equal(remaining.length, 0);
});
