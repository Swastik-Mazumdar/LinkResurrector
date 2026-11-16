/**
 * Recursive multi-generation migration orchestrator (Phase 6 — the core).
 *
 * THE defining behavior: every discovered successor becomes a NEW
 * investigation target. The engine keeps following generation after
 * generation (A→B→C→D…) until no newer legitimate successor can be
 * established or a configured budget (depth / time / candidates) is hit.
 */

import { LrError, ERROR_CODES } from '../util/errors.js';
import { hostOf, registrableDomain } from '../util/url.js';

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

  async function investigateLinear(originalUrlInput, options = {}) {
    const startedAt = options._startedAt ?? Date.now();
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
        if (incomingVerified) {
          const terminalEntry = migrationChain.find(
            (node) => node.generation === generation && node.url === currentUrl
          );
          if (terminalEntry) terminalEntry.status = 'verified_successor';
        }
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
      if (search.coverage === 'full') {
        const searchIdentity = identityForNext ?? { title: '', description: '' };
        const queries = search.buildQueries(searchIdentity);
        if (queries.length > 0) {
          emit('extracting_evidence', 'querying search providers');
          for (const query of queries) {
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
      const historicalHops = []; // strong structural evidence but currently unreachable
      for (const candidate of [...candidates.values()].slice(0, config.maxCandidatesPerGeneration)) {
        if (Date.now() - startedAt > config.timeBudgetMs) {
          limitReached = true;
          warnings.push('Candidate verification stopped early (time budget).');
          break;
        }
        emit('verifying_candidates', candidate.url);

        const candidateHost = registrableDomain(hostOf(candidate.url));
        if (visitedDomains.has(candidateHost)) {
          candidatesLedger.push({ url: candidate.url, generation, source: candidate.source, status: 'rejected', reason: 'domain already investigated (loop protection)' });
          continue;
        }

        const verification = await verifyCandidate(candidate, {
          identity: identityForNext ?? originalIdentity,
          originalUrl: currentUrl,
        });

        const scoring = score(
          [
            ...evidenceForCurrent.filter((e) => !e.detail || e.detail.includes(hostOf(candidate.url)) || ['verified_redirect','official_migration_announcement','canonical_url','meta_refresh','search_result','external_reference'].includes(e.type)),
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

        const isStructural = ['verified_redirect', 'official_migration_announcement', 'canonical_url', 'meta_refresh'].includes(candidate.source);
        const unreachable = !verification.accessible;

        candidatesLedger.push({
          url: candidate.url,
          generation,
          source: candidate.source,
          status: scoring.accepted
            ? 'verified'
            : scoring.score >= config.minConfidenceToRecurse
              ? 'plausible'
              : (isStructural && unreachable ? 'historical_hop' : 'rejected'),
          score: scoring.score,
          evidence: scoring.breakdown,
          titleHint: verification.identity?.title ?? options.titleHint ?? null,
          reason:
            verification.contradictionReason ??
            (scoring.accepted ? 'evidence accepted' : (isStructural && unreachable ? 'structural evidence names this host; currently unreachable but worth investigating historically' : 'insufficient or contradictory evidence')),
        });

        if (!unreachable && !verification.contradicted && scoring.score >= config.minConfidenceToRecurse) {
          verified.push({ candidate, verification, scoring });
        } else if (unreachable && isStructural) {
          // The predecessor explicitly named this host as its successor.
          // Even if it's dead now, its own archive may reveal the next hop.
          historicalHops.push({ candidate, verification, scoring });
        }
      }

      let chosen = null;
      let chosenIsHistorical = false;

      if (verified.length > 0) {
        verified.sort((a, b) => b.scoring.score - a.scoring.score);
        chosen = verified[0];
        if (verified.length > 1 && verified[0].scoring.score - verified[1].scoring.score < 10) {
          warnings.push('Multiple plausible successors found; selecting the highest-evidence candidate.');
        }
      } else if (historicalHops.length > 0) {
        // Follow the explicitly-named but currently-dead successor so we can
        // mine its historical snapshots for further migrations (Phase 6).
        const priority = ['verified_redirect', 'official_migration_announcement', 'canonical_url', 'meta_refresh'];
        historicalHops.sort((a, b) => priority.indexOf(a.candidate.source) - priority.indexOf(b.candidate.source));
        chosen = historicalHops[0];
        chosenIsHistorical = true;
      }

      if (!chosen) break;

      bestPartial = {
        url: chosen.candidate.url,
        score: chosen.scoring.score,
        verification: chosen.verification,
        evidence: chosen.scoring.breakdown,
      };
      visitedDomains.add(registrableDomain(hostOf(chosen.candidate.url)));
      visitedUrls.add(chosen.candidate.url);

      const chainStatus = chosenIsHistorical
        ? 'historical_candidate'
        : (chosen.scoring.accepted && chosen.scoring.score >= config.minConfidenceVerified
            ? 'verified_successor'
            : 'historical_candidate');
      migrationChain.push({
        url: chosen.candidate.url,
        generation: generation + 1,
        status: chainStatus,
        confidenceScore: chosen.scoring.score,
        evidence: chosen.scoring.breakdown.map((item) => `${item.type}: ${item.detail}`),
      });

      emit('investigating_generation', `${generation + 1}: ${chosen.candidate.url}`);
      currentUrl = chosen.candidate.url;
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

  /**
   * The linear pass follows the best-evidence candidate at each generation.
   * Then bounded alternative branches are investigated too, so a strong but
   * dead/stale first choice cannot hide a newer legitimate successor.
   */
  return async function investigate(originalUrl, options = {}) {
    const startedAt = Date.now();
    const primary = await investigateLinear(originalUrl, { ...options, _startedAt: startedAt });
    if (primary.status === 'completed' && primary.originalStatus?.reachable && !primary.finalResult) return primary;

    const chainUrls = new Set(primary.migrationChain.map((node) => node.url));
    const alternatives = (primary.candidates ?? [])
      .filter((candidate) =>
        !chainUrls.has(candidate.url) &&
        (candidate.status === 'verified' || candidate.status === 'plausible' || candidate.status === 'historical_hop') &&
        (candidate.score >= config.minConfidenceToRecurse || candidate.status === 'historical_hop')
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.generation - b.generation);

    const explored = new Set();
    let best = primary;
    let branchesRun = 0;
    for (const candidate of alternatives) {
      if (branchesRun >= (config.maxAlternativeBranches ?? 3)) break;
      if (Date.now() - startedAt >= config.timeBudgetMs) {
        best = { ...best, warnings: [...best.warnings, 'Alternative successor investigation stopped by the total time budget.'] };
        break;
      }
      const domain = registrableDomain(hostOf(candidate.url));
      if (!domain || explored.has(domain)) continue;
      explored.add(domain);
      branchesRun += 1;

      const branch = await investigateLinear(candidate.url, {
        titleHint: candidate.titleHint ?? options.titleHint,
        _startedAt: startedAt,
      });
      const edgeVerified = candidate.status === 'verified' && candidate.score >= config.minConfidenceVerified;
      let branchFinal = branch.finalResult;
      const branchRootIsTerminal = branch.status === 'completed' && branch.originalStatus?.reachable && !branch.finalResult;
      if (branchRootIsTerminal && edgeVerified) {
        branchFinal = {
          url: candidate.url,
          verified: true,
          confidenceScore: candidate.score,
          pageRecovered: false,
          recoveredPageUrl: null,
          breakdown: candidate.evidence ?? [],
          verifiedAt: Date.now(),
        };
      } else if (branchFinal) {
        const edgeScore = candidate.score ?? 0;
        const branchScore = branchFinal.confidenceScore ?? 0;
        branchFinal = {
          ...branchFinal,
          verified: Boolean(edgeVerified && branchFinal.verified),
          confidenceScore: Math.min(edgeScore, branchScore),
          breakdown: [...(candidate.evidence ?? []), ...(branchFinal.breakdown ?? [])],
        };
      }

      const prefix = primary.migrationChain.filter((node) => node.generation <= candidate.generation);
      const branchChain = [
        {
          url: candidate.url,
          generation: candidate.generation + 1,
          status: edgeVerified ? 'verified_successor' : 'historical_candidate',
          confidenceScore: candidate.score,
          evidence: (candidate.evidence ?? []).map((item) => `${item.type}: ${item.detail}`),
        },
        ...(branch.migrationChain ?? []).slice(1).map((node) => ({ ...node, generation: node.generation + candidate.generation + 1 })),
      ];
      const combined = {
        ...primary,
        status: branchFinal?.verified ? 'completed' : (branchFinal ? 'partial' : primary.status),
        migrationChain: [...prefix, ...branchChain],
        finalResult: branchFinal,
        candidates: [...primary.candidates, ...(branch.candidates ?? []).map((item) => ({ ...item, generation: item.generation + candidate.generation + 1 }))],
        evidence: [...primary.evidence, ...(branch.evidence ?? []).map((item) => ({ ...item, generation: item.generation + candidate.generation + 1 }))],
        warnings: [...primary.warnings.filter((warning) => !warning.startsWith('No successor could be established')), ...branch.warnings],
      };

      const candidateDepth = candidate.generation + 1 + Math.max(0, (branch.migrationChain?.length ?? 1) - 1);
      const bestDepth = Math.max(0, (best.migrationChain?.length ?? 1) - 1);
      if (combined.finalResult && ((combined.finalResult.verified && !best.finalResult?.verified) ||
          (Boolean(combined.finalResult.verified) === Boolean(best.finalResult?.verified) && candidateDepth > bestDepth))) {
        best = combined;
      }
    }

    if (alternatives.length > branchesRun && branchesRun >= (config.maxAlternativeBranches ?? 3)) {
      best = { ...best, warnings: [...best.warnings, `Alternative investigation limit reached (${config.maxAlternativeBranches ?? 3} branches).`] };
    }
    return best;
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
