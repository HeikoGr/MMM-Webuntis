/**
 * Centralized Logger for MMM-Webuntis
 * Provides consistent logging across frontend, backend, and widgets
 */

/**
 * Log level hierarchy: error > warn > info > debug
 */
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

/**
 * Console methods per log level (adjustable per environment)
 */
const CONSOLE_METHODS = {
  error: 'error',
  warn: 'warn',
  info: 'log', // Use console.log for info (not info which doesn't exist)
  debug: 'log', // Use console.log for debug
};

/**
 * Timestamp formatter
 */
function formatTimestamp() {
  const now = new Date();
  return `[${now.toISOString().slice(11, 23)}]`;
}

/**
 * Create a logger instance for a specific module/component
 * @param {string} moduleName - Name of the module using this logger
 * @param {Object} options - Configuration options
 * @param {number} options.minLevel - Minimum log level to output (0=error, 1=warn, 2=info, 3=debug)
 * @param {boolean} options.useConsole - Whether to use console methods (true for frontend, false for Node)
 * @param {boolean} options.includeTimestamp - Whether to prepend timestamps
 * @param {Function} options.externalLogger - External logger function (e.g., MagicMirror's logging)
 * @returns {Object} Logger with log(level, msg) and convenience methods
 */
function createLogger(moduleName, options = {}) {
  const { minLevel = LOG_LEVELS.info, useConsole = false, includeTimestamp = false, externalLogger = null } = options;

  /**
   * Core logging function
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @param {string} msg - Message to log
   * @param {*} data - Optional data to include
   */
  function log(level, msg, data = null) {
    const levelCode = LOG_LEVELS[level] ?? LOG_LEVELS.info;

    // Skip if below min level
    if (levelCode > minLevel) return;

    // Log via external logger if provided (MagicMirror backend uses this)
    // External logger (_mmLog) already adds module prefix, so don't duplicate it
    if (externalLogger) {
      externalLogger(level, msg, data);
      return;
    }

    // Format message with module name for console output
    let formatted = `${moduleName}: ${msg}`;
    if (includeTimestamp) {
      formatted = `${formatTimestamp()} ${formatted}`;
    }

    // Log via console
    if (useConsole) {
      const method = CONSOLE_METHODS[level] || 'log';
      if (data !== null && data !== undefined) {
        console[method](formatted, data);
      } else {
        console[method](formatted);
      }
    }
  }

  // Convenience methods
  return {
    log,
    error: (msg, data) => log('error', msg, data),
    warn: (msg, data) => log('warn', msg, data),
    info: (msg, data) => log('info', msg, data),
    debug: (msg, data) => log('debug', msg, data),
  };
}

/**
 * Create a backend logger for Node.js environment
 * Integrates with MagicMirror's _mmLog-style callback system
 *
 * @param {Function} mmLog - MagicMirror's _mmLog function (level, student, msg)
 * @param {string} [moduleName='MMM-Webuntis'] - Module name for log prefixing
 * @returns {Object} Logger instance with log/error/warn/info/debug methods
 */
function createBackendLogger(mmLog, moduleName = 'MMM-Webuntis') {
  return createLogger(moduleName, {
    // Do not filter out debug messages here; delegate level control to the
    // MagicMirror backend `_mmLog` which respects module config. Allow all
    // levels by setting minLevel to the highest verbosity.
    minLevel: LOG_LEVELS.debug,
    useConsole: false,
    includeTimestamp: false,
    externalLogger: (level, msg, data) => {
      // _mmLog already adds [MMM-Webuntis] tag, so pass null for student parameter
      // Signature: _mmLog(level, student, message)
      if (typeof mmLog === 'function') {
        mmLog(level, null, msg, data);
      }
    },
  });
}

/**
 * Create a frontend logger (Browser, uses console methods)
 * @param {string} moduleName - Module name for context
 * @returns {Object} Logger instance
 */
function createFrontendLogger(moduleName = 'MMM-Webuntis') {
  return createLogger(moduleName, {
    minLevel: LOG_LEVELS.info,
    useConsole: true,
    includeTimestamp: true,
  });
}

module.exports = {
  createBackendLogger,
  createFrontendLogger,
};
