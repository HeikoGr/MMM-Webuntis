/**
 * Backend logger helpers for MMM-Webuntis.
 */

/**
 * Create a backend logger for Node.js environment
 * Integrates with MagicMirror's _mmLog-style callback system
 *
 * @param {Function} mmLog - MagicMirror's _mmLog function (level, student, msg)
 * @returns {Object} Logger instance with log/error/warn/info/debug methods
 */
function createBackendLogger(mmLog) {
  function log(level, msg, data = null) {
    if (typeof mmLog === 'function') {
      mmLog(level, null, msg, data);
    }
  }

  return {
    log,
    error: (msg, data) => log('error', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    info: (msg, data) => log('info', msg, data),
    debug: (msg, data) => log('debug', msg, data),
  };
}

module.exports = createBackendLogger;
