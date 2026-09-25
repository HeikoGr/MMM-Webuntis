/**
 * Short-lived cache for WebUntis GET responses.
 *
 * Several module instances with the same account (e.g. one per carousel slide) refresh on
 * their own timers and would otherwise ask the school server for the same data within
 * minutes. An entry is keyed by the account (credKey), the server, the endpoint, the school
 * year and the request parameters, so different accounts, students or date ranges never
 * share one. Only successful responses are stored.
 */

// The longest a response is reused; a shorter updateInterval shortens it (see maxAgeFor).
const MAX_AGE_CAP_MS = 4 * 60 * 1000;
const MAX_ENTRIES = 500;

/**
 * How old a reused response may be for a session: 80% of its updateInterval, so the data a
 * display shows is never older than its own polling would leave it, capped at 4 minutes.
 *
 * @param {Object} config - Session config (updateInterval)
 * @returns {number} Maximum age in milliseconds, 0 = no reuse
 */
function maxAgeFor(config) {
  const interval = Number(config?.updateInterval);
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  return Math.min(MAX_AGE_CAP_MS, Math.floor(interval * 0.8));
}

/**
 * @param {Object} parts - { scope, server, path, schoolYearId, params }
 * @returns {string} Cache key
 */
function buildKey({ scope, server, path, schoolYearId, params }) {
  const sortedParams = Object.keys(params || {})
    .sort()
    .filter((key) => params[key] !== undefined && params[key] !== null)
    .map((key) => [key, String(params[key])]);
  return JSON.stringify([scope, server, path, schoolYearId ?? null, sortedParams]);
}

/**
 * @param {Object} [options] - { now } (tests inject a clock)
 * @returns {{ get: Function, set: Function, clear: Function, size: Function }}
 */
function createResponseCache(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => Date.now();
  const entries = new Map();

  const prune = () => {
    const current = now();
    for (const [key, entry] of entries) {
      if (current - entry.storedAt >= MAX_AGE_CAP_MS) entries.delete(key);
    }
    // Map keeps insertion order: drop the oldest beyond the limit.
    while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  };

  return {
    /**
     * @param {string} key - From buildKey()
     * @param {number} maxAgeMs - Oldest acceptable entry for this caller
     * @returns {Object|undefined} A copy of { data, status }, callers may mutate it
     */
    get(key, maxAgeMs) {
      const entry = entries.get(key);
      if (!entry || !(maxAgeMs > 0) || now() - entry.storedAt >= maxAgeMs) return undefined;
      return structuredClone(entry.value);
    },
    set(key, value) {
      entries.delete(key);
      entries.set(key, { value: structuredClone(value), storedAt: now() });
      prune();
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

module.exports = { MAX_AGE_CAP_MS, buildKey, createResponseCache, maxAgeFor };
