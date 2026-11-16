/** URL intake + validation + normalization (Phases 2 #1, 3, 12). */

import net from 'node:net';
import { LrError, ERROR_CODES } from './errors.js';

/** Pragmatic second-level labels for registrable-domain extraction. */
const SECOND_LEVEL_LABELS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'ne.jp', 'or.jp', 'co.nz',
  'com.au', 'net.au', 'org.au', 'com.br', 'com.mx', 'com.tr', 'com.cn',
  'com.in', 'co.in', 'co.za', 'com.sg', 'com.hk', 'co.kr', 'com.ar',
  'com.pk', 'com.ng', 'co.il', 'com.my', 'com.ph', 'com.vn', 'com.co',
]);

/**
 * Validates + normalizes a user-submitted URL.
 * - Adds a scheme when missing (defaults to https).
 * - Allows ONLY http/https (Phase 12 #1).
 * - Rejects credentials, malformed hosts, empty hosts.
 * - Strips fragments + default ports, lowercases host.
 *
 * @returns {URL} normalized URL object
 */
export function parseAndValidateUrl(input) {
  const invalid = (message) =>
    new LrError(ERROR_CODES.INVALID_URL, message, { status: 400 });

  if (typeof input !== 'string' || !input.trim()) {
    throw invalid('A URL string is required.');
  }

  let raw = input.trim();
  // Reject obvious garbage: control chars and spaces inside the URL.
  if (/[\s<>"{}|\\^`\x00-\x1f]/.test(raw)) {
    throw invalid('URL contains invalid characters.');
  }
  const hadScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw);
  const normalized = hadScheme ? raw : `https://${raw}`;
  // Triple-slash after scheme means missing authority (parsers may misinterpret).
  if (/^[a-z][a-z0-9+.-]*:\/\/\//i.test(normalized)) {
    throw invalid('URL host is missing or malformed.');
  }

  let url;
  try {
    url = new URL(normalized);
  } catch {
    throw invalid('URL syntax is invalid.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalid('Only http and https URLs are supported.');
  }
  // Host must be a valid hostname or IP literal (no empty, no spaces, no "..").
  if (!url.hostname || url.hostname.includes('..') || /\s/.test(url.hostname)) {
    throw invalid('URL host is missing or malformed.');
  }
  if (url.username || url.password) {
    throw invalid('URLs with embedded credentials are not allowed.');
  }

  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  return url;
}

/** Naive registrable domain (eTLD+1). Evidence-only — never security-critical. */
export function registrableDomain(host) {
  const labels = String(host).toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (SECOND_LEVEL_LABELS.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }
  return lastTwo;
}

export function isIpLiteralHost(host) {
  const bare = host.replace(/^\[|\]$/g, '');
  return net.isIPv4(bare) === true || net.isIPv6(bare) === true ? bare : null;
}

export function hostOf(urlLike) {
  try {
    return new URL(urlLike).hostname.toLowerCase();
  } catch {
    return '';
  }
}
