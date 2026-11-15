/**
 * Recursive multi-generation migration orchestrator (Phase 6 — the core).
 *
 * THE defining behavior: every discovered successor becomes a NEW
 * investigation target. The engine keeps following generation after
 * generation (A→B→C→D…) until no newer legitimate successor can be
 * established or a configured budget (depth / time / candidates) is hit.
 *
 * Per generation:
 *   1. health-check the current URL (live redirect = direct migration)
 *   2. retrieve Wayback snapshots (historical evidence)
 *   3. extract migration evidence from archived HTML
 *   4. discover candidates (redirect target + announcements + canonical +
 *      meta-refresh + external references + search when configured)
 *   5. verify candidates independently, score confidence
 *   6. recurse into the best accepted successor
 *
 * Never hardcodes domains; works on arbitrary submitted URLs. Allowed to
 * return "no verified successor" honestly.
 */

import { LrError, ERROR_CODES } from '../util/errors.js';
import { hostOf, registrableDomain } from '../util/url.js';
import { extractIdentity } from '../util/html.js';

export function createOrchestrator(deps) {
  const {
    checkUrl,
    wayback,
    search,
    extractEvidence,
    verifyCandidate,
    score,
    config,
    logger,
    onProgress = () => {},
  } = deps;

  return async function investigate(originalUrlInput, options = {}) {
    const startedAt = Date.now();
    const warnings = [];
    const globalEvidence = [];
    const candidatesLedger = [];
    const migrationChain = [];
    const visitedDomains = new Set();
    const visitedUrls = new Set();

    // Per-investigation progress channel (overrides the captured default).
    const emitBase = options.onProgress ?? onProgress ?? (() => {});
    const emit = (phase, detail = '') => {
      try {
        emitBase({ phase, detail, ts: Date.now() });
      } catch {
        /* progress reporting must never break recovery */
      }
    };

    const originalUrl = String(originalUrlInput);
    let originalIdentity = null;
    let waybackSummary = { available: false, snapshotCount: 0, latestSnapshot: null, latestTimestamp: null, fallbackUrl: null };
    let limitReached = false;
    let bestPartial = null; // { url, score, verification, evidence } strongest unverified candidate

    emit('initializing', originalUrl);

    let generation = 0;
    let currentUrl = originalUrl;
    let currentRegistrable = registrableDomain(hostOf(currentUrl));

    while (true) {
      if (Date.now() - startedAt > config.timeBudgetMs) {
        limitReached = true;
        warnings.push('Investigation stopped early: total time budget exhausted.');
        emit('time_budget_exhausted', `generation ${generation}`);
        break;
      }
      if (generation > config.maxDepth) {
        limitReached = true;
        warnings.push(`Discovery stopped at maximum depth (${config.maxDepth} generations beyond the original).`);
        emit('depth_limit_reached', `generation ${generation}`);
        break;
      }

      emit('checking_original', generation === 0 ? currentUrl : `generation ${generation}: ${currentUrl}`);
      const health = await checkUrl(currentUrl);

      if (generation === 0 && !health.suspect) {
        originalIdentity = health.identity;
      }

      // For generation > 0 the selection step already added this URL to the
      // chain — update that entry with the freshly observed status instead
      // of pushing a duplicate.
      if (generation === 0) {
        migrationChain.push({
          url: currentUrl,
          generation,
          status: classifyGeneration(health, generation),
          httpStatus: health.httpStatus,
          reason: health.reason,
        });
      } else {
        const existing = migrationChain.find(
          (node) => node.generation === generation && node.url === currentUrl
        );
        if (existing) {
          existing.status = classifyGeneration(health, generation);
          existing.httpStatus = health.httpStatus;
          existing.reason = health.reason;
        } else {
          migrationChain.push({
            url: currentUrl,
            generation,
            status: classifyGeneration(health, generation),
            httpStatus: health.httpStatus,
            reason: health.reason,
          });
        }
      }
      // Every generation we investigate is loop-protected from here on.
      visitedDomains.add(registrableDomain(hostOf(currentUrl)));

      // Case A: the current URL is LIVE and did not send us off-domain.
      // HTTP 200 error pages and parked domains are NOT treated as live.
      if (
        health.reachable &&
        !health.crossDomainRedirect &&
        health.restricted !== true &&
        !health.suspect
      ) {
        if (generation === 0) {
          // Still alive at the exact URL — nothing to resurrect.
          return finish('completed', null, [], [
            'Original URL is still live — no resurrection was needed.',
          ]);
        }
        // A successor generation is live and stayed on-domain.
        const incoming = bestPartial && bestPartial.url === currentUrl;
        const incomingVerified = Boolean(
          incoming && bestPartial.score >= config.minConfidenceVerified
        );
        return finish(
          incomingVerified ? 'completed' : 'partial',
          {
            url: currentUrl,
            verified: incomingVerified,
            confidenceScore: incoming ? bestPartial.score : 0,
            pageRecovered: false,
            recoveredPageUrl: null,
            breakdown: incoming ? bestPartial.evidence : [],
          },
          globalEvidence,
          incomingVerified
            ? warnings
            : [
                ...warnings,
                'A live destination was reached, but the migration into it scored below the verified-confidence threshold.',
              ],
          { waybackFallbackOnly: false }
        );
      }

      // Case: reachable but restricted (403/429) — not dead, but opaque.
      if (health.restricted) {
        warnings.push(
          `Current URL responded ${health.httpStatus} (bot-restricted). Treating as alive-but-opaque; continuing with historical evidence.`
        );
      }

      // ---- Historical evidence for this generation -----------------------
      // An error-page/parked identity is noise — never seed comparisons with it.
      let identityForNext = health.suspect ? null : (health.identity ?? originalIdentity);
      let snapshotsInfo = { available: false, snapshots: [] };

      if (!visitedUrls.has(`wayback:${currentUrl}`)) {
        visitedUrls.add(`wayback:${currentUrl}`);
        emit('retrieving_snapshots', currentUrl);
        try {
          const result = await wayback.querySnapshots(currentUrl);
          snapshotsInfo = { available: result.available, snapshots: result.snapshots ?? [] };
          if (generation === 0) {
            waybackSummary = summarizeWayback(result, wayback);
          }
        } catch (error) {
          if (error.code === ERROR_CODES.WAYBACK_UNAVAILABLE) {
            warnings.push('Wayback Machine was unavailable or rate limited; historical evidence is incomplete.');
          } else {
            warnings.push(`Snapshot retrieval failed: ${error.message}`);
          }
        }
      }

      const evidenceForCurrent = [];
      const candidates = new Map(); // url -> { candidate items merged }

      // 1. Live cross-domain redirect = strongest direct evidence (Case A).
      if (health.crossDomainRedirect) {
        evidenceForCurrent.push({
          type: 'verified_redirect',
          detail: `live redirect chain reached ${hostOf(health.crossDomainRedirect)}`,
        });
        addCandidate(candidates, {
          url: health.crossDomainRedirect,
          source: 'verified_redirect',
          context: 'live HTTP redirect',
        });
        identityForNext = identityForNext ?? originalIdentity;
      }

      // 2. Archived HTML evidence.
      const archivedHtmlTargets = pickSnapshotTargets(snapshotsInfo.snapshots);
      for (const snapshot of archivedHtmlTargets) {
        if (Date.now() - startedAt > config.timeBudgetMs) {
          limitReached = true;
          warnings.push('Investigation stopped early while analyzing archived pages (time budget).');
          break;
        }
        emit('analyzing_history', `${snapshot.timestamp} / ${snapshot.original}`);
        let archived;
        try {
          archived = await wayback.fetchSnapshotContent(snapshot);
        } catch (error) {
          logger?.debug?.('snapshot fetch failed', { url: snapshot.original, code: error.code ?? error.message });
          continue;
        }
        if (!archived?.body) continue;

        const extracted = extractEvidence(archived.body, normalizeArchivedUrl(snapshot.original), {});
        if (generation === 0 && !originalIdentity && extracted.identity?.title) {
          originalIdentity = extracted.identity;
          identityForNext = originalIdentity;
        }

        for (const candidate of extracted.candidates) {
          const evidenceType = sourceToEvidenceType(candidate.source);
          evidenceForCurrent.push({ type: evidenceType, detail: `found in ${snapshot.timestamp} snapshot` });
          addCandidate(candidates, candidate);
        }
      }

      // 3. Search-based discovery (Phase 7) — only when a provider is configured.
      //    When neither the live page nor the archive produced an identity,
      //    a user-supplied title hint (e.g. the vault link's title) is used.
      if (identityForNext == null && options.titleHint) {
        identityForNext = { title: String(options.titleHint), description: '' };
        originalIdentity = originalIdentity ?? identityForNext;
      }
      if (search.coverage === 'full' && identityForNext?.title) {
        emit('extracting_evidence', 'querying search providers');
        for (const query of search.buildQueries(identityForNext)) {
          try {
            const searchResult = await search.search(query);
            for (const item of searchResult.results ?? []) {
              if (!search.isPromisingResultHost(item)) continue;
              if (registrableDomain(hostOf(item.url)) === currentRegistrable) continue;
              addCandidate(candidates, {
                url: item.url,
                source: 'search_result',
                context: `search (${searchResult.provider}): "${query}"`,
              });
              evidenceForCurrent.push({
                type: 'search_result',
                detail: `search hit for "${query}"`,
              });
            }
          } catch (error) {
            warnings.push(`Search provider error: ${error.message}`);
          }
        }
      } else if (search.coverage === 'reduced' && generation === 0) {
        warnings.push('No search-provider credentials configured — discovery coverage is reduced (Wayback + redirects only).');
      }

      // Record evidence (de-duplicated by type+detail for this generation).
      const seenEvidence = new Set();
      for (const item of evidenceForCurrent) {
        const key = `${item.type}|${item.detail}`;
        if (seenEvidence.has(key)) continue;
        seenEvidence.add(key);
        globalEvidence.push({ generation, ...item });
      }

      // ---- Candidate verification + selection ----------------------------
      emit('discovering_successors', `${candidates.size} candidate(s) for generation ${generation}`);
      if (candidates.size === 0) break;

      const verified = [];
      for (const candidate of [...candidates.values()].slice(0, config.maxCandidatesPerGeneration)) {
        if (Date.now() - startedAt > config.timeBudgetMs) {
          limitReached = true;
          warnings.push('Candidate verification stopped early (time budget).');
          break;
        }
        emit('verifying_candidates', candidate.url);

        const candidateHost = registrableDomain(hostOf(candidate.url));
        if (visitedDomains.has(candidateHost)) {
          candidatesLedger.push({ url: candidate.url, status: 'rejected', reason: 'domain already investigated (loop protection)' });
          continue;
        }

        const verification = await verifyCandidate(candidate, {
          identity: identityForNext ?? originalIdentity,
          originalUrl: currentUrl,
        });

        const scoring = score(
          [
            ...evidenceForCurrent,
            { type: 'title_similarity', similarity: verification.similarities.title },
            { type: 'content_similarity', similarity: verification.similarities.content },
          ],
          verification
        );

        globalEvidence.push({
          generation,
          type: 'verification',
          detail: `${candidate.url}: score ${scoring.score}, ${scoring.accepted ? 'accepted' : 'not accepted'}`,
        });

        candidatesLedger.push({
          url: candidate.url,
          status: scoring.accepted
            ? 'verified'
            : scoring.score >= config.minConfidenceToRecurse
              ? 'plausible'
              : 'rejected',
          score: scoring.score,
          reason:
            verification.contradictionReason ??
            (scoring.accepted ? 'evidence accepted' : 'insufficient or contradictory evidence'),
        });

        if (!verification.accessible || verification.contradicted) continue;
        if (scoring.score < config.minConfidenceToRecurse) continue;

        verified.push({
          candidate,
          verification,
          scoring,
        });
      }

      if (verified.length === 0) break;

      verified.sort((a, b) => b.scoring.score - a.scoring.score);
      const best = verified[0];

      if (verified.length > 1 && verified[0].scoring.score - verified[1].scoring.score < 10) {
        warnings.push('Multiple plausible successors found; selecting the highest-evidence candidate.');
      }

      bestPartial = {
        url: best.candidate.url,
        score: best.scoring.score,
        verification: best.verification,
        evidence: best.scoring.breakdown,
      };
      visitedDomains.add(registrableDomain(hostOf(best.candidate.url)));
      visitedUrls.add(best.candidate.url);

      const chainStatus =
        best.scoring.accepted && best.scoring.score >= config.minConfidenceVerified
          ? 'verified_successor'
          : 'historical_candidate';
      migrationChain.push({
        url: best.candidate.url,
        generation: generation + 1,
        status: chainStatus,
        confidenceScore: best.scoring.score,
        evidence: best.scoring.breakdown.map((item) => `${item.type}: ${item.detail}`),
      });

      emit('investigating_generation', `${generation + 1}: ${best.candidate.url}`);
      currentUrl = best.candidate.url;
      currentRegistrable = registrableDomain(hostOf(currentUrl));
      generation += 1;
    }

    // ---- No live successor chain completed -------------------------------
    if (bestPartial && bestPartial.score >= config.minConfidenceToRecurse) {
      const status = bestPartial.score >= config.minConfidenceVerified ? 'partial' : 'no_successor';
      if (limitReached) warnings.push('Best result returned; further investigation was limited by configured budgets.');
      return finish(
        status,
        {
          url: bestPartial.url,
          verified: false,
          confidenceScore: bestPartial.score,
          pageRecovered: false,
          recoveredPageUrl: null,
          breakdown: bestPartial.evidence,
        },
        globalEvidence,
        warnings
      );
    }

    return finish('no_successor', null, globalEvidence, [
      ...warnings,
      'No successor could be established with sufficient evidence. See the historical fallback snapshot instead of an invented URL.',
    ]);

    /* ---------------------------------------------------------------- */

    function finish(status, finalResult, evidence, finalWarnings, extra = {}) {
      const statusCode = Date.now() - startedAt > config.timeBudgetMs && status === 'completed'
        ? 'partial'
        : status;
      emitBase({
        phase: statusCode === 'completed' ? 'completed' : statusCode,
        detail: finalResult?.url ?? 'no verified successor',
        ts: Date.now(),
      });
      return {
        status: statusCode,
        originalUrl,
        originalStatus: pickOriginalStatus(migrationChain.at(0)),
        wayback: { ...waybackSummary, fallbackUrl: waybackSummary.latestSnapshot },
        migrationChain,
        finalResult: finalResult
          ? { ...finalResult, verifiedAt: Date.now() }
          : null,
        candidates: candidatesLedger,
        evidence,
        warnings: finalWarnings,
        completedAt: Date.now(),
        ...extra,
      };
    }

    function classifyGeneration(health, gen) {
      if (!health.reachable) return 'dead';
      if (health.crossDomainRedirect) return 'redirected';
      if (gen === 0) return 'alive';
      return 'alive';
    }

    function pickOriginalStatus(chainEntry) {
      if (!chainEntry) return { reachable: false, httpStatus: null, reason: 'UNKNOWN' };
      return {
        reachable: chainEntry.status === 'alive' || chainEntry.status === 'redirected',
        httpStatus: chainEntry.httpStatus ?? null,
        reason: chainEntry.reason ?? null,
      };
    }

    function summarizeWayback(result, waybackClient) {
      const snapshots = result.snapshots ?? [];
      const latest = snapshots.at(-1) ?? null;
      return {
        available: result.available,
        snapshotCount: snapshots.length,
        latestSnapshot: latest ? waybackClient.playbackUrl(latest) : null,
        latestTimestamp: latest?.timestamp ?? null,
      };
    }
  };
}

