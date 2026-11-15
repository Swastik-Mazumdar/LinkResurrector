/**
 * LinkResurrector — MV3 service worker (background.js).
 *
 * Deliberately dependency-free: Vite bundles this single entry straight to
 * `dist/background.js` so it can run as a classic (non-module) service
 * worker, exactly as declared in manifest.json.
 *
 * The periodic health-check is a placeholder for the future backend checker:
 * swap `runHealthCheck()` internals for batched API calls when the backend
 * ships — the storage shape (src/services/linkService.js) already matches.
 */

const LINKS_KEY = 'lr_links';
const ALARM_NAME = 'lr-health-check';
// Keep in sync with AUTO_CHECK_INTERVAL_MINUTES in src/services/linkService.js
const CHECK_INTERVAL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runHealthCheck();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LR_GET_STATUS') {
    sendResponse({ ok: true, engine: 'ready', mode: 'local-storage' });
  }
  return false;
});

async function runHealthCheck() {
  const { [LINKS_KEY]: links } = await chrome.storage.local.get(LINKS_KEY);
  if (!Array.isArray(links) || links.length === 0) return;

  // TODO(backend): replace with batched HEAD/GET checks (or a backend API
  // call) and persist { status, statusCode, lastChecked } per link.
  const checked = links.map((link) => ({ ...link }));
  await chrome.storage.local.set({ [LINKS_KEY]: checked });
}
