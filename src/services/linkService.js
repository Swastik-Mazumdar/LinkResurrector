/**
 * LinkResurrector — Backend-ready data layer.
 *
 * Today this reads/writes `chrome.storage.local` (with a realistic in-memory
 * fallback for plain-browser previewing). Tomorrow the same clean async API
 * is all the UI needs to talk to a real backend:
 *
 *   getLinks()             -> Promise<Link[]>
 *   addLink(partial)       -> Promise<{ added, reason?, link }>
 *   deleteLink(id)         -> Promise<void>
 *   updateLink(id, patch)  -> Promise<Link | null>
 *   checkAllLinks(opts)    -> Promise<Link[]>   // autonomous sweep
 *   getSettings()          -> Promise<Settings>
 *   setMonitoring(bool)    -> Promise<Settings>
 *   syncWithBackend()      -> Promise<{ synced, reason? }>
 *
 * No UI component touches storage directly — swap the internals here when
 * the backend checker ships and the whole app keeps working unchanged.
 */

import { MOCK_LINKS } from '../data/mockData.js';

const LINKS_KEY = 'lr_links';
const SETTINGS_KEY = 'lr_settings';

/** Default cadence for the autonomous auto-check sweep (matches Chrome alarms). */
export const AUTO_CHECK_INTERVAL_MINUTES = 30;
export const AUTO_SYNC_LABEL = `Auto-Sync: Every ${AUTO_CHECK_INTERVAL_MINUTES}m`;

const CHECK_ROUND_MS = AUTO_CHECK_INTERVAL_MINUTES * 60 * 1000;
const ARCHIVE_BASE = 'https://web.archive.org/web/';

const chromeStorage =
  typeof chrome !== 'undefined' ? chrome?.storage?.local : undefined;

/** True inside the extension runtime; false in browser preview. */
export const isExtensionEnv = Boolean(chromeStorage);

/* ------------------------------------------------------------------ */
/* Low-level storage adapter (the ONLY place that knows about storage) */
/* ------------------------------------------------------------------ */

let memoryLinks = null;
let memorySettings = { monitoring: true, backendEndpoint: '' };

async function readStore(key) {
  if (isExtensionEnv) {
    const result = await chromeStorage.get(key);
    return result[key];
  }
  return key === LINKS_KEY ? memoryLinks : memorySettings;
}

async function writeStore(key, value) {
  if (isExtensionEnv) {
    await chromeStorage.set({ [key]: value });
    return;
  }
  if (key === LINKS_KEY) memoryLinks = value;
  else memorySettings = { ...memorySettings, ...value };
}

