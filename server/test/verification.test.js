/** Candidate verification tests — a successor must be an actual website. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createCandidateVerifier } from '../src/core/candidateVerifier.js';

function verifierFor(health) {
  return createCandidateVerifier({
    checkUrl: async () => health,
    logger: { debug: () => {} },
  });
}

test('an image response is never accepted as a website successor', async () => {
  // Archived ESPN pages link to assets on i.imgci.com; a reachable 200 image
  // is not a migrated website and must be contradicted, not chosen.
  const verify = verifierFor({
    reachable: true,
    suspect: null,
    restricted: false,
    contentType: 'image/png',
    httpStatus: 200,
    reason: 'LIVE_OK',
    identity: null,
    crossDomainRedirect: null,
  });
  const verification = await verify(
    { url: 'https://i.imgci.com/espncricinfo/ci_apple_webclip.png', source: 'external_reference' },
    { identity: { title: 'ESPNcricinfo', description: 'Live cricket scores' }, originalUrl: 'https://www.espncricinfo.com/' }
  );
  assert.equal(verification.contradicted, true);
  assert.match(verification.contradictionReason, /not an HTML website/);
});

test('an HTML successor is still verified normally', async () => {
  const verify = verifierFor({
    reachable: true,
    suspect: null,
    restricted: false,
    contentType: 'text/html; charset=utf-8',
    httpStatus: 200,
    reason: 'LIVE_OK',
    identity: { title: 'ESPNcricinfo', description: 'Live cricket scores' },
    crossDomainRedirect: null,
  });
  const verification = await verify(
    { url: 'https://www.espncricinfo.com/', source: 'search_result' },
    { identity: { title: 'ESPNcricinfo', description: 'Live cricket scores' }, originalUrl: 'https://www.espncricinfo.com/' }
  );
  assert.equal(verification.contradicted, false);
  assert.equal(verification.accessible, true);
});
