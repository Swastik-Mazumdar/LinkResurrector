/** Tiny TTL cache + counters (Phase 16). In-memory, process-local. */

export function createTtlCache(ttlMs, maxSize = 500) {
  const store = new Map(); // key -> { value, expiresAt }

  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      if (store.size >= maxSize) {
        const oldest = [...store.entries()].sort(
          (a, b) => a[1].expiresAt - b[1].expiresAt
        )[0];
        if (oldest) store.delete(oldest[0]);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    has(key) {
      return this.get(key) !== undefined;
    },
    size() {
      return store.size;
    },
    clear() {
      store.clear();
    },
  };
}

/** Minimum-interval gate for respectful provider rate limits (Phase 4 #11). */
export function createRateGate(minIntervalMs) {
  let lastAt = 0;
  let chain = Promise.resolve();
  return function gated(run) {
    chain = chain.then(async () => {
      const wait = Math.max(0, lastAt + minIntervalMs - Date.now());
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastAt = Date.now();
    });
    return chain.then(run);
  };
}
