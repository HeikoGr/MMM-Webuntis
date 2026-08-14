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

  /**
   * Convert a Date to wall-clock time in a specific timezone
   *
   * Problem: JavaScript Date objects store UTC timestamps but display in local timezone.
   * When we need to work with wall-clock time in a different timezone (e.g., school's timezone),
   * we need a Date object whose getHours(), getMinutes() etc. return the target timezone values.
   *
   * Solution: Extract the wall-clock components in the target timezone via the Intl API, then
   * feed them back through the *local* Date constructor. Every consumer downstream
   * (`buildDateContext`, `currentTimeAsHHMM`, `toYmdNumber`) reads components with local getters,
   * so the components have to be stored where those getters look.
   *
   * The result is deliberately not the same instant as the input - it is the school's wall clock
   * re-encoded for local reading. Do not use it for arithmetic against real timestamps.
   *
   * Example: sourceDate "2026-01-15 14:30 UTC", timezone "America/New_York" (UTC-5):
   *   1. Intl reports the wall clock in New York: 09:30
   *   2. new Date(2026, 0, 15, 9, 30, 0) stores those components locally
   *   3. getHours() returns 9 on any host, regardless of the host timezone
   *
   * @param {Date} [now=new Date()] - Source date to convert
   * @param {string} [timezone='Europe/Berlin'] - Target IANA timezone identifier
   * @returns {Date} Date whose local getters yield the target timezone wall clock
   */
  function getTimeZoneDate(now = new Date(), timezone = 'Europe/Berlin') {
    const sourceDate = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
    if (!timezone || typeof timezone !== 'string') return new Date(sourceDate.getTime());

    try {
      // Use Intl API to reliably extract wall-clock time components in target timezone
      // Note: Locale is undefined to use system default; parsing via type field is locale-agnostic
      const parts = new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(sourceDate);

      const values = {};
      parts.forEach(({ type, value }) => {
        values[type] = value;
      });

      // Store the target wall clock where the local getters read it. Intl does not report
      // milliseconds, and every zone offset is a whole number of minutes, so the millisecond
      // component carries over from the source unchanged.
      return new Date(
        parseInt(values.year, 10),
        parseInt(values.month, 10) - 1,
        parseInt(values.day, 10),
        parseInt(values.hour, 10),
        parseInt(values.minute, 10),
        parseInt(values.second, 10),
        sourceDate.getMilliseconds()
      );
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
      // Keep the real wall-clock time, swap in the debug day. Both operands are already encoded
      // for local getters, so the components transfer directly - no offset arithmetic, and no
      // dependency on the host timezone or on which side of a DST switch either date falls.
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

  function parseDisplayModeTokens(displayModeValue, fallbackTokens = []) {
    const raw = displayModeValue === undefined || displayModeValue === null ? '' : String(displayModeValue).toLowerCase().trim();
    if (raw === 'grid') return ['grid'];
    if (raw === 'list') return ['list', 'lessons', 'exams'];

    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 0) return parts;
    return Array.isArray(fallbackTokens) ? fallbackTokens.filter((token) => typeof token === 'string' && token.trim() !== '') : [];
  }

  return {
    generateScopedId,
    createLevelLogger,
    getCurrentDateContext,
    parseDisplayModeTokens,
  };
});
