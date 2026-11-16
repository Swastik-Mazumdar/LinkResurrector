/** MV3 service worker: real, bounded recovery sweeps on the configured cadence. */

import { checkAllLinks, checkLinkById, getSettings } from './services/linkService.js';

const ALARM_NAME = 'lr-health-check';
const CHECK_INTERVAL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

// Self-heal: the alarm can be lost to cleared storage or a partial install.
// Every service-worker wake verifies it exists and recreates it if missing,
// so monitoring resumes without any user action.
chrome.alarms.get(ALARM_NAME, (existing) => {
  if (!existing) chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void runHealthCheck();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'LR_GET_STATUS') {
    sendResponse({ ok: true, engine: 'ready', mode: 'native-messaging' });
    return false;
  }
  if (message.type === 'LR_RUN_RECOVERY') {
    void runHealthCheck().then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message ?? error) });
    });
    return true;
  }
  if (message.type === 'LR_RECOVER_LINK') {
    if (typeof message.linkId !== 'string') {
      sendResponse({ ok: false, error: 'Invalid linkId' });
      return false;
    }
    void checkLinkById(message.linkId).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message ?? error) });
    });
    return true;
  }
  return false;
});

async function runHealthCheck() {
  const settings = await getSettings();
  if (!settings.monitoring) return;
  await checkAllLinks();
}
