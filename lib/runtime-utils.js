(function initRuntimeUtils(root, factory) {
  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  root.MMModuleRuntimeUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createRuntimeUtils() {
  const LEVELS = {
    none: -1,
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
  };

  const DEFAULT_METHODS = {
    error: 'error',
    warn: 'warn',
    info: 'info',
    debug: 'debug',
  };

  function normalizeLevel(level, fallback = 'info') {
    return Object.hasOwn(LEVELS, level) ? level : fallback;
  }

  function getCryptoProvider() {
    if (typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.crypto) {
      return globalThis.window.crypto;
    }

    if (typeof globalThis !== 'undefined' && globalThis.self && globalThis.self.crypto) {
      return globalThis.self.crypto;
    }

    if (typeof require === 'function') {
      try {
        return require('node:crypto');
      } catch {
        return null;
      }
    }

    return null;
  }

  function generateScopedId(prefix = 'instance', length = 9) {
    const cryptoObj = getCryptoProvider();
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

    if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
      return `${prefix}_${cryptoObj.randomUUID()}`;
    }

    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const values = new Uint8Array(length);
      let suffix = '';
      cryptoObj.getRandomValues(values);
      values.forEach((value) => {
        suffix += alphabet.charAt(value % alphabet.length);
      });
      return `${prefix}_${suffix}`;
    }

    if (cryptoObj && typeof cryptoObj.randomFillSync === 'function') {
      const values = new Uint8Array(length);
      let suffix = '';
      cryptoObj.randomFillSync(values);
      values.forEach((value) => {
        suffix += alphabet.charAt(value % alphabet.length);
      });
      return `${prefix}_${suffix}`;
    }

    return `${prefix}_${Date.now().toString(36)}`;
  }

  function createLevelLogger({ prefix = '', getLevel = () => 'info', consoleRef = console, methods = DEFAULT_METHODS } = {}) {
    function log(level, ...args) {
      const configuredLevel = normalizeLevel(typeof getLevel === 'function' ? getLevel() : getLevel, 'info');
      const messageLevel = normalizeLevel(level, 'info');

      if (LEVELS[messageLevel] > LEVELS[configuredLevel]) {
        return;
      }

      const methodName = methods[messageLevel] || DEFAULT_METHODS[messageLevel] || 'log';
      if (prefix) {
        consoleRef[methodName](prefix, ...args);
      } else {
        consoleRef[methodName](...args);
      }
    }

    return {
      log,
      error: (...args) => log('error', ...args),
      warn: (...args) => log('warn', ...args),
      info: (...args) => log('info', ...args),
      debug: (...args) => log('debug', ...args),
    };
  }

  return {
    LEVELS,
    normalizeLevel,
    generateScopedId,
    createLevelLogger,
  };
});
