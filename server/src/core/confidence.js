/**
 * Evidence ranking + confidence engine (Phase 10).
 *
 * Explainable heuristic scoring (NOT probabilities). Correlated evidence is
 * de-duplicated (one weight per evidence TYPE, keeping the strongest
 * instance). Impersonation guard: verification requires either at least one
 * STRUCTURAL signal (live redirect / announcement / canonical / meta
 * refresh) or (search discovery + genuinely matching identity).
 *
 * Calibration notes:
 *   - A live HTTP redirect declared by the predecessor's own server is the
 *     strongest single structural signal; combined with an independently
 *     accessible, non-contradicted destination it clears the verified bar.
 *   - An official migration announcement corroborated by a live, matching
 *     destination also clears it.
 *   - Search-only discovery must additionally show strong identity match.
 *   - Contradictions (parked domains, error pages, bot walls, identity
 *     mismatch, canonical still pointing at the predecessor) subtract.
 */

const WEIGHTS = {
  verified_redirect: 60,
  official_migration_announcement: 35,
  canonical_url: 18,
  meta_refresh: 20,
  title_similarity: 30,
  content_similarity: 20,
  search_result: 12,
  external_reference: 6,
};

const STRUCTURAL_TYPES = new Set([
  'verified_redirect',
  'official_migration_announcement',
  'canonical_url',
  'meta_refresh',
]);

/** Bonus when a structurally-evidenced destination passed independent checks. */
const ACCESSIBLE_DESTINATION_BONUS = 20;
/** Weight granted to search evidence when identity matches strongly. */
const SEARCH_CORROBORATED_WEIGHT = 52;

export function createConfidenceEngine({ config, logger }) {
  /**
   * @param {Array<{ type: string, weight?: number, similarity?: number, detail?: string }>} evidenceItems
   * @param {object} verification result of candidateVerifier
   * @returns {{ score: number, breakdown: Array, accepted: boolean,
   *            reasons: string[], contradictions: string[] }}
   */
  return function score(evidenceItems, verification) {
    const breakdown = [];
    const contradictions = [];

    // De-duplicate correlated evidence by type (keep strongest first).
    const byType = new Map();
    for (const item of evidenceItems) {
      const existing = byType.get(item.type);
      if (!existing || (item.weight ?? 0) > (existing.weight ?? 0)) {
        byType.set(item.type, item);
      }
    }

    let scoreValue = 0;
    for (const [type, item] of byType) {
      let weight = item.weight ?? WEIGHTS[type] ?? 0;
      let detail = item.detail ?? '';

      if (type === 'title_similarity') {
        weight = Math.round(WEIGHTS.title_similarity * Math.min(1, item.similarity ?? 0));
        detail = `title similarity ${(item.similarity ?? 0).toFixed(2)}`;
        if ((item.similarity ?? 0) <= 0.3) weight = 0;
      }
      if (type === 'content_similarity') {
        weight = Math.round(WEIGHTS.content_similarity * Math.min(1, item.similarity ?? 0));
        detail = `content similarity ${(item.similarity ?? 0).toFixed(2)}`;
        if ((item.similarity ?? 0) <= 0.2) weight = 0;
      }
      if (weight <= 0) continue;

      scoreValue += weight;
      breakdown.push({ type, weight, detail });
    }

    // Contradictions from independent verification.
    if (verification.contradicted && verification.contradictionReason) {
      contradictions.push(verification.contradictionReason);
      if (verification.suspect === 'parked_domain') scoreValue -= 25;
      else scoreValue -= 15;
    }
    // Live site still claiming the predecessor's identity via canonical →
    // impersonation/copied-site risk.
    if (verification.canonicalContinues) {
      contradictions.push('candidate canonical still points to the original domain');
      scoreValue -= 20;
    }

    // Structural classification.
    const structural = [...byType.keys()].filter((type) => STRUCTURAL_TYPES.has(type));
    const hasStructural = structural.length > 0;
    const titleSim = byType.get('title_similarity')?.similarity ?? 0;
    const contentSim = byType.get('content_similarity')?.similarity ?? 0;
    // "Strong identity" means the title clearly matches AND (when the
    // original identity was rich enough to compare content) the content
    // matches too. A title-only hint identity is "sparse" — content
    // similarity is then meaningless rather than contradicting.
    const hasStrongIdentity =
      titleSim >= 0.5 &&
      (verification.identitySparse ? true : contentSim >= 0.3);
    const searchOnly = byType.has('search_result') && structural.length === 0;

    // Accessible-destination bonus: a structural signal is stronger when the
    // destination independently passed accessibility + identity checks.
    const destinationVerified =
      hasStructural &&
      verification.accessible &&
      !verification.contradicted &&
      !verification.canonicalContinues;
    if (destinationVerified) {
      scoreValue += ACCESSIBLE_DESTINATION_BONUS;
      breakdown.push({
        type: 'destination_verification_bonus',
        weight: ACCESSIBLE_DESTINATION_BONUS,
        detail: 'destination independently verified as accessible and non-contradicted',
      });
    }

    const reasons = [];
    if (hasStructural) {
      reasons.push(`structural migration evidence: ${structural.join(', ')}`);
    } else if (searchOnly && hasStrongIdentity) {
      // Search discovery corroborated by strong identity — grant the
      // corroborated weight instead of the bare search weight.
      const bareIndex = breakdown.findIndex((item) => item.type === 'search_result');
      const boost = SEARCH_CORROBORATED_WEIGHT - WEIGHTS.search_result;
      if (bareIndex !== -1) breakdown[bareIndex].weight += boost;
      scoreValue += boost;
      reasons.push('search discovery corroborated by strong identity match');
    } else if (searchOnly) {
      contradictions.push('search-only evidence without structural corroboration');
      scoreValue = Math.min(scoreValue, 55);
    }

    scoreValue = Math.max(0, Math.min(100, scoreValue));

    const accepted =
      !verification.contradicted &&
      scoreValue >= config.minConfidenceVerified &&
      (hasStructural || (searchOnly && hasStrongIdentity));

    if (!accepted && scoreValue >= config.minConfidenceVerified) {
      reasons.push('score met threshold but verification evidence was insufficient');
      scoreValue = Math.min(scoreValue, config.minConfidenceVerified - 5);
    }

    logger?.debug?.('candidate scored', {
      url: verification.url,
      score: scoreValue,
      accepted,
      contradictions,
    });

    return { score: scoreValue, breakdown, accepted, reasons, contradictions };
  };
}
