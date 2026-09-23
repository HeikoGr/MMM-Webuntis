/**
 * Bookkeeping of frontend sessions.
 *
 * The frontend generates a fresh sessionId on every start (page reload, Electron restart,
 * MMM-Remote-Control restart) while the node_helper process survives. Each session gets its own
 * config clone (a session may override debugDate) and its own paused flag; sessions that stop
 * reporting are released after a TTL so credentials-bearing config clones do not accumulate.
 *
 * Eviction is time-based rather than "drop every other session of this identifier", because
 * MagicMirror legitimately serves several clients (the mirror plus a phone browser) that share
 * one identifier but hold distinct sessionIds. Those keep refreshing and therefore stay alive.
 */

const DEFAULT_IDENTIFIER = "default";
const DEFAULT_SESSION_ID = "unknown";

const SESSION_TTL_DEFAULT_MS = 5 * 60 * 1000;
const SESSION_TTL_MIN_MS = 10 * 60 * 1000;
const SESSION_TTL_MAX_MS = 60 * 60 * 1000;

/**
 * Build routing metadata from an incoming request payload.
 *
 * @param {Object} payload - Request payload with `id` and `sessionId`
 * @returns {{identifier: string, sessionId: string, sessionKey: string}}
 */
function buildRouteMeta(payload = {}) {
  const identifier = payload.id || DEFAULT_IDENTIFIER;
  const sessionId = payload.sessionId || DEFAULT_SESSION_ID;
  return {
    identifier,
    sessionId,
    sessionKey: `${identifier}:${sessionId}`,
  };
}

/**
 * Parse compound session key format `identifier:sessionId`.
 *
 * @param {string} sessionKey - Session key
 * @returns {{identifier: string, sessionId: string}} Parsed parts
 */
function parseSessionKey(sessionKey) {
  const raw = String(sessionKey || `${DEFAULT_IDENTIFIER}:${DEFAULT_SESSION_ID}`);
  const idx = raw.indexOf(":");
  if (idx === -1) {
    return { identifier: raw || DEFAULT_IDENTIFIER, sessionId: DEFAULT_SESSION_ID };
  }
  return {
    identifier: raw.slice(0, idx) || DEFAULT_IDENTIFIER,
    sessionId: raw.slice(idx + 1) || DEFAULT_SESSION_ID,
  };
}

/**
 * Silence period before a session of the same identifier is released: two update cycles of
 * headroom, clamped so that neither a very short nor a very long updateInterval produces a
 * pathological TTL.
 *
 * @param {Object} config - Normalized module config
 * @returns {number} TTL in milliseconds
 */
function getSessionTtlMs(config = {}) {
  const updateInterval = Number(config?.updateInterval);
  const base = Number.isFinite(updateInterval) && updateInterval > 0 ? updateInterval : SESSION_TTL_DEFAULT_MS;
  return Math.min(Math.max(base * 2, SESSION_TTL_MIN_MS), SESSION_TTL_MAX_MS);
}

class SessionRegistry {
  /**
   * @param {Object} [options]
   * @param {Function} [options.logger] - (level, student, message) logger
   * @param {Function} [options.onRelease] - called with each released sessionKey
   */
  constructor(options = {}) {
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this.onRelease = typeof options.onRelease === "function" ? options.onRelease : () => {};
    this.configsByIdentifier = new Map();
    this.configsBySession = new Map();
    this.pausedSessions = new Set();
    this.lastSeenAt = new Map();
  }

  /** Record frontend contact for a session (CONFIGURE, REFRESH, SESSION_STATE). */
  touch(sessionKey) {
    if (!sessionKey) return;
    this.lastSeenAt.set(sessionKey, Date.now());
  }

  /**
   * Release per-session state for sessions of the same identifier that went silent.
   *
   * @param {string} sessionKey - Session key whose identifier should be swept
   * @param {number} ttlMs - Silence period after which a session is considered gone
   * @returns {string[]} Released session keys
   */
  releaseStale(sessionKey, ttlMs) {
    const { identifier } = parseSessionKey(sessionKey);
    const cutoff = Date.now() - ttlMs;
    const candidateKeys = new Set([...this.configsBySession.keys(), ...this.pausedSessions, ...this.lastSeenAt.keys()]);
    const stale = [];

    for (const candidateKey of candidateKeys) {
      if (candidateKey === sessionKey) continue;
      if (parseSessionKey(candidateKey).identifier !== identifier) continue;
      // Unknown last-seen means the session predates tracking - treat it as stale.
      const seenAt = this.lastSeenAt.get(candidateKey) ?? 0;
      if (seenAt > cutoff) continue;
      stale.push(candidateKey);
    }

    for (const staleKey of stale) {
      this.configsBySession.delete(staleKey);
      this.pausedSessions.delete(staleKey);
      this.lastSeenAt.delete(staleKey);
      this.onRelease(staleKey);
    }

    if (stale.length > 0) {
      this.logger(
        "debug",
        null,
        `[CONFIGURE] Released ${stale.length} stale session(s) for identifier "${identifier}"`,
      );
    }
    return stale;
  }

  /**
   * Store the config of a freshly configured session and sweep stale siblings.
   *
   * @param {string} sessionKey - Session key
   * @param {Object} config - Normalized config
   */
  storeInitConfig(sessionKey, config) {
    this.releaseStale(sessionKey, getSessionTtlMs(config));
    this.touch(sessionKey);
    this.configsBySession.set(sessionKey, config);
  }

  /**
   * Get session config from cache or clone it from the identifier-level config.
   *
   * @param {string} sessionKey - Session key
   * @returns {Object|null} Session config, or null when the identifier is unknown
   */
  getOrCreateSessionConfig(sessionKey) {
    if (this.configsBySession.has(sessionKey)) {
      return this.configsBySession.get(sessionKey);
    }
    const { identifier } = parseSessionKey(sessionKey);
    const baseConfig = this.configsByIdentifier.get(identifier);
    if (!baseConfig) return null;
    const sessionConfig = { ...baseConfig };
    this.configsBySession.set(sessionKey, sessionConfig);
    return sessionConfig;
  }

  setSessionConfig(sessionKey, config) {
    this.configsBySession.set(sessionKey, config);
  }

  setPaused(sessionKey, paused) {
    if (paused) this.pausedSessions.add(sessionKey);
    else this.pausedSessions.delete(sessionKey);
  }

  isPaused(sessionKey) {
    return this.pausedSessions.has(sessionKey);
  }

  clear() {
    this.configsByIdentifier.clear();
    this.configsBySession.clear();
    this.pausedSessions.clear();
    this.lastSeenAt.clear();
  }
}

module.exports = {
  DEFAULT_IDENTIFIER,
  DEFAULT_SESSION_ID,
  SESSION_TTL_DEFAULT_MS,
  SESSION_TTL_MIN_MS,
  SESSION_TTL_MAX_MS,
  SessionRegistry,
  buildRouteMeta,
  getSessionTtlMs,
  parseSessionKey,
};