function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `lr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );
}

/* ------------------------------------------------------------------ */
/* Links API                                                           */
/* ------------------------------------------------------------------ */

/**
 * Returns every saved link. Seeds realistic mock data on first run so the
 * popup/dashboard never render an empty skeleton.
 */
export async function getLinks() {
  const stored = await readStore(LINKS_KEY);
  if (Array.isArray(stored) && stored.length > 0) return stored;

  const seeded = MOCK_LINKS.map((link) => ({ ...link }));
  await writeStore(LINKS_KEY, seeded);
  return seeded;
}

/**
 * Adds a link (typically the current tab). De-duplicates by URL.
 * New links start in the `checking` state — the autonomous sweep
 * (or the next background alarm) resolves them automatically.
 * Accepts { url, title?, status?, statusCode? }.
 */
export async function addLink({ url, title, status = 'checking', statusCode = null }) {
  if (!url) throw new Error('addLink: "url" is required');

  const links = await getLinks();
  const existing = links.find((link) => link.url === url);
  if (existing) return { added: false, reason: 'duplicate', link: existing };

  const link = {
    id: uid(),
    title: title?.trim() || url,
    url,
    status,
    statusCode,
    addedAt: Date.now(),
    lastChecked: null,
  };
  await writeStore(LINKS_KEY, [link, ...links]);
  return { added: true, link };
}

/** Removes a link by id. */
export async function deleteLink(id) {
  const links = await getLinks();
  await writeStore(
    LINKS_KEY,
    links.filter((link) => link.id !== id)
  );
}

/** Patch-merges a link (status transitions, health-check results, …). */
export async function updateLink(id, patch) {
  const links = await getLinks();
  let updated = null;
  const next = links.map((link) => {
    if (link.id !== id) return link;
    updated = { ...link, ...patch };
    return updated;
  });
  if (updated) await writeStore(LINKS_KEY, next);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Autonomous auto-check & auto-resurrection                           */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stable 32-bit FNV-1a hash — keeps simulated outcomes deterministic per round. */
function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function archiveUrlFor(url, seed) {
  const year = 2023 + (seed % 3); // 2023–2025 snapshot
  return `${ARCHIVE_BASE}${year}/${url}`;
}

/**
 * Pure simulation of one auto-check round for a link.
 *
 * TODO(backend): replace with a real HEAD/GET against `url` plus an archive
 * availability query (Wayback CDX / backend API). The status transitions and
 * persisted shape stay identical.
 *
 * Lifecycle rules:
 *   dead          -> sticky: stays Dead Permanently, timestamp refreshed
 *   resurrected   -> archive re-verified, stays Resurrected
 *   active        -> usually stays live; small chance the URL has rotted
 *   checking      -> brand-new/unresolved link: 70% live, else archive sweep
 */
function simulateCheck(link, round) {
  const lastChecked = Date.now();

  if (link.status === 'dead') {
    return { status: 'dead', statusCode: 404, lastChecked };
  }
  if (link.status === 'resurrected') {
    return { status: 'resurrected', statusCode: 200, lastChecked };
  }

  const aliveChance = link.status === 'checking' ? 70 : 88;
  const alive = hashStr(`${link.id}:${round}:live`) % 100 < aliveChance;
  if (alive) {
    return { status: 'active', statusCode: 200, lastChecked };
  }

  const seed = hashStr(`${link.id}:${round}:archive`);
  if (seed % 100 < 60) {
    return {
      status: 'resurrected',
      statusCode: 200,
      archiveUrl: archiveUrlFor(link.url, seed),
      lastChecked,
    };
  }
  return { status: 'dead', statusCode: 404, archiveUrl: null, lastChecked };
}

/**
 * Runs one full autonomous sweep across every link:
 * broken/unresolved links pass through `checking` and land on
 * `resurrected` (archive found) or `dead` (no archive), while live links
 * simply get their `lastChecked` refreshed.
 *
 * @param {{ onUpdate?: (link: object) => void, pace?: number }} [opts]
 * `onUpdate` fires twice per link (entering + leaving `checking`) so the
 * dashboard can animate the sweep live without re-reading storage.
 */
export async function checkAllLinks({ onUpdate, pace = 380 } = {}) {
  const links = await getLinks();
  const round = Math.floor(Date.now() / CHECK_ROUND_MS);

  for (const link of links) {
    await updateLink(link.id, { status: 'checking' });
    onUpdate?.({ ...link, status: 'checking' });

    await sleep(pace + (hashStr(link.id) % 240));

    const patch = simulateCheck(link, round);
    const updated = await updateLink(link.id, patch);
    onUpdate?.(updated ?? { ...link, status: 'checking', ...patch });
  }

  return getLinks();
}

/* ------------------------------------------------------------------ */
/* Settings API                                                        */
/* ------------------------------------------------------------------ */

export async function getSettings() {
  const stored = await readStore(SETTINGS_KEY);
  return { monitoring: true, backendEndpoint: '', ...(stored ?? {}) };
}

export async function setMonitoring(enabled) {
  const settings = await getSettings();
  const next = { ...settings, monitoring: Boolean(enabled) };
  await writeStore(SETTINGS_KEY, next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Backend sync (forward-compatible placeholder)                       */
/* ------------------------------------------------------------------ */

/**
 * Pushes the local vault to the backend once an endpoint is configured in
 * settings. Until then it resolves gracefully so the UI can surface an
 * honest "local-only" status instead of a fake success.
 */
export async function syncWithBackend() {
  const { backendEndpoint } = await getSettings();

  if (!backendEndpoint) {
    return {
      synced: false,
      reason: 'No backend endpoint configured — vault is running local-first.',
    };
  }

  try {
    const links = await getLinks();
    const response = await fetch(`${backendEndpoint.replace(/\/+$/, '')}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ links }),
    });
    if (!response.ok) throw new Error(`Backend responded ${response.status}`);
    return { synced: true };
  } catch (error) {
    return { synced: false, reason: String(error?.message ?? error) };
  }
}
