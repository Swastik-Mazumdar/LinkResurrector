/**
 * SSRF-guarded HTTP client (Phase 12 — the security core).
 *
 * Guarantees:
 *  - Only http/https; no credentials; per-hop scheme/host re-validation.
 *  - Every DNS resolution is validated against the private-IP blocklist
 *    BEFORE connecting, AND again inside the socket agent's lookup callback
 *    (closes the check-then-connect DNS-rebinding window).
 *  - Redirects are followed manually: each hop re-runs full validation,
 *    redirect loops and excessive hops are rejected.
 *  - Strict connect/response timeouts and hard response-size caps.
 *  - Response bodies are treated as inert text; nothing is ever executed.
 *
 * `allowPrivateForTesting` exists ONLY for the automated test-suite (which
 * spins real loopback HTTP servers); production code never sets it.
 */

import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { LrError, ERROR_CODES } from './errors.js';
import { isPrivateIp } from './ip.js';
import { isIpLiteralHost, parseAndValidateUrl } from './url.js';

const USER_AGENT =
  'LinkResurrector/1.0 (+https://linkresurrector.local; recovery bot; respects rate limits)';

export function createSafeFetch(overrides = {}) {
  // Testability: the DNS module is injectable so the security suite can
  // simulate rebinding deterministically. Production always uses real DNS.
  const dnsModule = overrides.dns ?? dns;
  /**
   * @param {string|URL} rawUrl
   * @param {{
   *   timeoutMs?: number, maxBytes?: number, maxRedirects?: number,
   *   method?: string, headers?: Record<string,string>,
   *   allowPrivateForTesting?: boolean
   * }} [options]
   */
  return async function safeFetch(rawUrl, options = {}) {
    const timeoutMs = options.timeoutMs ?? overrides.timeoutMs ?? 12_000;
    const maxBytes = options.maxBytes ?? overrides.maxBytes ?? 512 * 1024;
    const maxRedirects = options.maxRedirects ?? overrides.maxRedirects ?? 8;
    const method = (options.method ?? 'GET').toUpperCase();
    const allowPrivate = options.allowPrivateForTesting ?? false;

    const started = Date.now();
    const chain = [];
    const visited = new Set();
    let current = parseAndValidateUrl(String(rawUrl));
    let response = null;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      if (visited.has(current.href)) {
        throw new LrError(ERROR_CODES.REDIRECT_LOOP, 'Redirect loop detected.', {
          details: { chain },
        });
      }
      visited.add(current.href);

      await assertHostIsSafe(current, allowPrivate, dnsModule);

      response = await rawRequest(current, {
        method,
        headers: buildHeaders(options.headers),
        timeoutMs,
        maxBytes,
        allowPrivate,
        dnsModule,
      });

      chain.push({
        url: current.href,
        status: response.status,
        location: response.headers.location ?? null,
      });

      if (
        response.status === 301 ||
        response.status === 302 ||
        response.status === 303 ||
        response.status === 307 ||
        response.status === 308
      ) {
        const location = response.headers.location;
        if (!location) break; // redirect status without Location → treat as terminal

        let next;
        try {
          next = new URL(location, current);
        } catch {
          throw new LrError(ERROR_CODES.SECURITY_BLOCKED, 'Malformed redirect target.', {
            details: { location },
          });
        }
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new LrError(ERROR_CODES.SECURITY_BLOCKED, 'Redirect to unsafe protocol.', {
            details: { location },
          });
        }
        if (next.username || next.password) {
          throw new LrError(ERROR_CODES.SECURITY_BLOCKED, 'Redirect contains credentials.');
        }
        if (hop === maxRedirects) {
          throw new LrError(ERROR_CODES.TOO_MANY_REDIRECTS, 'Too many redirects.', {
            details: { chain },
          });
        }
        current = next;
        continue;
      }

      break;
    }

    return {
      status: response.status,
      headers: response.headers,
      body: response.body,
      contentType: response.headers['content-type'] ?? '',
      chain,
      finalUrl: current.href,
      elapsedMs: Date.now() - started,
    };
  };
}

function buildHeaders(extra = {}) {
  return {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    'accept-language': 'en',
    ...extra,
  };
}

