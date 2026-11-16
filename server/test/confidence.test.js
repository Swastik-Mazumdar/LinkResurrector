/** Confidence engine tests (Phase 10) — explainable, de-duplicated scoring. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfidenceEngine } from '../src/core/confidence.js';

const config = { minConfidenceToRecurse: 60, minConfidenceVerified: 80 };
const logger = { debug: () => {} };
const score = createConfidenceEngine({ config, logger });

const healthyVerification = {
  url: 'https://new.example/',
  accessible: true,
  contradicted: false,
  contradictionReason: null,
  suspect: null,
  similarities: { title: 0.9, content: 0.6 },
  canonicalContinues: false,
};

test('verified redirect + strong identity clears the verified threshold', () => {
  const result = score(
    [
      { type: 'verified_redirect', detail: 'live redirect' },
      { type: 'title_similarity', similarity: 0.9 },
      { type: 'content_similarity', similarity: 0.6 },
    ],
    healthyVerification
  );
  assert.equal(result.accepted, true);
  assert.ok(result.score >= 80, `score ${result.score} should be >= 80`);
  assert.ok(result.score <= 100);
  assert.ok(result.breakdown.some((item) => item.type === 'verified_redirect'));
});

test('correlated evidence is de-duplicated per type (no double counting)', () => {
  const result = score(
    [
      { type: 'official_migration_announcement', detail: 'snapshot 1' },
      { type: 'official_migration_announcement', detail: 'snapshot 2' },
      { type: 'official_migration_announcement', detail: 'snapshot 3' },
    ],
    healthyVerification
  );
  const announcementEntries = result.breakdown.filter(
    (item) => item.type === 'official_migration_announcement'
  );
  assert.equal(announcementEntries.length, 1);
});

test('search-only evidence without structure is capped below verified', () => {
  // Weak identity (0.4/0.25) — below the strong-identity bar.
  const result = score(
    [
      { type: 'search_result' },
      { type: 'title_similarity', similarity: 0.4 },
      { type: 'content_similarity', similarity: 0.25 },
    ],
    healthyVerification
  );
  assert.ok(result.score < 80, `score ${result.score} must stay below verified threshold`);
  assert.equal(result.accepted, false);
  assert.ok(result.contradictions.some((c) => /search-only/.test(c)));
});

test('search-only evidence with strong identity CAN be accepted', () => {
  const result = score(
    [
      { type: 'search_result' },
      { type: 'title_similarity', similarity: 0.95 },
      { type: 'content_similarity', similarity: 0.7 },
    ],
    healthyVerification
  );
  assert.equal(result.accepted, true);
  assert.ok(result.score >= 80, `score ${result.score} should be >= 80`);
});

test('parked-domain candidates are penalized and rejected', () => {
  const result = score(
    [{ type: 'verified_redirect' }],
    {
      ...healthyVerification,
      contradicted: true,
      suspect: 'parked_domain',
      contradictionReason: 'candidate looks like a parked domain',
    }
  );
  assert.equal(result.accepted, false);
  assert.ok(result.contradictions.includes('candidate looks like a parked domain'));
});

test('canonical still pointing at the original domain signals impersonation', () => {
  const result = score(
    [{ type: 'title_similarity', similarity: 0.9 }],
    { ...healthyVerification, canonicalContinues: true }
  );
  assert.ok(result.contradictions.some((c) => /canonical still points/.test(c)));
});

test('low-similarity identities contribute nothing', () => {
  const result = score(
    [
      { type: 'title_similarity', similarity: 0.1 },
      { type: 'content_similarity', similarity: 0.05 },
      { type: 'external_reference' },
    ],
    healthyVerification
  );
  assert.ok(!result.breakdown.some((item) => item.type === 'title_similarity'));
  assert.ok(!result.breakdown.some((item) => item.type === 'content_similarity'));
  assert.ok(result.score < 60, 'weak evidence must not reach recursion threshold');
});

test('scores never leave the 0–100 range', () => {
  const max = score(
    [
      { type: 'verified_redirect' },
      { type: 'official_migration_announcement' },
      { type: 'canonical_url' },
      { type: 'meta_refresh' },
      { type: 'title_similarity', similarity: 1 },
      { type: 'content_similarity', similarity: 1 },
      { type: 'search_result' },
    ],
    healthyVerification
  );
  assert.ok(max.score <= 100);
  const min = score([], {
    ...healthyVerification,
    contradicted: true,
    suspect: 'parked_domain',
    contradictionReason: 'parked',
    canonicalContinues: true,
  });
  assert.ok(min.score >= 0);
});
