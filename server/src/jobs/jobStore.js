/**
 * In-memory job store + per-job event log + SSE subscribers (Phase 2 #11).
 *
 * Jobs are process-local (documented limitation: restarts lose history).
 * Terminal jobs are evicted after jobTtlMs; the store is bounded by maxJobs.
 *
 * Every event is appended to a bounded per-job log. SSE subscribers
 * (which connect AFTER the job started) get the full log replayed first,
 * so no progress frame is ever lost between POST and stream open.
 */

import { createLogger } from '../logger.js';

const MAX_EVENTS_PER_JOB = 500;

export function createJobStore({ config, logger = createLogger('jobs') } = {}) {
  const jobs = new Map(); // id -> job
  const subscribers = new Map(); // id -> Set<ServerResponse>
  const eventLog = new Map(); // id -> Array<{ type, ... }>

  function evictIfNeeded() {
    const now = Date.now();
    for (const [id, job] of jobs) {
      if (
        (job.status !== 'running' && job.status !== 'queued') &&
        job.completedAt &&
        now - job.completedAt > config.jobTtlMs
      ) {
        jobs.delete(id);
        subscribers.delete(id);
        eventLog.delete(id);
      }
    }
    while (jobs.size > config.maxJobs) {
      const oldest = [...jobs.entries()].sort((a, b) => a.createdAt - b.createdAt)[0];
      if (!oldest) break;
      jobs.delete(oldest[0]);
      subscribers.delete(oldest[0]);
      eventLog.delete(oldest[0]);
    }
  }

  function append(job, event) {
    const log = eventLog.get(job.id);
    if (log) {
      log.push(event);
      if (log.length > MAX_EVENTS_PER_JOB) log.shift();
    }
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    const set = subscribers.get(job.id);
    if (!set) return;
    const terminal = event.type === 'done' || event.type === 'error';
    for (const response of set) {
      try {
        response.write(frame);
        // Terminal frame: flush and close the SSE stream — clients must
        // never wait on a stream that has nothing left to say.
        if (terminal) response.end();
      } catch {
        set.delete(response);
      }
    }
    if (terminal) subscribers.set(job.id, new Set());
  }

  /**
   * Creates a job and immediately hands it to the runner.
   * The runner receives (job, helpers) and drives progress/completion.
   */
  function createJob(url, runner) {
    evictIfNeeded();
    const id =
      globalThis.crypto?.randomUUID?.() ??
      `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const job = {
      id,
      url,
      status: 'queued',
      phase: 'initializing',
      createdAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
    };
    jobs.set(id, job);
    eventLog.set(id, []);

    const progress = (phase, detail = '') => {
      job.phase = phase;
      if (job.status === 'queued') job.status = 'running';
      append(job, { type: 'progress', phase, detail });
    };

    const finishSuccess = (result) => {
      if (job.status === 'failed') return;
      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
      append(job, { type: 'done', job: publicJob(job), result });
    };

    const finishError = (code, message) => {
      if (job.status === 'completed') return;
      job.status = 'failed';
      job.error = { code, message };
      job.completedAt = Date.now();
      append(job, { type: 'error', error: { code, message } });
    };

    // Fire the runner without blocking the caller — GET/SSE endpoints read
    // the shared job object while it progresses.
    Promise.resolve()
      .then(() => runner(job, { progress, emit: progress, finishSuccess, finishError }))
      .catch((error) => {
        if (job.status !== 'queued' && job.status !== 'running') return;
        logger.error('job runner crashed', { jobId: id, error: String(error?.message ?? error) });
        finishError(
          error?.code ?? 'INTERNAL_SERVER_ERROR',
          error?.message ?? 'Unexpected engine failure.'
        );
      });

    return job;
  }

  function get(id) {
    return jobs.get(id) ?? null;
  }

  function publicJob(job) {
    return {
      id: job.id,
      url: job.url,
      status: job.status,
      phase: job.phase,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      error: job.error,
    };
  }

  /**
   * Subscribes an SSE response. Replays the buffered event log first
   * (progress frames + terminal frame when already finished).
   * Returns an unsubscribe function.
   */
  function subscribe(id, response) {
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    const set = subscribers.get(id);
    set.add(response);

    const write = (event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
    try {
      for (const event of eventLog.get(id) ?? []) write(event);
    } catch {
      set.delete(response);
    }

    return () => set.delete(response);
  }

  return { createJob, get, publicJob, subscribe };
}