/** Validates the host of a URL against the private-IP blocklist. */
async function assertHostIsSafe(url, allowPrivate, dnsModule) {
  if (allowPrivate) return;

  const literal = isIpLiteralHost(url.hostname);
  if (literal) {
    if (isPrivateIp(literal)) {
      throw new LrError(
        ERROR_CODES.SECURITY_BLOCKED,
        `Refusing to contact private/loopback address: ${literal}`
      );
    }
    return;
  }

  let addresses;
  try {
    addresses = await dnsModule.promises.lookup(url.hostname, { all: true, verbatim: true });
  } catch (error) {
    const code = error?.code ?? '';
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ENOENT') {
      throw new LrError(ERROR_CODES.DNS_FAILURE, `DNS lookup failed for ${url.hostname}`, {
        cause: error,
      });
    }
    throw new LrError(ERROR_CODES.DNS_FAILURE, `DNS error for ${url.hostname}: ${code}`, {
      cause: error,
    });
  }

  if (!addresses?.length) {
    throw new LrError(ERROR_CODES.DNS_FAILURE, `No addresses resolved for ${url.hostname}`);
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new LrError(
        ERROR_CODES.SECURITY_BLOCKED,
        `Refusing to contact private address ${address} for ${url.hostname}`
      );
    }
  }
}

/** DNS lookup that re-validates resolved IPs at connect time. */
function safeLookupFactory(allowPrivate, dnsModule) {
  return function safeLookup(hostname, options, callback) {
    dnsModule.lookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      if (!allowPrivate) {
        for (const entry of addresses) {
          if (isPrivateIp(entry.address)) {
            return callback(
              new LrError(
                ERROR_CODES.SECURITY_BLOCKED,
                `Connect-time guard refused private address ${entry.address}`
              )
            );
          }
        }
      }
      // Hand the validated address list to the stack (it picks one).
      callback(null, addresses);
    });
  };
}

function rawRequest(url, { method, headers, timeoutMs, maxBytes, allowPrivate, dnsModule }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    const agent = new transport.Agent({
      lookup: safeLookupFactory(allowPrivate, dnsModule),
      keepAlive: false,
    });

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        agent,
      },
      (response) => {
        const chunks = [];
        let total = 0;
        let settled = false;

        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            const error = new LrError(ERROR_CODES.BODY_TOO_LARGE, 'Response exceeds size limit.', {
              details: { maxBytes, url: url.href },
            });
            request.destroy(error);
            if (!settled) {
              settled = true;
              reject(error);
            }
            return;
          }
          chunks.push(chunk);
        });

        response.on('end', () => {
          if (settled) return;
          settled = true;
          const raw = Buffer.concat(chunks);
          const contentType = String(response.headers['content-type'] ?? '');
          const isText = /^(text\/|application\/(json|xml|xhtml|javascript))/i.test(contentType) ||
            contentType === '';
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: isText ? raw.toString('utf8') : null,
          });
        });

        response.on('error', (error) => {
          if (settled) return;
          settled = true;
          reject(mapNetworkError(error));
        });
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        new LrError(ERROR_CODES.CONNECTION_TIMEOUT, `Timed out after ${timeoutMs}ms`, {
          details: { url: url.href },
        })
      );
    });

    request.on('error', (error) => {
      if (error instanceof LrError) return reject(error);
      reject(mapNetworkError(error));
    });

    request.end();
  });
}

export function mapNetworkError(error) {
  if (error instanceof LrError) return error;
  const code = error?.code ?? '';
  const message = String(error?.message ?? error);

  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return new LrError(ERROR_CODES.DNS_FAILURE, 'DNS lookup failed.', { cause: error });
  }
  if (code === 'ECONNREFUSED') {
    return new LrError(ERROR_CODES.CONNECTION_REFUSED, 'Connection refused.', { cause: error });
  }
  if (
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    /timed?\s?out/i.test(message) ||
    /socket hang up/i.test(message)
  ) {
    return new LrError(ERROR_CODES.CONNECTION_TIMEOUT, 'Connection timed out.', { cause: error });
  }
  if (
    code.startsWith('ERR_TLS') ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    /certificate/i.test(message)
  ) {
    return new LrError(ERROR_CODES.TLS_ERROR, 'TLS/certificate error.', { cause: error });
  }
  return new LrError(ERROR_CODES.CONNECTION_REFUSED, `Network error: ${message}`, {
    cause: error,
  });
}
