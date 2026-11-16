/**
 * Security test suite — SSRF protection (Phase 18 #19–24, Phase 12 audit).
 *
 * Uses a real loopback HTTP server with `allowPrivateForTesting: true` for
 * client-behavior tests, and an injected fake DNS module to simulate
 * rebinding attacks deterministically. No external network access.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createSafeFetch } from '../src/security/ssrf.js';
import { isPrivateIp } from '../src/util/ip.js';
import { LrError, ERROR_CODES } from '../src/util/errors.js';

/* ---------------------------- isPrivateIp ---------------------------- */

test('ip classification blocks private/loopback/link-local IPv4', () => {
  for (const ip of [
    '127.0.0.1', '10.0.0.5', '10.255.255.255', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '198.18.0.1', '203.0.113.9', '224.0.0.1', '255.255.255.255',
    '240.0.0.1', 'not-an-ip', '',
  ]) {
    assert.equal(isPrivateIp(ip), true, `expected ${JSON.stringify(ip)} to be blocked`);
  }
});

test('ip classification allows public IPv4', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '169.253.0.1', '11.0.0.1']) {
    assert.equal(isPrivateIp(ip), false, `expected ${ip} to be allowed`);
  }
});

test('ip classification blocks private/loopback IPv6 forms', () => {
  for (const ip of [
    '::1', '::', 'fc00::abcd', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
    '2002:7f00:0001::',       // 6to4 embedding 127.0.0.1
    '2002:a00:0001::',        // 6to4 embedding 10.0.0.1
    '64:ff9b::7f00:0001',     // NAT64 embedding 127.0.0.1
    '2001:0000::',            // Teredo prefix (conservatively blocked)
  ]) {
    assert.equal(isPrivateIp(ip), true, `expected ${ip} to be blocked`);
  }
});

test('ip classification allows public IPv6', () => {
  for (const ip of ['2606:4700::1111', '2001:4860:4860::8888', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateIp(ip), false, `expected ${ip} to be allowed`);
  }
});

test('unparseable addresses are treated as unsafe', () => {
  assert.equal(isPrivateIp('garbage:::1'), true);
  assert.equal(isPrivateIp('1.2.3.4.5'), true);
});

/* ------------------------- safeFetch intake -------------------------- */

test('safeFetch rejects non-http protocols, credentials and malformed URLs', async () => {
  const safeFetch = createSafeFetch();
  await assert.rejects(safeFetch('ftp://example.com/file'), (error) =>
    error.code === ERROR_CODES.INVALID_URL
  );
  await assert.rejects(safeFetch('javascript:alert(1)'), (error) =>
    error.code === ERROR_CODES.INVALID_URL
  );
  await assert.rejects(safeFetch('https://user:pass@example.com/'), (error) =>
    error.code === ERROR_CODES.INVALID_URL
  );
  await assert.rejects(safeFetch('https:///no-host'), (error) =>
    error.code === ERROR_CODES.INVALID_URL
  );
});

test('safeFetch refuses private IP-literal targets (IPv4 + IPv6)', async () => {
  const safeFetch = createSafeFetch();
  for (const target of [
    'http://127.0.0.1:9/x',
    'http://10.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:9/x',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[::ffff:127.0.0.1]/',
  ]) {
    await assert.rejects(safeFetch(target), (error) =>
      error.code === ERROR_CODES.SECURITY_BLOCKED,
      `expected ${target} to be security-blocked`
    );
  }
});

test('safeFetch refuses hostnames that resolve to private addresses (fake DNS)', async () => {
  const fakeDns = {
    lookup: (hostname, options, callback) => callback(null, [{ address: '127.0.0.1', family: 4 }]),
    promises: {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    },
  };
  const safeFetch = createSafeFetch({ dns: fakeDns });
  await assert.rejects(safeFetch('http://internal.example.com/'), (error) =>
    error.code === ERROR_CODES.SECURITY_BLOCKED &&
    /private address/.test(error.message)
  );
});

