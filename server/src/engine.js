/** Shared dependency graph used by the optional HTTP API and Native Messaging host. */
import { config } from './config.js';
import { createLogger } from './logger.js';
import { createSafeFetch } from './security/ssrf.js';
import { createHealthChecker } from './core/healthChecker.js';
import { createWaybackClient } from './providers/wayback.js';
import { createSearchProvider } from './providers/search.js';
import { createEvidenceExtractor } from './core/evidenceExtractor.js';
import { createCandidateVerifier } from './core/candidateVerifier.js';
import { createConfidenceEngine } from './core/confidence.js';
import { createOrchestrator } from './core/orchestrator.js';

export function createEngine({ onProgress = () => {} } = {}) {
  const logger = createLogger('engine');
  const safeFetch = createSafeFetch({ timeoutMs: config.fetchTimeoutMs, maxBytes: config.maxResponseBytes, maxRedirects: config.maxRedirects });
  const checkUrl = createHealthChecker({ fetcher: safeFetch, config, logger: createLogger('health') });
  const wayback = createWaybackClient({ fetcher: safeFetch, config, logger: createLogger('wayback') });
  const search = createSearchProvider({ fetcher: safeFetch, config });
  const extractEvidence = createEvidenceExtractor({ logger: createLogger('evidence') });
  const verifyCandidate = createCandidateVerifier({ checkUrl, logger: createLogger('verify') });
  const score = createConfidenceEngine({ config, logger: createLogger('confidence') });
  const investigate = createOrchestrator({ checkUrl, wayback, search, extractEvidence, verifyCandidate, score, config, logger, onProgress });
  return {
    coverage: search.coverage,
    search,
    async recover(url, options = {}) {
      return investigate(url, { ...options, onProgress: options.onProgress ?? onProgress });
    },
    async verify(url) {
      const health = await checkUrl(url);
      return { url, reachable: health.reachable, httpStatus: health.httpStatus, reason: health.reason, restricted: health.restricted, suspect: health.suspect, finalUrl: health.finalUrl, crossDomainRedirect: health.crossDomainRedirect, identity: health.identity ? { title: health.identity.title, description: health.identity.description, canonical: health.identity.canonical } : null, redirectChain: health.redirectChain, elapsedMs: health.elapsedMs };
    },
  };
}

export { config };
