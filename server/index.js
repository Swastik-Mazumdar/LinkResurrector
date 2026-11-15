/**
 * LinkResurrector engine — server entrypoint.
 *
 * Boots the dependency-free HTTP API with the full recovery pipeline:
 *   createSafeFetch -> healthChecker / wayback / search
 *                   -> evidenceExtractor / candidateVerifier
 *                   -> confidenceEngine -> recursive orchestrator
 *
 * Run: npm run backend   (default http://127.0.0.1:8787)
 */

import { config } from './src/config.js';
import { createLogger } from './src/logger.js';
import { createSafeFetch } from './src/security/ssrf.js';
import { createHealthChecker } from './src/core/healthChecker.js';
import { createWaybackClient } from './src/providers/wayback.js';
import { createSearchProvider } from './src/providers/search.js';
import { createEvidenceExtractor } from './src/core/evidenceExtractor.js';
import { createCandidateVerifier } from './src/core/candidateVerifier.js';
import { createConfidenceEngine } from './src/core/confidence.js';
import { createOrchestrator } from './src/core/orchestrator.js';
import { createJobStore } from './src/jobs/jobStore.js';
import { createApiServer } from './src/api/routes.js';

const logger = createLogger('server');
const loggerEngine = createLogger('engine');

/* ------------------------- dependency graph ------------------------- */

const safeFetch = createSafeFetch({
  timeoutMs: config.fetchTimeoutMs,
  maxBytes: config.maxResponseBytes,
  maxRedirects: config.maxRedirects,
});

const checkUrl = createHealthChecker({ fetcher: safeFetch, config, logger: createLogger('health') });
const wayback = createWaybackClient({ fetcher: safeFetch, config, logger: createLogger('wayback') });
const search = createSearchProvider({ fetcher: safeFetch, config });
const extractEvidence = createEvidenceExtractor({ logger: createLogger('evidence') });
const verifyCandidate = createCandidateVerifier({ checkUrl, logger: createLogger('verify') });
const score = createConfidenceEngine({ config, logger: createLogger('confidence') });

const investigate = createOrchestrator({
  checkUrl,
  wayback,
  search,
  extractEvidence,
  verifyCandidate,
  score,
  config,
  logger: loggerEngine,
  onProgress: () => {}, // replaced per-job by the job runner bridge
});

/**
 * Standalone verification for POST /api/verify (Phase 9):
 * independent accessibility + identity + relevance checks, no scoring gate.
 */
async function verifyUrl(url) {
  const health = await checkUrl(url);
  return {
    url,
    reachable: health.reachable,
    httpStatus: health.httpStatus,
    reason: health.reason,
    restricted: health.restricted,
    suspect: health.suspect,
    finalUrl: health.finalUrl,
    crossDomainRedirect: health.crossDomainRedirect,
    identity: health.identity
      ? {
          title: health.identity.title,
          description: health.identity.description,
          canonical: health.identity.canonical,
        }
      : null,
    redirectChain: health.redirectChain,
    elapsedMs: health.elapsedMs,
  };
}

/* ------------------------------ jobs -------------------------------- */

const jobStore = createJobStore({ config, logger: createLogger('jobs') });

/**
 * Bridges orchestrator progress events into the job's SSE stream and
 * finishes the job with the structured recovery result.
 */
function jobRunner(job, { progress, finishSuccess, finishError }) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      finishError('CONNECTION_TIMEOUT', `Recovery exceeded the ${config.timeBudgetMs}ms budget.`);
      resolve();
    }, config.timeBudgetMs + 5_000);

    investigate(job.url, {
      onProgress: (event) => progress(event.phase, event.detail),
    })
      .then((result) => {
        clearTimeout(timer);
        finishSuccess(result);
        resolve();
      })
      .catch((error) => {
        clearTimeout(timer);
        finishError(error?.code ?? 'INTERNAL_SERVER_ERROR', error?.message ?? 'Recovery failed.');
        resolve();
      });
  });
}

/* ------------------------------ boot -------------------------------- */

const server = createApiServer({ jobStore, jobRunner, verifyUrl, search, config, logger });

server.listen(config.port, config.host, () => {
  logger.info('LinkResurrector engine listening', {
    host: config.host,
    port: config.port,
    searchCoverage: search.coverage,
    maxDepth: config.maxDepth,
    timeBudgetMs: config.timeBudgetMs,
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('shutting down', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
