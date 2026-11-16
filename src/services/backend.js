/** Client for the on-device Chrome Native Messaging recovery helper. */

export const NATIVE_HOST_NAME = 'com.linkresurrector.native';
const REQUEST_TIMEOUT_MS = 180_000;

export function getBackendHealth() {
  return requestNative('health');
}

export function verifyUrl(url) {
  return requestNative('verify', { url });
}

/** Runs recovery on the user's computer and forwards actual engine phases. */
export function resurrectUrl(url, { onProgress = () => {}, titleHint } = {}) {
  return requestNative('recover', { url, titleHint }, onProgress);
}

function requestNative(type, payload = {}, onProgress = () => {}) {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.connectNative !== 'function') {
    const error = new Error('Open LinkResurrector in Chrome or Brave to use its native recovery helper.');
    error.code = 'NATIVE_HELPER_UNAVAILABLE';
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (cause) {
      const error = new Error('The LinkResurrector native helper is not installed or is not allowed for this extension.');
      error.code = 'NATIVE_HELPER_UNAVAILABLE';
      error.cause = cause;
      reject(error);
      return;
    }

    const requestId = globalThis.crypto?.randomUUID?.() ?? `lr_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    let settled = false;
    const timeout = setTimeout(() => {
      const error = new Error('The on-device recovery helper took too long to respond.');
      error.code = 'CONNECTION_TIMEOUT';
      finish(reject, error);
    }, REQUEST_TIMEOUT_MS);

    function finish(handler, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try { port.disconnect(); } catch { /* port may already be closed */ }
      handler(value);
    }

    port.onMessage.addListener((message) => {
      if (message?.requestId !== requestId) return;
      if (message.type === 'progress') {
        onProgress({ phase: message.phase, detail: message.detail, ts: Date.now() });
      } else if (message.type === 'done') {
        finish(resolve, message.result);
      } else if (message.type === 'error') {
        const error = new Error(message.error?.message ?? 'Native recovery failed.');
        error.code = message.error?.code ?? 'INTERNAL_SERVER_ERROR';
        finish(reject, error);
      }
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      const detail = chrome.runtime.lastError?.message;
      const error = new Error(detail
        ? `Native helper disconnected: ${detail}`
        : 'Native helper disconnected before the recovery finished.');
      error.code = 'NATIVE_HELPER_DISCONNECTED';
      finish(reject, error);
    });

    try {
      port.postMessage({ requestId, type, ...payload });
    } catch (cause) {
      const error = new Error('Could not send a request to the native recovery helper.');
      error.code = 'NATIVE_HELPER_UNAVAILABLE';
      error.cause = cause;
      finish(reject, error);
    }
  });
}
