/** MV3 service worker: real, bounded recovery sweeps on the configured cadence. */

import { checkAllLinks, checkLinkById, getSettings } from './services/linkService.js';

const ALARM_NAME = 'lr-health-check';
const CHECK_INTERVAL_MINUTES = 30;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: CHECK_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void runHealthCheck();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'LR_GET_STATUS') {
    sendResponse({ ok: true, engine: 'ready', mode: 'native-messaging' });
    return false;
  }
  if (message?.type === 'LR_RUN_RECOVERY') {
    void runHealthCheck().then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ ok: false, error: String(error?.message ?? error) });
    });
    return true;
  }
  if (message?.type === 'LR_RECOVER_LINK') {
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
