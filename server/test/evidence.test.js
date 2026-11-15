/** Evidence extraction tests (Phase 5) — deterministic HTML fixtures. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createEvidenceExtractor } from '../src/core/evidenceExtractor.js';
import { extractIdentity, sanitizeText, isInfraHost } from '../src/util/html.js';

const extractEvidence = createEvidenceExtractor({ logger: { debug: () => {} } });

test('extractIdentity reads title, description, canonical, og:url and meta refresh', () => {
  const html = `
    <html><head>
      <title>Example Blog | Notes on Software</title>
      <meta name="description" content="Long-form notes on distributed systems.">
      <link rel="canonical" href="https://blog.example/canonical-post">
      <meta property="og:url" content="https://blog.example/og-url">
      <meta http-equiv="refresh" content="0; url=https://new-home.example/blog">
    </head><body><p>Hello</p></body></html>`;
  const identity = extractIdentity(html, 'https://old.example/post');
  assert.equal(identity.title, 'Example Blog | Notes on Software');
  assert.equal(identity.description, 'Long-form notes on distributed systems.');
  assert.equal(identity.canonical, 'https://blog.example/canonical-post');
  assert.equal(identity.ogUrl, 'https://blog.example/og-url');
  assert.equal(identity.metaRefresh, 'https://new-home.example/blog');
});

test('migration announcement phrases are detected with nearby URLs', () => {
  const html = `
    <html><head><title>Old Site</title></head><body>
      <p>We have moved! Find our new official website at https://new-thing.example/home.</p>
    </body></html>`;
  const identity = extractIdentity(html, 'https://old.example/');
  assert.ok(identity.announcements.length >= 1);
  const withUrls = identity.announcements.find((a) => a.urls.length > 0);
  assert.ok(withUrls, 'announcement should capture the nearby URL');
  assert.ok(withUrls.urls.some((url) => url.startsWith('https://new-thing.example')));
});

test('extractEvidence classifies candidates by source and filters junk', () => {
  const html = `
    <html><head><title>The Project</title>
      <link rel="canonical" href="https://successor.example/">
      <meta http-equiv="refresh" content="0; url=https://successor.example/">
    </head><body>
      We have moved to https://successor.example/ — please update your bookmarks!
      <a href="https://facebook.com/theproject">Social</a>
      <a href="https://partner.example/some-page">Partner</a>
      <a href="https://successor.example/deep-page">Us</a>
    </body></html>`;
  const { identity, candidates } = extractEvidence(html, 'https://original.example/');

  const bySource = Object.groupBy?.(candidates, (c) => c.source) ?? candidates.reduce((acc, c) => {
    (acc[c.source] ??= []).push(c);
    return acc;
  }, {});

  assert.ok(bySource.official_migration_announcement?.length >= 1);
  assert.ok(bySource.canonical_url?.length >= 1);
  assert.ok(bySource.meta_refresh?.length >= 1);
  assert.ok(bySource.external_reference?.length >= 1);

  // Infra hosts (facebook.com) must never become candidates.
  assert.ok(!candidates.some((c) => c.host === 'facebook.com'));
  // Candidates carry a registrable domain + path.
  const announcement = bySource.official_migration_announcement[0];
  assert.equal(announcement.registrableDomain, 'successor.example');
});

test('duplicate candidates for the same registrable domain + source collapse', () => {
  const html = `
    <html><body>
      We have moved: https://new.example/a
      We have moved: https://new.example/b
    </body></html>`;
  const { candidates } = extractEvidence(html, 'https://old.example/');
  const announcementCandidates = candidates.filter(
    (c) => c.source === 'official_migration_announcement'
  );
  assert.equal(announcementCandidates.length, 1);
});

test('relative redirect targets are resolved against the base URL', () => {
  const html = `
    <html><head><meta http-equiv="refresh" content="0; url=/new-location"></head><body></body></html>`;
  const identity = extractIdentity(html, 'https://old.example/page');
  assert.equal(identity.metaRefresh, 'https://old.example/new-location');
});

test('malformed HTML and hostile payloads never crash the extractor', () => {
  const hostile = `
    <html><head><title>>>><<<\\u0000 <img src=x onerror=alert(1)></title>
    <meta name="description" content="&lt;script&gt;alert('x')&lt;/script&gt;">
    </head><body><<><>>>)))(((
    We have moved to https://new.example/<script>steal()</script>
    </body></html>`;
  const identity = extractIdentity(hostile, 'https://x.example/');
  assert.ok(!identity.title.includes('<script'));
  assert.ok(!identity.description.includes('<script>'));
  assert.ok(identity.announcements.length >= 1);
});

test('sanitizeText strips tags, decodes entities and clamps length', () => {
  const result = sanitizeText('<b>Hello</b> &amp; <i>welcome</i> &lt;tag&gt;', 20);
  assert.equal(result, 'Hello & welcome <tag>');
  assert.ok(sanitizeText('x'.repeat(500), 50).length <= 50);
});

test('ad/analytics infra hosts are recognized in all subdomains', () => {
  assert.equal(isInfraHost('googlesyndication.com'), true);
  assert.equal(isInfraHost('ads.doubleclick.net'), true);
  assert.equal(isInfraHost('platform.twitter.com'), true);
  assert.equal(isInfraHost('example.com'), false);
});
