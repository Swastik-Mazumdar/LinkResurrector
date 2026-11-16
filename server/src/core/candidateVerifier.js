/**
 * Candidate verification engine (Phase 9).
 *
 * Every candidate is checked INDEPENDENTLY of how it was discovered:
 *   A. accessibility (HTTP, redirects, content type, parked/error detection)
 *   B. website identity (title, metadata, canonical, content similarity)
 *   C. relevance to the original (similarity vs historical identity)
 *
 * A live domain is never accepted as a legitimate successor on accessibility
 * alone — mirrors, parked domains and error pages are flagged as
 * contradictions for the confidence engine.
 */

import { hostOf, registrableDomain } from '../util/url.js';
import { contentSimilarity, titleSimilarity } from '../util/text.js';

export function createCandidateVerifier({ checkUrl, logger }) {
  /**
   * @param {object} candidate { url, source, ... }
   * @param {object} originalContext { identity?, originalUrl? }
   */
  return async function verifyCandidate(candidate, originalContext) {
    const health = await checkUrl(candidate.url, { timeoutMs: 4500 });
    const verification = {
      url: candidate.url,
      health,
      accessible: health.reachable && !health.suspect,
      restricted: health.restricted,
      suspect: health.suspect ?? null,
      identity: health.identity ?? null,
      similarities: { title: 0, content: 0 },
      // "Sparse" when original identity has no description (e.g. title-hint
      // from a dead URL). Content similarity is then not meaningful.
      identitySparse: !originalContext.identity?.description,
      canonicalContinues: false,
      furtherMigrationHint: null,
      contradicted: false,
      contradictionReason: null,
    };

    if (!health.reachable) {
      verification.contradicted = true;
      verification.contradictionReason = `candidate unreachable (${health.reason})`;
      return verification;
    }

    // A successor must be a website. Asset responses (images, scripts, …)
    // are reachable 200s but can never stand in for the original site — an
    // archived image URL must not become the vault's "verified successor".
    const contentType = String(health.contentType ?? '').toLowerCase();
    if (contentType && !/^(?:text\/html|application\/xhtml)/.test(contentType)) {
      verification.contradicted = true;
      verification.contradictionReason = `candidate is not an HTML website (${contentType})`;
      return verification;
    }

    // Off-domain redirect on the candidate itself → possible next generation.
    if (health.crossDomainRedirect) {
      verification.furtherMigrationHint = health.crossDomainRedirect;
    }

    const originalIdentity = originalContext.identity;
    if (health.identity && originalIdentity) {
      verification.similarities.title = titleSimilarity(
        originalIdentity.title,
        health.identity.title
      );
      verification.similarities.content = contentSimilarity(
        `${originalIdentity.title ?? ''} ${originalIdentity.description ?? ''}`,
        `${health.identity.title ?? ''} ${health.identity.description ?? ''}`
      );

      // Canonical that keeps pointing at the predecessor = impersonation risk
      // (live site claiming to be another domain).
      const canonicalHost = health.identity.canonical ? hostOf(health.identity.canonical) : '';
      if (
        canonicalHost &&
        originalContext.originalUrl &&
        registrableDomain(canonicalHost) === registrableDomain(hostOf(originalContext.originalUrl)) &&
        canonicalHost !== hostOf(candidate.url)
      ) {
        verification.canonicalContinues = true;
      }
    }

    if (health.suspect === 'parked_domain') {
      verification.contradicted = true;
      verification.contradictionReason = 'candidate looks like a parked domain';
    } else if (health.suspect === 'error_page') {
      verification.contradicted = true;
      verification.contradictionReason = 'candidate serves an error page';
    } else if (verification.restricted && candidate.source !== 'verified_redirect') {
      verification.contradicted = true;
      verification.contradictionReason = `candidate restricts bots (${health.reason}) — cannot verify identity`;
    } else if (
      originalIdentity?.title &&
      health.identity?.title &&
      verification.similarities.title < 0.15 &&
      verification.similarities.content < 0.1
    ) {
      verification.contradicted = true;
      verification.contradictionReason = 'candidate content bears no resemblance to the original site';
    }

    logger?.debug?.('candidate verified', {
      host: hostOf(candidate.url),
      accessible: verification.accessible,
      similarities: verification.similarities,
      contradicted: verification.contradicted,
    });

    return verification;
  };
}
