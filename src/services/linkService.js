/**
 * LinkResurrector data layer. Vault records stay in chrome.storage.local;
 * recovery work runs through the local URL recovery API.
 *
 *   getLinks()             -> Promise<Link[]>
 *   addLink(partial)       -> Promise<{ added, reason?, link }>
 *   deleteLink(id)         -> Promise<void>
 *   updateLink(id, patch)  -> Promise<Link | null>
 *   checkAllLinks(opts)    -> Promise<Link[]>   // real recovery sweep
 *   getSettings()          -> Promise<Settings>
 *   setMonitoring(bool)    -> Promise<Settings>
 *   syncWithBackend()      -> Promise<{ synced, reason? }>
 *
 * UI components do not access storage directly.
 */

import { getBackendHealth, resurrectUrl } from './backend.js';

const LINKS_KEY = 'lr_links';
const SETTINGS_KEY = 'lr_settings';

/** Default cadence for the autonomous auto-check sweep (matches Chrome alarms). */
export const AUTO_CHECK_INTERVAL_MINUTES = 30;
export const AUTO_SYNC_LABEL = `Auto-Sync: Every ${AUTO_CHECK_INTERVAL_MINUTES}m`;
export const LINK_CATEGORIES = ['Work', 'Entertainment', 'Learning', 'Personal', 'Other', 'Uncategorized'];

const chromeStorage =
  typeof chrome !== 'undefined' ? chrome?.storage?.local : undefined;

/** True inside the extension runtime; false in browser preview. */
export const isExtensionEnv = Boolean(chromeStorage);

/**
 * Self-heal threshold. A real recovery job is bounded well below this
 * (client timeout 180s + bounded retries), so any link still marked
 * 'checking' after this long is debris from a crash/reload/interrupt.
 */
const CHECK_STALE_MS = 15 * 60_000;

/* ------------------------------------------------------------------ */
/* Low-level storage adapter (the ONLY place that knows about storage) */
/* ------------------------------------------------------------------ */

let memoryLinks = null;
let memorySettings = { monitoring: true };

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
 * Repairs vault damage so no user action is ever needed after a mishap:
 * - drops corrupt rows (not objects, missing id/url) so the UI can't break;
 * - un-sticks links left in 'checking' by a killed service worker, an
 *   extension reload, or a browser quit mid-check — restoring the honest
 *   pre-check status and recording why.
 * Returns a repaired array when something changed, otherwise null.
 */
function healLinks(links) {
  let changed = false;
  const healed = [];
  for (const raw of links) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.url !== 'string' || !raw.addedAt) {
      changed = true; // unrecoverable row: drop it rather than break the UI
      continue;
    }
    let link = raw;
    if (link.status === 'checking') {
      const startedAt = link.checkingStartedAt ?? 0;
      if (!startedAt || Date.now() - startedAt > CHECK_STALE_MS) {
        link = {
          ...link,
          status: link.prevStatus ?? 'dead',
          prevStatus: null,
          checkingStartedAt: null,
          checkingPhase: null,
          checkingDetail: null,
          lastError: {
            code: 'CHECK_INTERRUPTED',
            message: 'A previous check was interrupted before it finished and has been reset.',
          },
        };
        changed = true;
      }
    }
    healed.push(link);
  }
  return changed ? healed : null;
}

/**
 * Returns saved links. A new vault starts empty; recovery results are never
 * simulated or seeded as though they came from external providers.
 * Every read self-heals crash debris, so all views start from clean data.
 */
export async function getLinks() {
  const stored = await readStore(LINKS_KEY);
  if (!Array.isArray(stored)) {
    await writeStore(LINKS_KEY, []);
    return [];
  }
  const healed = healLinks(stored);
  if (healed) {
    await writeStore(LINKS_KEY, healed);
    return healed;
  }
  return stored;
}

/**
 * Adds a link (typically the current tab). De-duplicates by URL.
 * New links start in the `checking` state — the autonomous sweep
 * (or the next background alarm) resolves them automatically.
 * Accepts { url, title?, status?, statusCode? }.
 */
export async function addLink({ url, title, category = 'Uncategorized', status = 'checking', statusCode = null }) {
  if (!url || typeof url !== 'string') throw new Error('addLink: "url" is required');
  if (url.length > 2048) throw new Error('addLink: URL exceeds maximum length (2048 characters).');

  let normalizedUrl;
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname) {
      throw new Error('Only public HTTP and HTTPS URLs can be saved.');
    }
    normalizedUrl = parsed.href;
  } catch (error) {
    throw new Error(error.message || 'A valid website URL is required.');
  }

  const links = await getLinks();
  const existing = links.find((link) => link.url === normalizedUrl);
  if (existing) return { added: false, reason: 'duplicate', link: existing };

  const sanitizedTitle = title ? String(title).trim().slice(0, 300) : normalizedUrl;

  const link = {
    id: uid(),
    title: sanitizedTitle || normalizedUrl,
    url: normalizedUrl,
    category: LINK_CATEGORIES.includes(category) ? category : 'Uncategorized',
    status,
    statusCode,
    addedAt: Date.now(),
    checkingStartedAt: Date.now(),
    lastChecked: null,
  };
  await writeStore(LINKS_KEY, [link, ...links]);
  return { added: true, link };
}

/** Removes a link by id. */
export async function deleteLink(id) {
  if (typeof id !== 'string') return;
  const links = await getLinks();
  await writeStore(
    LINKS_KEY,
    links.filter((link) => link.id !== id)
  );
}

