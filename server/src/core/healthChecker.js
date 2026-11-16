/**
 * URL health checker (Phase 3).
 *
 * Classifies responses with nuance: 403/429 are NOT death, HTTP 200 is not
 * automatically a healthy page (parked/error pages are flagged), redirect
 * chains are recorded hop-by-hop with cross-domain detection.
 */

import { mapNetworkError } from '../security/ssrf.js';
import { extractIdentity } from '../util/html.js';
import { hostOf, registrableDomain } from '../util/url.js';

const PARKED_PATTERNS = [
  /this domain is for sale/i,
  /buy this domain/i,
  /domain (?:is )?(?:parked|parking)/i,
  /parkingcrew/i,
  /sedoparking/i,
  /hugedomains/i,
  /afternic/i,
  /dan\.com/i,
  /domain may be for sale/i,
];

const ERROR_PAGE_PATTERNS = [
  /<title>[^<]*(?:404|not found|error)[^<]*<\/title>/i,
  /page not found/i,
  /site not found/i,
  /web server is (?:down|temporarily unable)/i,
];

export function createHealthChecker({ fetcher, config, logger }) {
  /**
   * @param {string|URL} url
   * @returns {Promise<object>} normalized health record
   */
  return async function checkUrl(url) {
    const target = String(url);
    const record = {
      url: target,
      reachable: false,
      httpStatus: null,
      reason: null,
      restricted: false,
      suspect: null,
      redirectChain: [],
      finalUrl: null,
      crossDomainRedirect: null,
      contentType: null,
      elapsedMs: null,
      identity: null,
      bodyLength: 0,
    };

    try {
      const response = await fetcher(target, {
        timeoutMs: config.fetchTimeoutMs,
        maxBytes: config.maxResponseBytes,
        maxRedirects: config.maxRedirects,
      });

      record.httpStatus = response.status;
      record.reachable = true;
      record.redirectChain = response.chain;
      record.finalUrl = response.finalUrl;
      record.contentType = response.contentType;
      record.elapsedMs = response.elapsedMs;
      record.bodyLength = response.body ? response.body.length : 0;

      const originalHost = hostOf(target);
      const finalHost = hostOf(response.finalUrl);
      if (finalHost && registrableDomain(finalHost) !== registrableDomain(originalHost)) {
        record.crossDomainRedirect = response.finalUrl;
      }

      const body = response.body ?? '';
      if (
        response.status >= 200 &&
        response.status < 300 &&
        /^text\/html/i.test(response.contentType || 'text/html')
      ) {
        record.identity = extractIdentity(body, response.finalUrl);

        if (PARKED_PATTERNS.some((pattern) => pattern.test(body))) {
          record.suspect = 'parked_domain';
        } else if (
          body.length < 2048 &&
          ERROR_PAGE_PATTERNS.some((pattern) => pattern.test(body))
        ) {
          record.suspect = 'error_page';
        }
      }

      if (response.status >= 200 && response.status < 400 && !record.crossDomainRedirect) {
        // A same-domain hop that followed a redirect is not "untouched LIVE_OK";
        // record the redirect so callers can distinguish it from a direct 200.
        const hadRedirect = record.redirectChain.length > 1;
        record.reason = (hadRedirect || response.status !== 200)
          ? 'LIVE_REDIRECT_SAME_SITE'
          : 'LIVE_OK';
      } else if (response.status >= 200 && response.status < 400) {
        record.reason = 'REDIRECTED_OFFSITE';
      } else if (response.status === 401 || response.status === 403 || response.status === 429) {
        record.restricted = true;
        record.reason = `HTTP_${response.status}_RESTRICTED`;
      } else if (response.status === 404 || response.status === 410) {
        record.reason = response.status === 410 ? 'HTTP_410_GONE' : 'HTTP_404_NOT_FOUND';
      } else if (response.status >= 500) {
        record.reason = `HTTP_${response.status}_SERVER_ERROR`;
      } else {
        record.reason = `HTTP_${response.status}`;
      }

      return record;
    } catch (error) {
      const lrError = isLrErrorLike(error) ? error : mapNetworkError(error);
      record.reason = lrError.code;
      if (lrError.details?.chain) record.redirectChain = lrError.details.chain;
      logger?.debug?.('health-check failed', { host: hostOf(target), code: lrError.code });
      return record;
    }
  };
}

function isLrErrorLike(error) {
  return Boolean(error && typeof error === 'object' && typeof error.code === 'string');
}
