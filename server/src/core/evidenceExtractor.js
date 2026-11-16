/**
 * Historical migration evidence extractor (Phase 5).
 *
 * Turns archived (or live) HTML into CLASSIFIED candidate evidence. Every
 * candidate carries its discovery source so the confidence engine can weigh
 * and de-duplicate it later. Extracted URLs are evidence, not assumptions:
 * unrelated/advertising/infra links are filtered out.
 */

import { extractIdentity, isInfraHost } from '../util/html.js';
import { hostOf, parseAndValidateUrl, registrableDomain } from '../util/url.js';

const ANNOUNCEMENT_SOURCE = 'official_migration_announcement';

/** Static assets are never a successor website, however they were extracted. */
const ASSET_PATH = /\.(?:avif|bmp|css|eot|gif|ico|jpe?g|js|json|map|mp3|mp4|ogg|otf|pdf|png|rss|svg|ttf|webm|webp|woff2?|xml|zip)$/i;

export function createEvidenceExtractor({ logger }) {
  /**
   * @param {string} html archived or live HTML
   * @param {string} pageUrl absolute URL of the page
   * @param {object} [existing] health record to enrich
   * @returns {{ identity: object, candidates: Array, announcements: Array }}
   */
  return function extractEvidence(html, pageUrl, existing = {}) {
    const identity = existing.identity ?? extractIdentity(html, pageUrl);
    const selfHost = hostOf(pageUrl);
    const selfRegistrable = registrableDomain(selfHost);

    const candidates = [];
    const seen = new Set();

    const push = (url, source, context = '') => {
      let parsed;
      try {
        parsed = parseAndValidateUrl(url);
      } catch {
        return; // invalid extraction — discard, never assume
      }
      const host = parsed.hostname;
      if (!host || host === selfHost) return;
      if (ASSET_PATH.test(parsed.pathname)) return;
      // Namespace URIs (e.g. https://ogp.me/ns#, https://schema.org/VideoObject)
      // are markup vocabulary, not websites — a fragment means "identifier".
      if (parsed.hash) return;
      if (isInfraHost(host) || host.endsWith('.archive.org') || host === 'web.archive.org') return;
      const key = `${registrableDomain(host)}|${source}`;
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({
        url: parsed.href,
        host,
        registrableDomain: registrableDomain(host),
        source,
        context: String(context).slice(0, 300),
        path: parsed.pathname,
      });
    };

    // Structured hints (historical): meta refresh, canonical, og:url.
    if (identity.metaRefresh) push(identity.metaRefresh, 'meta_refresh', 'meta refresh tag');
    if (identity.canonical && hostOf(identity.canonical) !== selfHost) {
      push(identity.canonical, 'canonical_url', 'link rel=canonical');
    }
    if (identity.ogUrl && hostOf(identity.ogUrl) !== selfHost) {
      push(identity.ogUrl, 'canonical_url', 'og:url');
    }

    // Migration announcements with nearby URLs — the strongest textual signal.
    const announcements = [];
    for (const announcement of identity.announcements ?? []) {
      announcements.push({ text: announcement.text, phrase: announcement.phrase, urls: announcement.urls });
      for (const url of announcement.urls ?? []) {
        push(url, ANNOUNCEMENT_SOURCE, announcement.phrase);
      }
    }

    // External references: only same-branching hosts that plausibly continue
    // the site (same registrable root family or referenced from an
    // announcement window). Plain external links are the weakest evidence
    // and are recorded for ranking but flagged accordingly.
    for (const link of (identity.externalLinks ?? []).slice(0, 40)) {
      if (isInfraHost(link.host)) continue;
      const linkRegistrable = registrableDomain(link.host);
      if (linkRegistrable === selfRegistrable) continue; // e.g. www → apex is same site
      push(link.url, 'external_reference', 'historical page link');
    }

    return { identity, candidates, announcements };
  };
}
