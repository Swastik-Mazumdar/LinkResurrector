/**
 * IP classification for SSRF protection (Phase 12).
 *
 * Every resolved address must pass `isPrivateIp` === false before any
 * connection is attempted — including at connect time via the safe
 * fetcher's custom DNS lookup (anti DNS-rebinding).
 */

import net from 'node:net';

const IPV4_PRIVATE_RANGES = [
  { start: 0, end: 0 }, // 0.0.0.0/8 "this network"
  { start: 10, end: 10 }, // 10.0.0.0/8 private
  { start: 100, end: 100, minSecond: 64, maxSecond: 127 }, // 100.64/10 CGNAT
  { start: 127, end: 127 }, // loopback
  { start: 169, end: 169, minSecond: 254, maxSecond: 254 }, // link-local + cloud metadata
  { start: 172, end: 172, minSecond: 16, maxSecond: 31 }, // 172.16/12 private
  { start: 192, end: 192, minSecond: 0, maxSecond: 0 }, // 192.0.0.0/24
  { start: 192, end: 192, minSecond: 2, maxSecond: 2 }, // TEST-NET-1
  { start: 192, end: 192, minSecond: 168, maxSecond: 168 }, // 192.168/16 private
  { start: 198, end: 198, minSecond: 18, maxSecond: 19 }, // benchmarking
  { start: 198, end: 198, minSecond: 51, maxSecond: 51 }, // TEST-NET-2
  { start: 203, end: 203, minSecond: 0, maxSecond: 113 }, // TEST-NET-3
  { start: 224, end: 255 }, // multicast + reserved + broadcast
];

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // unparseable → treat as unsafe
  }
  const [a, b] = parts;
  return IPV4_PRIVATE_RANGES.some(
    (r) =>
      a >= r.start &&
      a <= r.end &&
      (r.minSecond === undefined || (b >= r.minSecond && b <= r.maxSecond))
  );
}

/** Expands an IPv6 string into 8 16-bit groups; null when unparseable. */
export function expandIPv6(ip) {
  let cleaned = ip.toLowerCase();
  // Strip zone id (fe80::1%en0)
  const zoneIndex = cleaned.indexOf('%');
  if (zoneIndex !== -1) cleaned = cleaned.slice(0, zoneIndex);

  const parseV4Tail = (group) => {
    if (!group.includes('.')) return null;
    const parts = group.split('.').map(Number);
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
      return null;
    }
    return [
      ((parts[0] << 8) | parts[1]).toString(16),
      ((parts[2] << 8) | parts[3]).toString(16),
    ];
  };

  let head = cleaned;
  let tail = '';
  const doubleColon = cleaned.indexOf('::');
  if (doubleColon !== -1) {
    head = cleaned.slice(0, doubleColon);
    tail = cleaned.slice(doubleColon + 2);
  }

  let headGroups = head ? head.split(':') : [];
  let tailGroups = tail ? tail.split(':') : [];

  // IPv4-mapped tails (::ffff:1.2.3.4, ::1.2.3.4, 64:ff9b::1.2.3.4)
  const headTailV4 = headGroups.length ? parseV4Tail(headGroups[headGroups.length - 1]) : null;
  if (headTailV4) headGroups = [...headGroups.slice(0, -1), ...headTailV4];
  const tailTailV4 = tailGroups.length ? parseV4Tail(tailGroups[tailGroups.length - 1]) : null;
  if (tailTailV4) tailGroups = [...tailGroups.slice(0, -1), ...tailTailV4];

  const missing = 8 - (headGroups.length + tailGroups.length);
  if (doubleColon === -1 && headGroups.length + tailGroups.length !== 8) return null;
  if (missing < 0) return null;

  const groups =
    doubleColon === -1
      ? headGroups
      : [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  if (groups.length !== 8) return null;

  const ints = groups.map((g) => Number.parseInt(g || '0', 16));
  if (ints.some((n) => !Number.isFinite(n) || n < 0 || n > 0xffff)) return null;
  return ints;
}

function isPrivateIPv6(ip) {
  const groups = expandIPv6(ip);
  if (!groups) return true; // unparseable → treat as unsafe

  const allZero = groups.every((g) => g === 0);
  if (allZero) return true; // unspecified ::
  if (groups[7] === 1 && groups.slice(0, 7).every((g) => g === 0)) return true; // ::1 loopback

  const firstByte = groups[0] >> 8;
  const secondByte = groups[0] & 0xff;

  // fc00::/7 unique local
  if (firstByte >= 0xfc && firstByte <= 0xfd) return true;
  // fe80::/10 link-local
  if (firstByte === 0xfe && secondByte < 0xc0) return true;
  // ff00::/8 multicast
  if (firstByte === 0xff) return true;

  // IPv4-mapped ::ffff:0:0/96
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    return isPrivateIPv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`);
  }

  // 6to4 2002::/16 — embedded IPv4 in groups[1..2]
  if (groups[0] === 0x2002) {
    return isPrivateIPv4(
      `${groups[1] >> 8}.${groups[1] & 0xff}.${groups[2] >> 8}.${groups[2] & 0xff}`
    );
  }

  // NAT64 64:ff9b::/96 — embedded IPv4 in groups[6..7]
  if (groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0)) {
    return isPrivateIPv4(`${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`);
  }

  // Teredo 2001::/32 — embeds obfuscated client v4 (documented limitation:
  // treated conservatively as private to be safe).
  if (groups[0] === 0x2001 && groups[1] === 0) return true;

  return false;
}

/** True when the address must never be contacted by the recovery engine. */
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true;
}
