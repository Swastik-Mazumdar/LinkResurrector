/** Central configuration — every value overridable via environment variables. */

const num = (value, fallback) => {
  const parsed = Number.parseInt(process.env[value] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: num('PORT', 8787),
  host: process.env.HOST || '127.0.0.1',

  /* Recursion + resource budgets (Phases 11) */
  maxDepth: num('LR_MAX_DEPTH', 4),
  timeBudgetMs: num('LR_TIME_BUDGET_MS', 90_000),
  maxCandidatesPerGeneration: num('LR_MAX_CANDIDATES', 6),
  maxSnapshotsAnalyzed: num('LR_MAX_SNAPSHOTS_ANALYZED', 4),

  /* Per-request safety (Phase 12) */
  fetchTimeoutMs: num('LR_FETCH_TIMEOUT_MS', 12_000),
  maxResponseBytes: num('LR_MAX_RESPONSE_BYTES', 512 * 1024),
  maxRedirects: num('LR_MAX_REDIRECTS', 8),

  /* Confidence thresholds (Phase 10) */
  minConfidenceToRecurse: 60,
  minConfidenceVerified: 80,

  /* Caching (Phase 16) */
  cacheTtlMs: num('LR_CACHE_TTL_MS', 10 * 60_000),
  jobTtlMs: num('LR_JOB_TTL_MS', 60 * 60_000),
  maxJobs: num('LR_MAX_JOBS', 200),

  /* API abuse controls (Phase 12) */
  rateLimitWindowMs: num('LR_RATE_WINDOW_MS', 60_000),
  rateLimitMax: num('LR_RATE_MAX', 20),
  maxBodyBytes: num('LR_MAX_BODY_BYTES', 16 * 1024),

  /* Internet Archive (Phase 4) */
  wayback: {
    cdxEndpoint:
      process.env.LR_CDX_ENDPOINT || 'https://web.archive.org/cdx/search/cdx',
    webEndpoint: process.env.LR_WAYBACK_WEB || 'https://web.archive.org/web/',
    minIntervalMs: num('LR_WAYBACK_INTERVAL_MS', 1_500),
    maxCdxRows: num('LR_CDX_MAX_ROWS', 40),
  },

  /* Search providers (Phase 7) — credentials via env, never in code */
  providers: {
    bing: {
      name: 'bing',
      apiKey: process.env.BING_API_KEY || '',
      endpoint:
        process.env.BING_ENDPOINT || 'https://api.bing.microsoft.com/v7.0/search',
    },
    googleCse: {
      name: 'google-cse',
      apiKey: process.env.GOOGLE_API_KEY || '',
      cseId: process.env.GOOGLE_CSE_ID || '',
      endpoint: 'https://www.googleapis.com/customsearch/v1',
    },
  },
};
