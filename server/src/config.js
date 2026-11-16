/** Central configuration — every value overridable via environment variables. */

import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

loadConfigFile();

function loadConfigFile() {
  if (process.env.LR_SKIP_CONFIG_FILE === '1') return;
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const home = homedir();
  const candidates = [
    process.env.LR_CONFIG_FILE,
    resolve(moduleDir, '../.env'),
    resolve(moduleDir, '../../.env'),
    join(home, 'Library', 'Application Support', 'LinkResurrector', '.env'),
    join(home, '.config', 'linkresurrector', '.env'),
    join(home, '.local', 'share', 'linkresurrector', '.env'),
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'LinkResurrector', '.env') : null,
  ].filter(Boolean);

  const envFile = candidates.find((path) => existsSync(path));
  if (!envFile) return;
  if (process.platform !== 'win32') {
    try { chmodSync(envFile, 0o600); } catch { /* keep working if permissions cannot be changed */ }
  }
  let contents;
  try { contents = readFileSync(envFile, 'utf8'); }
  catch { return; }

  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || match[1].startsWith('#') || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    process.env[match[1]] = value;
  }
}

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
  maxAlternativeBranches: num('LR_MAX_ALTERNATIVE_BRANCHES', 3),
  maxSnapshotsAnalyzed: num('LR_MAX_SNAPSHOTS_ANALYZED', 4),

  /* Per-request safety (Phase 12) */
  fetchTimeoutMs: num('LR_FETCH_TIMEOUT_MS', 12_000),
  maxResponseBytes: num('LR_MAX_RESPONSE_BYTES', 4 * 1024 * 1024),
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
  maxConcurrentJobs: num('LR_MAX_CONCURRENT_JOBS', 2),
  allowedOrigins: (process.env.LR_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

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

  /* Public web-mention sources (forums + open web) — official key-free APIs */
  mentions: {
    reddit:
      process.env.LR_REDDIT_ENDPOINT ||
      'https://www.reddit.com/search.json',
    hackerNews:
      process.env.LR_HN_ENDPOINT ||
      'https://hn.algolia.com/api/v1/search',
    duckDuckGo:
      process.env.LR_DDG_ENDPOINT ||
      'https://api.duckduckgo.com/',
  },
};
