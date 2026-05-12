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

  function toYmdNumber(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  function formatIsoDateParts(year, month, day) {
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function parseDebugDateValue(value) {
    const raw = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
    if (!raw) return null;

    let year;
    let month;
    let day;

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      [year, month, day] = raw.split('-').map(Number);
    } else if (/^\d{8}$/.test(raw)) {
      year = Number(raw.slice(0, 4));
      month = Number(raw.slice(4, 6));
      day = Number(raw.slice(6, 8));
    } else {
      return null;
    }

    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) return null;

    return {
      year,
      month,
      day,
      ymd: year * 10000 + month * 100 + day,
      isoDate: formatIsoDateParts(year, month, day),
    };
  }

  function getTimeZoneDate(now = new Date(), timezone = 'Europe/Berlin') {
    const sourceDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    if (!timezone || typeof timezone !== 'string') return new Date(sourceDate.getTime());

    try {
      return new Date(sourceDate.toLocaleString('en-US', { timeZone: timezone }));
    } catch {
      return new Date(sourceDate.getTime());
    }
  }

  function buildDateContext(date, extra = {}) {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? new Date(date.getTime()) : new Date();

    return {
      date: safeDate,
      ymd: toYmdNumber(safeDate),
      isoDate: formatIsoDateParts(safeDate.getFullYear(), safeDate.getMonth() + 1, safeDate.getDate()),
      isDebug: false,
      ...extra,
    };
  }

  function getCurrentDateContext(config = {}, options = {}) {
    const defaultTimezone =
      typeof options.defaultTimezone === 'string' && options.defaultTimezone ? options.defaultTimezone : 'Europe/Berlin';
    const timezone = typeof config?.timezone === 'string' && config.timezone.trim() ? config.timezone.trim() : defaultTimezone;
    const sourceNow = options.now instanceof Date && !Number.isNaN(options.now.getTime()) ? options.now : new Date();
    const wallClockNow = getTimeZoneDate(sourceNow, timezone);
    const debugDate = parseDebugDateValue(config?.debugDate);

    if (debugDate) {
      const debugNow = new Date(
        debugDate.year,
        debugDate.month - 1,
        debugDate.day,
        wallClockNow.getHours(),
        wallClockNow.getMinutes(),
        wallClockNow.getSeconds(),
        wallClockNow.getMilliseconds()
      );

      return buildDateContext(debugNow, {
        ymd: debugDate.ymd,
        isoDate: debugDate.isoDate,
        isDebug: true,
        timezone,
      });
    }

    return buildDateContext(wallClockNow, { timezone });
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
    generateScopedId,
    createLevelLogger,
    getCurrentDateContext,
  };
});
