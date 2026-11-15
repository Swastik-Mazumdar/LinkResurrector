/**
 * Dependency-free HTTP API layer (Phase 13).
 *
 *   POST /api/resurrect             { url } -> { jobId }
 *   GET  /api/resurrect/:jobId      -> job snapshot (+ result when done)
 *   GET  /api/resurrect/:jobId/events -> SSE live progress
 *   POST /api/verify                { url } -> independent verification
 *   GET  /api/health                -> engine health + provider coverage
 *
 * Cross-cutting: CORS for extension origins, per-IP rate limiting,
 * strict JSON-body cap, structured error envelope { error: { code, message } }.
 */

import http from 'node:http';
import { LrError, ERROR_CODES } from '../util/errors.js';
import { parseAndValidateUrl } from '../util/url.js';

export function createApiServer(deps) {
  const { jobStore, verifyUrl, search, config, logger } = deps;

  const rateBuckets = new Map(); // ip -> { count, windowStart }

  return http.createServer((request, response) => {
    const started = Date.now();
    const ip = clientIpOf(request);
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    setCorsHeaders(response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && path === '/api/health') {
      return sendJson(response, 200, {
        ok: true,
        service: 'linkresurrector-engine',
        version: '1.0.0-alpha',
        uptimeSeconds: Math.round(process.uptime()),
        providers: {
          search: {
            configured: search.coverage === 'full',
            coverage: search.coverage,
            providers: search.configuredProviders,
          },
          wayback: {
            endpoint: config.wayback.cdxEndpoint,
          },
        },
        limits: {
          maxDepth: config.maxDepth,
          timeBudgetMs: config.timeBudgetMs,
          maxCandidatesPerGeneration: config.maxCandidatesPerGeneration,
        },
      });
    }

    if (path.startsWith('/api/')) {
      if (!checkRateLimit(ip)) {
        return sendError(response, new LrError(ERROR_CODES.RATE_LIMITED, 'Too many requests — slow down.', { status: 429 }));
      }

      // POST /api/resurrect
      if (request.method === 'POST' && path === '/api/resurrect') {
        return readJsonBody(request, response, (body) => {
          const rawUrl = body?.url;
          if (typeof rawUrl !== 'string') {
            return sendError(response, new LrError(ERROR_CODES.BAD_REQUEST, 'Body must be JSON: { "url": "..." }', { status: 400 }));
          }
          let normalized;
          try {
            normalized = parseAndValidateUrl(rawUrl);
          } catch (error) {
            return sendError(response, error instanceof LrError ? error : new LrError(ERROR_CODES.INVALID_URL, 'Invalid URL.', { status: 400 }));
          }
          const job = jobStore.createJob(normalized.href, deps.jobRunner);
          logger.info('resurrect job started', { jobId: job.id, url: normalized.href });
          return sendJson(response, 202, { jobId: job.id, status: job.status });
        });
      }

      // GET /api/resurrect/:jobId
      const jobMatch = path.match(/^\/api\/resurrect\/([A-Za-z0-9_-]+)$/);
      if (request.method === 'GET' && jobMatch) {
        const job = jobStore.get(jobMatch[1]);
        if (!job) {
          return sendError(response, new LrError(ERROR_CODES.JOB_NOT_FOUND, 'Unknown job id.', { status: 404 }));
        }
        const snapshot = jobStore.publicJob(job);
        if (job.result) snapshot.result = job.result;
        return sendJson(response, 200, snapshot);
      }

      // GET /api/resurrect/:jobId/events (SSE)
      const eventsMatch = path.match(/^\/api\/resurrect\/([A-Za-z0-9_-]+)\/events$/);
      if (request.method === 'GET' && eventsMatch) {
        const job = jobStore.get(eventsMatch[1]);
        if (!job) {
          return sendError(response, new LrError(ERROR_CODES.JOB_NOT_FOUND, 'Unknown job id.', { status: 404 }));
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        response.write(': connected\n\n');
        const unsubscribe = jobStore.subscribe(job.id, response);
        const keepAlive = setInterval(() => {
          try {
            response.write(': keepalive\n\n');
          } catch {
            /* cleaned up below */
          }
        }, 15000);
        request.on('close', () => {
          clearInterval(keepAlive);
          unsubscribe();
        });
        return;
      }

      // POST /api/verify
      if (request.method === 'POST' && path === '/api/verify') {
        return readJsonBody(request, response, async (body) => {
          try {
            if (typeof body?.url !== 'string') {
              throw new LrError(ERROR_CODES.BAD_REQUEST, 'Body must be JSON: { "url": "..." }', { status: 400 });
            }
            const normalized = parseAndValidateUrl(body.url);
            const verification = await verifyUrl(normalized.href);
            sendJson(response, 200, verification);
          } catch (error) {
            sendError(response, error instanceof LrError ? error : new LrError(ERROR_CODES.INTERNAL_SERVER_ERROR, 'Verification failed.'));
          }
        });
      }

      return sendError(response, new LrError(ERROR_CODES.BAD_REQUEST, `No route for ${request.method} ${path}`, { status: 404 }));
    }

    return sendError(response, new LrError(ERROR_CODES.BAD_REQUEST, 'Not found.', { status: 404 }));

    /* ---------------------------------------------------------------- */

    function setCorsHeaders(res) {
      res.setHeader('access-control-Allow-Origin', '*');
      res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-max-age', '86400');
    }

    function checkRateLimit(ipAddress) {
      const now = Date.now();
      let bucket = rateBuckets.get(ipAddress);
      if (!bucket || now - bucket.windowStart > config.rateLimitWindowMs) {
        bucket = { count: 0, windowStart: now };
        rateBuckets.set(ipAddress, bucket);
      }
      bucket.count += 1;
      if (rateBuckets.size > 5000) rateBuckets.clear();
      return bucket.count <= config.rateLimitMax;
    }
  });

  function readJsonBody(request, response, handler) {
    const chunks = [];
    let total = 0;
    let aborted = false;

    request.on('data', (chunk) => {
      if (aborted) return;
      total += chunk.length;
      if (total > config.maxBodyBytes) {
        aborted = true;
        sendError(response, new LrError(ERROR_CODES.BAD_REQUEST, 'Request body too large.', { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });

    request.on('end', () => {
      if (aborted) return;
      let body = {};
      const text = Buffer.concat(chunks).toString('utf8');
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          return sendError(response, new LrError(ERROR_CODES.BAD_REQUEST, 'Body is not valid JSON.', { status: 400 }));
        }
      }
      Promise.resolve(handler(body)).catch((error) => {
        sendError(
          response,
          error instanceof LrError
            ? error
            : new LrError(ERROR_CODES.INTERNAL_SERVER_ERROR, 'Unexpected server error.', { cause: error })
        );
      });
    });

    request.on('error', () => {
      aborted = true;
    });
  }
}

function sendJson(response, status, payload) {
  if (response.writableEnded || response.headersSent) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function sendError(response, error) {
  const status = error.status ?? 500;
  const payload = {
    error:
      error instanceof LrError
        ? { code: error.code, message: error.message, details: error.details ?? null }
        : { code: ERROR_CODES.INTERNAL_SERVER_ERROR, message: 'Unexpected server error.' },
  };
  if (!(error instanceof LrError)) {
    // Unexpected errors are logged; structured validation errors are not noise.
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', component: 'api', message: payload.error.message, stack: error?.stack }));
  }
  sendJson(response, status, payload);
}

function clientIpOf(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress ?? 'unknown';
}
