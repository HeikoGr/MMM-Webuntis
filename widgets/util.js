(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  // Global log function - respects window.MMMWebuntisLogLevel set by main module
  // Supports two signatures:
  //   - log(level, ...args)
  //   - log(ctx, level, ...args)  [legacy, ctx is ignored]
  function log(...fullArgs) {
    // Handle both log(level, ...args) and log(ctx, level, ...args) signatures
    let level, args;
    if (fullArgs.length >= 1 && typeof fullArgs[0] === 'string' && ['error', 'warn', 'info', 'debug'].includes(fullArgs[0])) {
      // New signature: log(level, ...args)
      [level, ...args] = fullArgs;
    } else if (fullArgs.length >= 2) {
      // Legacy signature: log(ctx, level, ...args)
      [, level, ...args] = fullArgs;
    } else {
      return; // Not enough args
    }

    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const configured = window.MMMWebuntisLogLevel || 'info';
    // Special: if configured is 'none', never log
    if (configured === 'none') return;

    const configuredLevel = levels[configured] !== undefined ? configured : 'info';
    const msgLevel = levels[level] !== undefined ? level : 'info';

    // Only log if the message level is important enough
    if (levels[msgLevel] > levels[configuredLevel]) return;

    const prefix = '[MMM-Webuntis]';
    const tag = `${prefix} [${String(level).toUpperCase()}]`;

    if (level === 'error') {
      console.error(tag, ...args);
    } else {
      // ESLint only allows warn and error; use warn for info and debug too
      console.warn(tag, ...args);
    }
  }

  function formatYmd(ymd) {
    return formatDate(ymd, 'dd.MM.yyyy');
  }

  function formatDate(ymd, format = 'dd.MM.yyyy') {
    if (ymd === null || ymd === undefined || ymd === '') return '';

    // Support numeric ymd (20251214) or ISO date strings (2025-12-14 / 2025-12-14T00:00:00Z)
    let dt;
    if (ymd instanceof Date) {
      dt = ymd;
    } else {
      const n = Number(ymd);
      if (Number.isFinite(n) && n > 0) {
        const day = n % 100;
        const month = Math.floor(n / 100) % 100;
        const year = Math.floor(n / 10000);
        dt = new Date(year, month - 1, day);
      } else {
        dt = new Date(String(ymd));
      }
    }

    if (Number.isNaN(dt.getTime())) return '';

    // Use Intl.DateTimeFormat.formatToParts to obtain locale-aware, zero-padded parts
    // and optionally weekday names. Support tokens:
    //  - yyyy, yy, dd, mm
    //  - d, m      -> non-padded day/month
    //  - EEE  -> localized short weekday (e.g. 'Do')
    //  - EEEE -> localized long weekday (e.g. 'Donnerstag')
    const parts = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    }).formatToParts(dt);
    const map = {};
    for (const p of parts) {
      if (p.type === 'day') map.dd = p.value;
      if (p.type === 'month') map.mm = p.value;
      if (p.type === 'year') map.yyyy = p.value;
      if (p.type === 'weekday') map._weekdayShort = p.value;
    }
    map.yy = (map.yyyy || '').slice(-2);
    // non-padded variants
    map.d = String(Number(map.dd || '0'));
    map.m = String(Number(map.mm || '0'));

    const weekdayShort = map._weekdayShort || new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(dt);
    const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(dt);

    // Replace known tokens (longer tokens first to avoid partial matches)
    return String(format || '').replace(/(EEEE|EEE|yyyy|yy|dd|d|mm|m)/gi, (match) => {
      const key = String(match).toLowerCase();
      if (key === 'eeee') return weekdayLong;
      if (key === 'eee') return weekdayShort;
      return map[key] ?? match;
    });
  }

  function formatTime(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    if (s.includes(':')) return s;
    const digits = s.replace(/\D/g, '').padStart(4, '0');
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }

  function toMinutes(t) {
    if (t === null || t === undefined) return NaN;
    const s = String(t).trim();
    if (s.includes(':')) {
      const parts = s.split(':').map((p) => p.replace(/\D/g, ''));
      const hh = parseInt(parts[0], 10) || 0;
      const mm = parseInt(parts[1] || '0', 10) || 0;
      return hh * 60 + mm;
    }
    const digits = s.replace(/\D/g, '').padStart(4, '0');
    const hh = parseInt(digits.slice(0, 2), 10) || 0;
    const mm = parseInt(digits.slice(2), 10) || 0;
    return hh * 60 + mm;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function createElement(tag, className = '', innerHTML = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML !== undefined && innerHTML !== null) el.innerHTML = innerHTML;
    return el;
  }

  function addTableHeader(table, studentTitle = '') {
    const thisRow = createElement('tr');
    const studentCell = createElement('th', 'align-left alignTop', studentTitle);
    studentCell.colSpan = 3;
    thisRow.appendChild(studentCell);
    table.appendChild(thisRow);
  }

  function addTableRow(table, type, studentTitle = '', text1 = '', text2 = '', addClass = '') {
    const thisRow = createElement('tr');
    thisRow.className = type;
    if (addClass) {
      thisRow.className = `${thisRow.className} ${addClass}`.trim();
    }

    if (studentTitle !== '') {
      const studentCell = createElement('td', 'align-left alignTop bold wu-col-student', studentTitle);
      thisRow.appendChild(studentCell);
    }

    const primaryClass = text2 === '' ? 'wu-col-data' : 'wu-col-meta';
    const cell1 = createElement('td', `align-left alignTop ${primaryClass}`, text1);
    if (text2 === '') cell1.colSpan = 2;
    thisRow.appendChild(cell1);

    if (text2 !== '') {
      const cell2 = createElement('td', `align-left alignTop wu-col-data ${addClass}`, text2);
      thisRow.appendChild(cell2);
    }

    table.appendChild(thisRow);
  }

  function createTable() {
    const t = createElement('table');
    t.className = 'bright small light';
    return t;
  }

  // NOTE: `formatDate` now accepts Date objects directly. No separate
  // `formatDayHeader`/`formatDayLabel` helpers are required.

  /**
   * Get widget-specific configuration value from studentConfig
   * No legacy fallbacks, no module-level config, no defaults
   * (defaults are applied by MMM-Webuntis.js before reaching widgets)
   *
   * @param {Object} studentConfig - Student configuration object from backend
   * @param {string} widgetName - Widget name (e.g., 'lessons', 'grid', 'exams')
   * @param {string} configKey - Configuration key to retrieve
   * @returns {*} Configuration value or undefined if not set
   */
  function getWidgetConfig(studentConfig, widgetName, configKey) {
    return studentConfig?.[widgetName]?.[configKey];
  }

  /**
   * Initialize widget utilities and DOM helpers.
   * Returns an object with all common widget utilities to reduce boilerplate.
   * @param {Object} root - The MMMWebuntisWidgets root object
   * @returns {Object} Object containing util and dom helpers
   */
  function initWidget(widgetRoot) {
    const util = widgetRoot.util || {};
    const dom = widgetRoot.dom || {};
    return {
      log: typeof util.log === 'function' ? util.log : () => { },
      escapeHtml: typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || ''),
      formatDate: typeof util.formatDate === 'function' ? util.formatDate : () => '',
      formatTime: typeof util.formatTime === 'function' ? util.formatTime : () => '',
      toMinutes: typeof util.toMinutes === 'function' ? util.toMinutes : () => NaN,
      getWidgetConfig: typeof util.getWidgetConfig === 'function' ? util.getWidgetConfig : () => undefined,
      addTableRow: typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { },
      addTableHeader: typeof dom.addTableHeader === 'function' ? dom.addTableHeader : () => { },
      createElement: typeof dom.createElement === 'function' ? dom.createElement : () => document.createElement('div'),
      createTable: typeof dom.createTable === 'function' ? dom.createTable : () => document.createElement('table'),
    };
  }

  root.util = {
    formatYmd,
    formatTime,
    toMinutes,
    formatDate,
    // backward compatibility: keep alias name for callers that may still use it
    formatHolidayDate: function (dateInput, format) {
      return formatDate(dateInput, format);
    },
    escapeHtml,
    log,
    _log: log, // backward compatibility alias
    getWidgetConfig,
    initWidget,
  };

  root.dom = {
    createElement,
    addTableHeader,
    addTableRow,
    createTable,
  };
})();