/** Patch-merges a link (status transitions, health-check results, …). */
export async function updateLink(id, patch) {
  if (typeof id !== 'string' || !patch || typeof patch !== 'object') return null;
  const safePatch = {};
  for (const [key, val] of Object.entries(patch)) {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      safePatch[key] = val;
    }
  }
  const links = await getLinks();
  let updated = null;
  const next = links.map((link) => {
    if (link.id !== id) return link;
    updated = { ...link, ...safePatch };
    return updated;
  });
  if (updated) await writeStore(LINKS_KEY, next);
  return updated;
}

/* ------------------------------------------------------------------ */
/* Settings API                                                        */
/* ------------------------------------------------------------------ */

export async function getSettings() {
  const stored = await readStore(SETTINGS_KEY);
  return { monitoring: true, ...(stored ?? {}) };
}

export async function setMonitoring(enabled) {
  const settings = await getSettings();
  const next = { ...settings, monitoring: Boolean(enabled) };
  await writeStore(SETTINGS_KEY, next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Real backend recovery                                               */
/* ------------------------------------------------------------------ */

export function resultToLinkPatch(result) {
  const finalResult = result?.finalResult;
  const originalStatus = result?.originalStatus ?? {};
  const verified = Boolean(finalResult?.verified && finalResult?.url);
  const exactItemInactive = Boolean(finalResult?.exactItemInactive);
  // A redirected, parked, or deep SPA item original no longer serves the original resource:
  // treat it as not-live so the vault shows 'resurrected' (switched to website) or 'dead'
  // instead of a misleading 'active'.
  const originalReachable = Boolean(originalStatus.reachable) && !originalStatus.suspect && !exactItemInactive;
  return {
    status: verified ? 'resurrected' : originalReachable ? 'active' : 'dead',
    statusCode: originalStatus.httpStatus ?? null,
    successorUrl: verified ? finalResult.url : null,
    successorVerified: verified,
    confidenceScore: verified ? finalResult.confidenceScore : null,
    pageRecovered: verified ? Boolean(finalResult.pageRecovered) : false,
    recoveredPageUrl: verified ? (finalResult.recoveredPageUrl ?? null) : null,
    exactItemInactive,
    archiveUrl: result?.wayback?.fallbackUrl ?? null,
    recoveryResult: result,
    recoveryCheckedAt: result?.completedAt ?? Date.now(),
    prevStatus: null,
    checkingPhase: null,
    checkingDetail: null,
    lastError: null,
    lastChecked: Date.now(),
  };
}

/** Runs one real recovery job for a saved URL. */
export async function checkLinkById(id, { onUpdate, onProgress } = {}) {
  const link = (await getLinks()).find((item) => item.id === id);
  if (!link) return null;

  // Remember the pre-check status so a killed helper/disconnect can restore
  // it — this also un-sticks links left in 'checking' by an earlier crash.
  const prevStatus = link.status === 'checking' ? (link.prevStatus ?? 'dead') : link.status;

  const started = await updateLink(link.id, {
    status: 'checking',
    prevStatus,
    checkingStartedAt: Date.now(),
    checkingPhase: 'initializing',
    checkingDetail: 'Starting recovery job.',
    lastError: null,
  });
  onUpdate?.(started ?? { ...link, status: 'checking' });
  try {
    const result = await resurrectUrl(link.url, {
      titleHint: link.title,
      onProgress: async (event) => {
        const phasePatch = {
          status: 'checking',
          checkingPhase: event.phase ?? 'investigating',
          checkingDetail: event.detail ?? '',
        };
        const updated = await updateLink(link.id, phasePatch);
        onProgress?.({ linkId: link.id, ...event });
        onUpdate?.(updated ?? { ...link, ...phasePatch });
      },
    });
    const updated = await updateLink(link.id, { ...resultToLinkPatch(result), prevStatus: null });
    onUpdate?.(updated ?? { ...link, ...resultToLinkPatch(result) });
    return updated;
  } catch (error) {
    const patch = {
      // Restore the honest pre-check status; never leave a link in 'checking'.
      status: prevStatus === 'checking' ? 'dead' : prevStatus,
      prevStatus: null,
      checkingStartedAt: null,
      checkingPhase: null,
      checkingDetail: null,
      lastError: { code: error?.code ?? 'BACKEND_ERROR', message: String(error?.message ?? error) },
      lastChecked: Date.now(),
    };
    const updated = await updateLink(link.id, patch);
    onUpdate?.(updated ?? { ...link, ...patch });
    return updated;
  }
}

/** Runs a real recovery job for each saved URL and forwards backend phases. */
export async function checkAllLinks({ onUpdate, onProgress } = {}) {
  const links = await getLinks();
  for (const link of links) await checkLinkById(link.id, { onUpdate, onProgress });
  return getLinks();
}

/* ------------------------------------------------------------------ */
/* Backend availability                                                  */
/* ------------------------------------------------------------------ */

/**
 * Reports whether the recovery API is available. The current API does not
 * synchronize vault data, so this function never claims that it did.
 */
export async function syncWithBackend() {
  try {
    const health = await getBackendHealth();
    return {
      synced: false,
      available: true,
      health,
      reason: 'The on-device native helper accepts recovery jobs; vault data stays in this browser profile.',
    };
  } catch (error) {
    return { synced: false, reason: String(error?.message ?? error) };
  }
}
