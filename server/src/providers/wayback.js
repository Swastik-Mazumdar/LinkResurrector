/**
 * Internet Archive Wayback Machine integration (Phase 4).
 *
 * The archive is treated strictly as a historical EVIDENCE source, never as
 * the authority on what a URL resolves to today. Playback URLs surfaced to
 * users are always labeled as historical fallbacks.
 */

import { LrError, ERROR_CODES } from '../util/errors.js';
import { createTtlCache, createRateGate } from '../util/cache.js';

const CDX_FIELDS = 'timestamp,original,statuscode,mimetype,digest,length';

export function createWaybackClient({ fetcher, config, logger }) {
  const { wayback } = config;
  const cache = createTtlCache(config.cacheTtlMs, 200);
  const gate = createRateGate(wayback.minIntervalMs);

  /**
   * Queries the CDX API for successful HTML captures of a URL.
   * Collapses digest duplicates, filters junk, spreads selections across
   * history (earliest, spaced middle, latest) instead of blindly taking
   * the newest capture.
   *
   * @returns {Promise<{ available: boolean, snapshots: Array, reason?: string }>}
   */
  async function querySnapshots(url) {
    const cacheKey = `cdx:${url}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      url,
      output: 'json',
      fl: CDX_FIELDS,
      filter: '!statuscode:[45]..',
      collapse: 'digest',
      sort: 'reverse',
      limit: String(wayback.maxCdxRows),
    });

    let response;
    try {
      response = await gate(() =>
        fetcher(`${wayback.cdxEndpoint}?${params}`, {
          timeoutMs: config.fetchTimeoutMs,
          maxBytes: config.maxResponseBytes,
          headers: { accept: 'application/json' },
        })
      );
    } catch (err) {
      // CDX might time out or fail; attempt Wayback Availability API as resilient fallback
      response = null;
    }

    if (response && (response.status === 429 || response.status === 503)) {
      throw new LrError(ERROR_CODES.WAYBACK_UNAVAILABLE, 'Wayback Machine is rate limiting us.', {
        status: 502,
      });
    }

    let snapshots = [];
    if (response && response.status === 200) {
      try {
        snapshots = parseCdx(response.body);
      } catch (error) {
        throw new LrError(ERROR_CODES.WAYBACK_UNAVAILABLE, 'Wayback CDX returned malformed data.', {
          status: 502,
          cause: error,
        });
      }
    }

    // If CDX returned no snapshots or failed, query Wayback Availability API
    if (snapshots.length === 0) {
      try {
        const availUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
        const availRes = await gate(() =>
          fetcher(availUrl, {
            timeoutMs: Math.min(config.fetchTimeoutMs, 6000),
            maxBytes: 256 * 1024,
            headers: { accept: 'application/json' },
          })
        );
        if (availRes.status === 200 && availRes.body) {
          const availData = JSON.parse(availRes.body);
          const closest = availData?.archived_snapshots?.closest;
          if (closest && closest.available && closest.timestamp) {
            snapshots.push({
              timestamp: closest.timestamp,
              original: closest.url?.replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:[a-z_]+)?\//i, '') || url,
              statuscode: closest.status ?? '200',
              mimetype: 'text/html',
              digest: `avail_${closest.timestamp}`,
              length: '1000',
            });
          }
        }
      } catch {
        /* resilient fallback — proceed with empty if unavailable */
      }
    }

    const validCodes = new Set(['200', '301', '302', '307', '308', 'undefined', 'null']);
    const useful = snapshots.filter(
      (row) => row.statuscode == null || validCodes.has(String(row.statuscode))
    );
    const selected = selectSpreads(useful, config.maxSnapshotsAnalyzed * 3);
    const result = {
      available: selected.length > 0,
      snapshots: selected,
      ...(selected.length === 0 ? { reason: ERROR_CODES.NO_ARCHIVED_SNAPSHOTS } : {}),
    };
    cache.set(cacheKey, result);
    return result;
  }

  /** Fetches the raw (id_) archived content of a snapshot. */
  async function fetchSnapshotContent(snapshot) {
    const playbackFree = `${wayback.webEndpoint}${snapshot.timestamp}id_/${snapshot.original}`;
    return gate(() =>
      fetcher(playbackFree, {
        timeoutMs: config.fetchTimeoutMs,
        maxBytes: config.maxResponseBytes,
        headers: { accept: 'text/html' },
      })
    );
  }

  /** Historical playback URL for UI fallbacks (clearly labeled as archived). */
  function playbackUrl(snapshot) {
    if (!snapshot) return null;
    return `${wayback.webEndpoint}${snapshot.timestamp}/${snapshot.original}`;
  }

  return { querySnapshots, fetchSnapshotContent, playbackUrl };
}

/** Parses CDX JSON (array-of-arrays) with a tolerant fallback to text rows. */
function parseCdx(bodyText) {
  const text = String(bodyText ?? '').trim();
  if (!text || text === '[]') return [];

  const data = JSON.parse(text);
  if (!Array.isArray(data) || data.length < 2) return [];
  const header = data[0].map((field) => String(field).toLowerCase());
  return data.slice(1).map((row) => {
    const entry = {};
    header.forEach((field, index) => {
      entry[field] = row[index];
    });
    return entry;
  });
}

/** Earliest + evenly spaced middle + latest, digest-deduped. */
function selectSpreads(rows, max) {
  if (rows.length <= max) return rows;
  const ordered = [...rows].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  const seen = new Set();
  const picked = [];
  const indices = new Set();
  indices.add(0);
  indices.add(ordered.length - 1);
  if (ordered.length > 2) indices.add(ordered.length - 2);
  if (ordered.length > 3) indices.add(ordered.length - 3);
  const middleSlots = Math.max(0, max - 2);
  for (let slot = 1; slot <= middleSlots; slot += 1) {
    indices.add(Math.round((slot * (ordered.length - 1)) / (middleSlots + 1)));
  }
  for (const index of [...indices].sort((a, b) => a - b)) {
    const row = ordered[index];
    if (!row || seen.has(row.digest)) continue;
    seen.add(row.digest);
    picked.push(row);
    if (picked.length >= max) break;
  }
  return picked;
}