/** Live redirect → announcement → canonical/meta refresh → external/search. */
function sourceToEvidenceType(source) {
  switch (source) {
    case 'verified_redirect':
      return 'verified_redirect';
    case 'official_migration_announcement':
      return 'official_migration_announcement';
    case 'canonical_url':
      return 'canonical_url';
    case 'meta_refresh':
      return 'meta_refresh';
    case 'search_result':
      return 'search_result';
    default:
      return 'external_reference';
  }
}

function addCandidate(map, candidate) {
  const key = registrableDomain(hostOf(candidate.url));
  const existing = map.get(key);
  if (!existing) {
    map.set(key, candidate);
    return;
  }
  // Prefer the strongest source for an already-known registrable domain.
  const priority = ['verified_redirect', 'official_migration_announcement', 'canonical_url', 'meta_refresh', 'search_result', 'external_reference'];
  if (priority.indexOf(candidate.source) < priority.indexOf(existing.source)) {
    map.set(key, { ...existing, ...candidate });
  }
}

/** Latest two + earliest one snapshot are the most migration-relevant. */
function pickSnapshotTargets(snapshots) {
  if (!snapshots?.length) return [];
  if (snapshots.length <= 3) return snapshots;
  const latestTwo = snapshots.slice(-2);
  const earliest = snapshots[0];
  const unique = [earliest, ...latestTwo].filter(
    (snapshot, index, list) => list.findIndex((s) => s.timestamp === snapshot.timestamp) === index
  );
  return unique;
}

/** Archived CDX originals are raw historical URLs — validate + normalize. */
function normalizeArchivedUrl(original) {
  try {
    return new URL(original).href;
  } catch {
    return original;
  }
}
