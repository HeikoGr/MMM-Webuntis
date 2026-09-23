/**
 * Per-session bookkeeping of the last HTTP status of every WebUntis endpoint.
 *
 * Two independent skip mechanisms act on that record:
 *   1. Permanent errors (403, 404, 410) - skipped for 24h, in case the school adds a license.
 *   2. Repeated non-permanent errors (typically 5xx) - a circuit breaker with a growing window
 *      once the endpoint has failed TRANSIENT_FAILURE_THRESHOLD times in a row. A single 5xx is a
 *      blip and must stay retryable, but WebUntis can serve a constant 500 for weeks - e.g. during
 *      holidays when students hold no class assignment. Without a breaker every fetch cycle would
 *      burn the full retry ladder on a result that will not change.
 *
 * Records are keyed by sessionKey (`identifier:sessionId`) so every browser session decides on
 * its own; the WebUntis session itself is shared (see lib/webuntis/authService.js).
 */

const { isAuthError } = require("./webuntis/errorHandler");

const PERMANENT_API_ERRORS = new Set([403, 404, 410]);
const API_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const TRANSIENT_FAILURE_THRESHOLD = 3;
const TRANSIENT_BACKOFF_STEPS_MS = [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000];

const SNAPSHOT_ENDPOINTS = Object.freeze(["timetable", "exams", "homework", "absences", "messages"]);

function isSuccessStatus(status) {
  return Number.isFinite(status) && status >= 200 && status < 300;
}

/**
 * Extract the numeric HTTP status from a structured error object.
 *
 * A rejected login or an expired session must never be recorded as a success: JSON-RPC reports
 * login failures inside a 200 body and a dead cookie answers with a 302 redirect. Both are auth
 * failures from the module's point of view and are mapped to 401. Returns 0 when no status is
 * available (network errors, invalid responses).
 *
 * @param {Error|Object} err - Error object
 * @returns {number} HTTP status code or 0
 */
function extractHttpStatus(err) {
  const rawStatus =
    err?.status ?? err?.httpStatus ?? err?.response?.status ?? err?.cause?.status ?? err?.cause?.httpStatus;
  const numericStatus = Number(rawStatus);
  const status = Number.isFinite(numericStatus) ? numericStatus : 0;
  if (isAuthError(err) && status < 400) return 401;
  return status;
}

/**
 * Backoff window for an endpoint that keeps failing with non-permanent errors.
 * Returns 0 while the failure count is below the threshold, so isolated blips stay retryable
 * on the very next cycle.
 *
 * @param {number} failureCount - Consecutive failures recorded for the endpoint
 * @returns {number} Backoff window in milliseconds (0 = retry immediately)
 */
function getTransientBackoffMs(failureCount) {
  if (!Number.isFinite(failureCount) || failureCount < TRANSIENT_FAILURE_THRESHOLD) return 0;
  const stepIndex = Math.min(failureCount - TRANSIENT_FAILURE_THRESHOLD, TRANSIENT_BACKOFF_STEPS_MS.length - 1);
  return TRANSIENT_BACKOFF_STEPS_MS[stepIndex];
}

function createEmptySnapshot() {
  const snapshot = {};
  SNAPSHOT_ENDPOINTS.forEach((endpoint) => {
    snapshot[endpoint] = null;
  });
  return snapshot;
}

class ApiStatusTracker {
  /**
   * @param {Object} [options]
   * @param {Function} [options.logger] - (level, student, message) logger
   */
  constructor(options = {}) {
    this.logger = typeof options.logger === "function" ? options.logger : () => {};
    this._bySession = new Map(); // sessionKey -> { [endpoint]: { status, recordedAt, failureCount, lastSuccessAt } }
  }

  _records(sessionKey, create = false) {
    if (!this._bySession.has(sessionKey)) {
      if (!create) return null;
      this._bySession.set(sessionKey, {});
    }
    return this._bySession.get(sessionKey);
  }

  /**
   * Whether an endpoint should be skipped in this cycle based on its previous status.
   *
   * @param {string} sessionKey - Session key
   * @param {string} endpoint - Endpoint name (timetable, exams, homework, absences, messagesOfDay)
   * @returns {boolean} True if the API call should be skipped
   */
  shouldSkip(sessionKey, endpoint) {
    const records = this._records(sessionKey);
    const record = records?.[endpoint];
    if (!record) return false;

    const { status, recordedAt = 0, failureCount = 0 } = record;

    if (PERMANENT_API_ERRORS.has(status)) {
      // Retry after 24 hours in case the school adds a new module/license
      if (recordedAt && Date.now() - recordedAt > API_RETRY_AFTER_MS) {
        delete records[endpoint];
        return false;
      }
      return true;
    }

    if (isSuccessStatus(status)) return false;

    const backoffMs = getTransientBackoffMs(failureCount);
    if (backoffMs === 0 || !recordedAt) return false;

    const waitedMs = Date.now() - recordedAt;
    if (waitedMs >= backoffMs) return false;

    const remainingMin = Math.ceil((backoffMs - waitedMs) / 60000);
    this.logger(
      "debug",
      null,
      `[${endpoint}] Backing off after ${failureCount} consecutive failures (status ${status}); next attempt in ~${remainingMin}min`,
    );
    return true;
  }