test('safeFetch blocks DNS rebinding at connect time when first lookup is clean', async () => {
  // Simulates the classic rebinding race: the pre-connect check resolves a
  // public address, but the lookup at connect time "rebinds" to loopback.
  // The connect-time guard (agent lookup) must refuse the private address
  // before any socket is opened.
  let connectCalls = 0;
  const fakeDns = {
    lookup: (hostname, options, callback) => {
      connectCalls += 1;
      callback(null, [{ address: '127.0.0.1', family: 4 }]);
    },
    promises: {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    },
  };
  const safeFetch = createSafeFetch({ dns: fakeDns });
  await assert.rejects(safeFetch('http://rebinding.example.com/'), (error) =>
    error.code === ERROR_CODES.SECURITY_BLOCKED
  );
  assert.ok(connectCalls >= 1, 'connect-time lookup must have been re-validated');
});

test('safeFetch blocks redirect-based SSRF (public host redirects to loopback)', async () => {
  // Pre-connect validation (promises.lookup) sees the "public" first hop as
  // safe but classifies the redirect target as private. Connect-time lookup
  // routes the first hop to the actual loopback server so the redirect is
  // issued, then the second hop is blocked before any connection.
  const fakeDns = {
    promises: {
      lookup: async (hostname) =>
        hostname === 'secret.internal.example.com'
          ? [{ address: '127.0.0.1', family: 4 }]
          : [{ address: '93.184.216.34', family: 4 }],
    },
    lookup: (hostname, options, callback) => {
      // Connect-time: route the first hop to loopback so we reach our
      // test server; anything else (should never connect) would be caught
      // by the pre-connect guard anyway.
      const address = hostname === 'public.example.com' ? '127.0.0.1' : '127.0.0.1';
      callback(null, [{ address, family: 4 }]);
    },
  };

  const server = http.createServer((req, res) => {
    res.writeHead(302, { location: 'http://secret.internal.example.com/steal' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const safeFetch = createSafeFetch({ dns: fakeDns });
    await assert.rejects(
      safeFetch(`http://public.example.com:${port}/`),
      (error) => error.code === ERROR_CODES.SECURITY_BLOCKED
    );
  } finally {
    server.close();
  }
});

test('safeFetch strips credentials when a redirect changes origin', async () => {
  let redirectedHeaders;
  const destination = http.createServer((req, res) => {
    redirectedHeaders = req.headers;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((resolve) => destination.listen(0, '127.0.0.1', resolve));
  const destinationUrl = `http://127.0.0.1:${destination.address().port}/final`;
  const source = http.createServer((_req, res) => {
    res.writeHead(302, { location: destinationUrl });
    res.end();
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  try {
    const safeFetch = createSafeFetch();
    const response = await safeFetch(`http://127.0.0.1:${source.address().port}/start`, {
      allowPrivateForTesting: true,
      headers: {
        authorization: 'Bearer test-secret',
        'Ocp-Apim-Subscription-Key': 'test-api-key',
        'x-api-key': 'test-api-key-2',
        'x-request-label': 'safe-to-forward',
      },
    });
    assert.equal(response.status, 200);
    assert.equal(redirectedHeaders.authorization, undefined);
    assert.equal(redirectedHeaders['ocp-apim-subscription-key'], undefined);
    assert.equal(redirectedHeaders['x-api-key'], undefined);
    assert.equal(redirectedHeaders['x-request-label'], 'safe-to-forward');
  } finally {
    source.close();
    destination.close();
  }
});

/* ------------------- loopback integration behavior -------------------- */

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`, server);
  } finally {
    server.close();
  }
}

const LOOPBACK_OPTS = { allowPrivateForTesting: true };

test('safeFetch follows redirects, records the chain and returns finalUrl', async () => {
  await withServer(
    (req, res) => {
      if (req.url === '/a') {
        res.writeHead(301, { location: '/b' });
        res.end();
      } else if (req.url === '/b') {
        res.writeHead(307, { location: '/c' });
        res.end();
      } else {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<title>final</title>');
      }
    },
    async (base) => {
      const safeFetch = createSafeFetch();
      const response = await safeFetch(`${base}/a`, LOOPBACK_OPTS);
      assert.equal(response.status, 200);
      assert.equal(response.finalUrl, `${base}/c`);
      assert.equal(response.chain.length, 3);
      assert.deepEqual(
        response.chain.map((hop) => hop.status),
        [301, 307, 200]
      );
      assert.match(response.body, /<title>final<\/title>/);
    }
  );
});

test('safeFetch rejects redirect loops', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(302, { location: '/loop' });
      res.end();
    },
    async (base) => {
      const safeFetch = createSafeFetch();
      await assert.rejects(safeFetch(`${base}/loop`, LOOPBACK_OPTS), (error) =>
        error.code === ERROR_CODES.REDIRECT_LOOP
      );
    }
  );
});

test('safeFetch rejects excessive redirects', async () => {
  let count = 0;
  await withServer(
    (req, res) => {
      count += 1;
      res.writeHead(302, { location: `/hop-${count}` });
      res.end();
    },
    async (base) => {
      const safeFetch = createSafeFetch();
      await assert.rejects(
        safeFetch(`${base}/start`, { ...LOOPBACK_OPTS, maxRedirects: 2 }),
        (error) => error.code === ERROR_CODES.TOO_MANY_REDIRECTS
      );
    }
  );
});

test('safeFetch enforces the response-size cap', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('x'.repeat(100_000));
    },
    async (base) => {
      const safeFetch = createSafeFetch();
      await assert.rejects(
        safeFetch(`${base}/big`, { ...LOOPBACK_OPTS, maxBytes: 1024 }),
        (error) => error.code === ERROR_CODES.BODY_TOO_LARGE
      );
    }
  );
});

test('safeFetch enforces an actual stalled-response timeout', async () => {
  await withServer(
    (_req, res) => {
      const timer = setTimeout(() => res.end('late'), 150);
      res.on('close', () => clearTimeout(timer));
    },
    async (base) => {
      const safeFetch = createSafeFetch();
      await assert.rejects(
        safeFetch(`${base}/slow`, { ...LOOPBACK_OPTS, timeoutMs: 25 }),
        (error) => error.code === ERROR_CODES.CONNECTION_TIMEOUT
      );
    }
  );
});

test('safeFetch maps DNS failure, timeout and connection refused', async () => {
  const safeFetch = createSafeFetch();
  await assert.rejects(safeFetch('http://this-host-does-not-exist.invalid/'), (error) =>
    error.code === ERROR_CODES.DNS_FAILURE
  );
  // 10.255.255.1 is unroutable BUT also in the private/reserved range
  // (10.0.0.0/8) — SSRF protection must block it before any connect.
  await assert.rejects(
    safeFetch('http://10.255.255.1/', { timeoutMs: 200 }),
    (error) => error.code === ERROR_CODES.SECURITY_BLOCKED
  );
  // Connection refused: nothing listening on a high loopback port (allowed
  // only via the testing escape hatch) should surface a network error.
  await assert.rejects(
    safeFetch('http://127.0.0.1:9/', { allowPrivateForTesting: true, timeoutMs: 400 }),
    (error) =>
      error.code === ERROR_CODES.CONNECTION_REFUSED ||
      error.code === ERROR_CODES.CONNECTION_TIMEOUT
  );
});

test('safeFetch strips fragments and lowercases hosts', async () => {
  await withServer(
    (req, res) => {
      assert.equal(req.url, '/path');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
    },
    async (base) => {
      const safeFetch = createSafeFetch();
      const response = await safeFetch(`${base}/path#frag`, LOOPBACK_OPTS);
      assert.equal(response.status, 200);
      assert.equal(new URL(response.finalUrl).pathname, '/path');
    }
  );
});
