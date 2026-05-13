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
   * Solution: Extract wall-clock components in target timezone using Intl API, then construct
   * a new Date that interprets those components as UTC. This creates a Date whose local methods
   * return the target timezone wall-clock time.
   *
   * Example: If sourceDate is "2026-01-15 14:30 UTC" and timezone is "America/New_York" (UTC-5):
   *   1. Extract wall-clock: 09:30 in New York
   *   2. Create UTC Date: Date.UTC(2026, 0, 15, 9, 30, 0)
   *   3. Calculate offset to preserve original moment
   *   4. Return Date that shows 09:30 when calling getHours()/getMinutes()
   *
   * @param {Date} [now=new Date()] - Source date to convert
   * @param {string} [timezone='Europe/Berlin'] - Target IANA timezone identifier
   * @returns {Date} Date object representing wall-clock time in target timezone
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

      // Create UTC timestamp for these wall-clock components
      const utcTimestamp = Date.UTC(
        parseInt(values.year, 10),
        parseInt(values.month, 10) - 1,
        parseInt(values.day, 10),
        parseInt(values.hour, 10),
        parseInt(values.minute, 10),
        parseInt(values.second, 10)
      );

      // Calculate timezone offset: difference between UTC timestamp and actual UTC time
      // offset = UTC time for wall-clock in target tz - actual UTC time at that moment
      // When offset is applied: utcTimestamp + offset should equal sourceDate.getTime() when
      // the wall-clock matches the source date wall-clock in the target timezone
      const offset = sourceDate.getTime() - utcTimestamp;

      // Create new Date representing wall-clock time in target timezone
      // This Date's .getHours(), .getMinutes(), etc. will return target timezone wall-clock values
      // when the Date is interpreted as UTC + offset internally
      return new Date(utcTimestamp + offset);
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
      // Calculate timezone offset: difference between target timezone time and UTC time
      // wallClockNow represents the target timezone wall-clock time (encoded as Date)
      // offset is how much to adjust a UTC time to get the equivalent target timezone time
      const offset = wallClockNow.getTime() - sourceNow.getTime();

      // Create date in UTC space for debug date + wall-clock time
      const debugUTC = Date.UTC(
        debugDate.year,
        debugDate.month - 1,
        debugDate.day,
        wallClockNow.getHours(),
        wallClockNow.getMinutes(),
        wallClockNow.getSeconds(),
        wallClockNow.getMilliseconds()
      );

      // Apply timezone offset to get correct UTC time representation
      const debugNow = new Date(debugUTC + offset);

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
