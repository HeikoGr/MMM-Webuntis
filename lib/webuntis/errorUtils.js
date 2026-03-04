/**
 * Lightweight error utilities for MMM-Webuntis
 * Provides wrappers to run async/sync functions with consistent error handling.
 *
 * ## Usage Patterns
 * - **wrapAsync**: Async calls that fallback to defaultValue on error
 * - **tryOrDefault**: Sync calls that fallback to defaultValue on error
 * - **tryOrThrow**: Sync calls that log but re-throw errors (fail-fast)
 * - **tryOrNull**: Sync calls that return null on error (silent-ish)
 */
const errorHandler = require('./errorHandler');

/**
 * Utility to safely call logger without crashing if logger fails.
 * Tries both 2-arg (level, msg) and 1-arg (msg) forms.
 * @private
 */
function logError(err, logger) {
  if (!logger || typeof logger !== 'function') return;
  try {
    const msg = err && err.message ? err.message : String(err);
    try {
      // Try 2-arg form: logger(level, msg)
      logger('error', msg);
    } catch {
      // Fallback to 1-arg form: logger(msg)
      logger(msg);
    }
  } catch {
    // silently ignore logger failures
  }
}

/**
 * Wrap an async call, log on error, optionally collect a user-friendly warning
 * and return a default value instead of throwing.
 *
 * @param {Function} fn - Async function () => Promise<*> to call
 * @param {Object} opts
 * @param {Function} opts.logger - logger function (accepts level,msg or msg)
 * @param {Object} [opts.context] - context passed to convertRestErrorToWarning
 *   @param {string} [opts.context.dataType] - Type of data (e.g., 'timetable', 'exams') for better error messages
 *   @param {string} [opts.context.studentTitle] - Student name for error context
 *   @param {string} [opts.context.server] - Server name for error context
 * @param {*} [opts.defaultValue] - value to return on error (default: undefined)
 * @param {Set} [opts.warnings] - Set to add user-facing warnings to
 * @param {boolean} [opts.rethrow=false] - rethrow error after logging
 * @returns {Promise<*>} Result of fn() or defaultValue on error
 *
 * @example
 * const result = await wrapAsync(
 *   () => fetchTimetable(studentId),
 *   { logger, context: { dataType: 'timetable', studentTitle: 'Max' }, defaultValue: [], warnings }
 * );
 */
async function wrapAsync(fn, opts = {}) {
  const { logger = () => {}, context = {}, defaultValue = undefined, warnings = null, rethrow = false } = opts;
  try {
    return await fn();
  } catch (err) {
    logError(err, logger);

    // Convert to a user-friendly warning when possible
    try {
      const w = errorHandler.convertRestErrorToWarning(err, context || {});
      if (w && warnings && typeof warnings.add === 'function') {
        warnings.add(w);
      }
    } catch {
      void 0; // ignore conversion errors
    }

    if (rethrow) throw err;
    return defaultValue;
  }
}

/**
 * Sync version: run sync fn, log on error, return default on error.
 * Does NOT collect warnings (use wrapAsync for that).
 *
 * @param {Function} fn - Synchronous function to call
 * @param {*} defaultValue - Value to return on error
 * @param {Function} [logger] - Optional logger function
 * @returns {*} Result of fn() or defaultValue on error
 *
 * @example
 * const config = tryOrDefault(() => JSON.parse(text), {}, logger);
 */
function tryOrDefault(fn, defaultValue, logger) {
  try {
    return fn();
  } catch (err) {
    logError(err, logger);
    return defaultValue;
  }
}

/**
 * Sync version: run sync fn, log on error, rethrow to propagate error up.
 * Use when caller MUST handle error (fail-fast pattern).
 *
 * @param {Function} fn - Synchronous function to call
 * @param {Function} [logger] - Optional logger function
 * @returns {*} Result of fn()
 * @throws {Error} Re-throws the original error after logging
 *
 * @example
 * const result = tryOrThrow(() => validateConfig(data), logger);
 */
function tryOrThrow(fn, logger) {
  try {
    return fn();
  } catch (err) {
    logError(err, logger);
    throw err;
  }
}

/**
 * Sync version: run sync fn, log on error, return null. Silent fallback.
 * Use for optional operations where null is acceptable.
 *
 * @param {Function} fn - Synchronous function to call
 * @param {Function} [logger] - Optional logger function
 * @returns {*|null} Result of fn() or null on error
 *
 * @example
 * const parsed = tryOrNull(() => JSON.parse(text), logger);
 * if (!parsed) console.log('Invalid JSON, skipping');
 */
function tryOrNull(fn, logger) {
  try {
    return fn();
  } catch (err) {
    logError(err, logger);
    return null;
  }
}

module.exports = {
  wrapAsync,
  tryOrDefault,
  tryOrThrow,
  tryOrNull,
};
