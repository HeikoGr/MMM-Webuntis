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

    // Format message
    let formatted = `${moduleName}: ${msg}`;
    if (includeTimestamp) {
      formatted = `${formatTimestamp()} ${formatted}`;
    }

    // Log via external logger if provided (MagicMirror backend uses this)
    if (externalLogger) {
      externalLogger(level, formatted, data);
      return;
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
 * Create a backend logger (Node.js, uses MagicMirror's _mmLog-style callback)
 * @param {Function} mmLog - MagicMirror's _mmLog function or equivalent
 * @param {string} moduleName - Module name for context
 * @returns {Object} Logger instance
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
      // MagicMirror backend expects: mmLog(level, senderName, logMessage)
      // But our backend passes a custom logger, so adapt the signature
      if (typeof mmLog === 'function') {
        mmLog(level, moduleName, msg, data);
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

/**
 * Legacy adapter for existing _mmLog calls in node_helper
 * Takes the existing _mmLog signature and wraps it for the new logger interface
 * @param {Function} mmLogFn - Original _mmLog(level, senderName, logMessage) function
 * @returns {Function} Adapter function (level, moduleName, msg, data) => void
 */
function wrapMmLog(mmLogFn) {
  return (level, moduleName, msg, data) => {
    if (typeof mmLogFn === 'function') {
      // MagicMirror expects: (level, senderName, logMessage)
      const senderName = moduleName || 'MMM-Webuntis';
      const logMessage = data ? `${msg} ${JSON.stringify(data)}` : msg;
      mmLogFn(level, senderName, logMessage);
    }
  };
}

module.exports = {
  createLogger,
  createBackendLogger,
  createFrontendLogger,
  wrapMmLog,
  LOG_LEVELS,
  CONSOLE_METHODS,
};