  /**
   * Record a failed call. Consecutive failures are counted so shouldSkip() can back off; a
   * recorded success resets the counter.
   *
   * @param {string} sessionKey - Session key
   * @param {string} endpoint - Endpoint name
   * @param {Error} err - Error object
   */
  recordError(sessionKey, endpoint, err) {
    if (!sessionKey) return;
    const status = extractHttpStatus(err);
    const records = this._records(sessionKey, true);
    const previous = records[endpoint];
    const previousStatus = previous?.status;
    const previousCount = Number.isFinite(previous?.failureCount) ? previous.failureCount : 0;

    // Only a prior failure continues a streak; a prior success (or no record) starts a new one.
    const continuesStreak = previous !== undefined && !isSuccessStatus(previousStatus);
    const failureCount = continuesStreak ? previousCount + 1 : 1;

    records[endpoint] = {
      status,
      recordedAt: Date.now(),
      failureCount,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
    };
  }

  /**
   * Record the status of a completed call.
   *
   * A success closes the circuit breaker; anything else keeps the streak intact so a recovery
   * probe that fails again escalates instead of restarting at the first step.
   *
   * @param {string} sessionKey - Session key
   * @param {string} endpoint - Endpoint name
   * @param {number} status - HTTP status
   */
  recordStatus(sessionKey, endpoint, status) {
    if (!sessionKey) return;
    const records = this._records(sessionKey, true);
    const previous = records[endpoint];
    const previousCount = Number.isFinite(previous?.failureCount) ? previous.failureCount : 0;
    const success = isSuccessStatus(status);
    const failureCount = success ? 0 : previousCount;
    const now = Date.now();

    if (previousCount > 0 && failureCount === 0) {
      this.logger("debug", null, `[${endpoint}] Recovered after ${previousCount} consecutive failures`);
    }

    records[endpoint] = {
      status,
      recordedAt: now,
      failureCount,
      lastSuccessAt: success ? now : (previous?.lastSuccessAt ?? null),
    };
  }

  /**
   * Plain `{ endpoint: status }` map for a session (as consumed by the core client).
   *
   * @param {string} sessionKey - Session key
   * @returns {Object} endpoint -> status
   */
  getStatuses(sessionKey) {
    const records = this._records(sessionKey) || {};
    const result = {};
    for (const [endpoint, record] of Object.entries(records)) {
      result[endpoint] = record.status;
    }
    return result;
  }

  /**
   * Full records for a session (status, recordedAt, failureCount, lastSuccessAt), keyed by the
   * canonical collection names used in the payload (`messages` instead of `messagesOfDay`).
   *
   * @param {string} sessionKey - Session key
   * @returns {Object} collection -> record | null
   */
  getRecords(sessionKey) {
    const records = this._records(sessionKey) || {};
    const result = {};
    for (const [endpoint, record] of Object.entries(records)) {
      const key = endpoint === "messagesOfDay" || endpoint === "messagesofday" ? "messages" : endpoint;
      result[key] = { ...record };
    }
    return result;
  }

  /**
   * `state.api` snapshot for the payload: one numeric status (or null) per canonical collection.
   *
   * @param {string} sessionKey - Session key
   * @returns {Object} { timetable, exams, homework, absences, messages }
   */
  buildSnapshot(sessionKey) {
    const snapshot = createEmptySnapshot();
    const records = this.getRecords(sessionKey);
    for (const [collection, record] of Object.entries(records)) {
      const status = Number(record?.status);
      if (Number.isFinite(status) && Object.hasOwn(snapshot, collection)) {
        snapshot[collection] = status;
      }
    }
    return snapshot;
  }

  /** Drop the records of a session (used when the session is released). */
  release(sessionKey) {
    this._bySession.delete(sessionKey);
  }

  /** Session keys that currently hold records. */
  sessionKeys() {
    return Array.from(this._bySession.keys());
  }

  clear() {
    this._bySession.clear();
  }
}

module.exports = {
  ApiStatusTracker,
  PERMANENT_API_ERRORS,
  API_RETRY_AFTER_MS,
  TRANSIENT_FAILURE_THRESHOLD,
  TRANSIENT_BACKOFF_STEPS_MS,
  createEmptySnapshot,
  extractHttpStatus,
  getTransientBackoffMs,
  isSuccessStatus,
};
