/** URL intake + validation unit tests (Phase 3 #1–3, Phase 12 input validation). */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAndValidateUrl, registrableDomain, isIpLiteralHost } from '../src/util/url.js';
import { LrError, ERROR_CODES } from '../src/util/errors.js';

test('parseAndValidateUrl adds a scheme when missing', () => {
  const url = parseAndValidateUrl('example.com/path');
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'example.com');
  assert.equal(url.pathname, '/path');
});

test('parseAndValidateUrl keeps http and strips fragments + default ports', () => {
  const url = parseAndValidateUrl('http://EXAMPLE.com:80/path?a=1#frag');
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, 'example.com');
  assert.equal(url.port, '');
  assert.equal(url.hash, '');
  assert.equal(url.search, '?a=1');
});

test('parseAndValidateUrl rejects invalid input', () => {
  for (const bad of ['', '   ', null, undefined, 123, 'not a url at all :://', 'https://', 'mailto:user@example.com']) {
    assert.throws(() => parseAndValidateUrl(bad), (error) =>
      error instanceof LrError && error.code === ERROR_CODES.INVALID_URL,
      `expected ${JSON.stringify(bad)} to be rejected`
    );
  }
});

test('parseAndValidateUrl rejects embedded credentials', () => {
  assert.throws(() => parseAndValidateUrl('https://user:pw@example.com/'), LrError);
});

test('registrableDomain extracts eTLD+1 with multi-label suffixes', () => {
  assert.equal(registrableDomain('www.example.com'), 'example.com');
  assert.equal(registrableDomain('deep.sub.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('localhost'), 'localhost');
});

test('isIpLiteralHost detects bare IP literals', () => {
  assert.equal(isIpLiteralHost('8.8.8.8'), '8.8.8.8');
  assert.equal(isIpLiteralHost('[::1]'), '::1');
  assert.equal(isIpLiteralHost('example.com'), null);
});
