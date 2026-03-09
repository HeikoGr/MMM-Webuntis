/**
 * Widget Utilities Module
 * Provides common utility functions for all MMM-Webuntis widgets
 * Functions include: date/time formatting, DOM manipulation, logging, field extraction
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});

  const LOG_LEVELS = ['error', 'warn', 'info', 'debug'];
  const LOG_LEVEL_WEIGHTS = { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
  const LESSON_STATUS = Object.freeze({
    ADDITIONAL: 'ADDITIONAL',
    CHANGED: 'CHANGED',
    SUBSTITUTION: 'SUBSTITUTION',
    SUBSTITUTE: 'SUBSTITUTE',
  });
  const LESSON_ACTIVITY_TYPE = Object.freeze({
    ADDITIONAL_PERIOD: 'ADDITIONAL_PERIOD',
    CHANGED_PERIOD: 'CHANGED_PERIOD',
    SUBSTITUTION_PERIOD: 'SUBSTITUTION_PERIOD',
  });
  const IRREGULAR_STATUSES = new Set(Object.values(LESSON_STATUS));
  const IRREGULAR_ACTIVITY_TYPES = new Set(Object.values(LESSON_ACTIVITY_TYPE));

  /**
   * Global log function for widgets
   * Respects window.MMMWebuntisLogLevel set by main module
   *
   * Supports two signatures for backward compatibility:
   *   - log(level, ...args)              [recommended]
   *   - log(ctx, level, ...args)         [legacy, ctx is ignored]
   *
   * @param {...any} fullArgs - Variable arguments (level, message) or (ctx, level, message)
   */
  function log(...fullArgs) {
    // Handle both log(level, ...args) and log(ctx, level, ...args) signatures
    let level, args;
    if (fullArgs.length >= 1 && typeof fullArgs[0] === 'string' && LOG_LEVELS.includes(fullArgs[0])) {
      // New signature: log(level, ...args)
      [level, ...args] = fullArgs;
    } else if (fullArgs.length >= 2) {
      // Legacy signature: log(ctx, level, ...args)
      [, level, ...args] = fullArgs;
    } else {
      return; // Not enough args
    }

    const configured = window.MMMWebuntisLogLevel || 'none';
    // Special: if configured is 'none', never log
    if (configured === 'none') return;

    const configuredLevel = LOG_LEVEL_WEIGHTS[configured] !== undefined ? configured : 'info';
    const msgLevel = LOG_LEVEL_WEIGHTS[level] !== undefined ? level : 'info';

    // Only log if the message level is important enough
    if (LOG_LEVEL_WEIGHTS[msgLevel] > LOG_LEVEL_WEIGHTS[configuredLevel]) return;

    const prefix = '[MMM-Webuntis]';
    const tag = `${prefix} [${String(level).toUpperCase()}]`;

    if (level === 'error') {
      console.error(tag, ...args);
    } else {
      // ESLint only allows warn and error; use warn for info and debug too
      console.warn(tag, ...args);
    }
  }

  /**
   * Format YYYYMMDD integer to dd.MM.yyyy string
   * Convenience wrapper around formatDisplayDate with default format
   *
   * @param {number|string} ymd - Date as YYYYMMDD integer (e.g., 20260130)
   * @returns {string} Formatted date string (e.g., "30.01.2026")
   */
  function formatYmd(ymd) {
    return formatDisplayDate(ymd, 'dd.MM.yyyy');
  }

  /**
   * Format date with custom pattern using locale-aware formatting
   * Supports multiple input formats:
   *   - YYYYMMDD integer (20260130)
   *   - ISO date string ("2026-01-30" or "2026-01-30T00:00:00Z")
   *   - Date object
   *
   * Supported format tokens:
   *   - yyyy: 4-digit year (2026)
   *   - yy: 2-digit year (26)
   *   - dd: 2-digit day (01-31)
   *   - d: 1-digit day (1-31)
   *   - mm: 2-digit month (01-12)
   *   - m: 1-digit month (1-12)
   *   - EEE: Short weekday name (locale-aware, e.g., "Thu")
   *   - EEEE: Long weekday name (locale-aware, e.g., "Thursday")
   *
   * @param {number|string|Date} ymd - Date value to format
   * @param {string} format - Format pattern (default: 'dd.MM.yyyy')
   * @returns {string} Formatted date string or empty string if invalid
   */
  function formatDisplayDate(ymd, format = 'dd.MM.yyyy') {
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

    // Get locale from MagicMirror global config (fallback to browser default)
    let locale;
    try {
      // eslint-disable-next-line no-undef
      locale = (typeof config !== 'undefined' && config && config.language) || undefined;
    } catch {
      locale = undefined;
    }

    // Use Intl.DateTimeFormat.formatToParts to obtain locale-aware, zero-padded parts
    // and optionally weekday names. Support tokens:
    //  - yyyy, yy, dd, mm
    //  - d, m      -> non-padded day/month
    //  - EEE  -> localized short weekday (e.g. 'Do')
    //  - EEEE -> localized long weekday (e.g. 'Donnerstag')
    const parts = new Intl.DateTimeFormat(locale, {
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

    const weekdayShort = map._weekdayShort || new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(dt);
    const weekdayLong = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(dt);

    // Replace known tokens (longer tokens first to avoid partial matches)
    return String(format || '').replace(/(EEEE|EEE|yyyy|yy|dd|d|mm|m)/gi, (match) => {
      const key = String(match).toLowerCase();
      if (key === 'eeee') return weekdayLong;
      if (key === 'eee') return weekdayShort;
      return map[key] ?? match;
    });
  }

  /**
   * Format time value to HH:MM string
   * Supports multiple input formats:
   *   - "13:50" → "13:50" (pass-through)
   *   - 1350 → "13:50"
   *   - "08:15" → "08:15"
   *   - 815 → "08:15"
   *
   * @param {string|number} v - Time value (HHMM integer or "HH:MM" string)
   * @returns {string} Formatted time string "HH:MM" or empty string if invalid
   */
  function formatDisplayTime(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    if (s.includes(':')) return s;
    const digits = s.replace(/\D/g, '').padStart(4, '0');
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }

  /**
   * Convert time value to minutes since midnight
   * Supports multiple input formats:
   *   - "13:50" → 830 minutes
   *   - 1350 → 830 minutes
   *   - "08:15" → 495 minutes
   *
   * @param {string|number} t - Time value to convert
   * @returns {number} Minutes since midnight (0-1439) or NaN if invalid
   */
  function toMinutesSinceMidnight(t) {
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

  /**
   * Escape HTML special characters to prevent XSS
   * Converts: &, <, >, ", '
   *
   * @param {string} s - String to escape
   * @returns {string} HTML-safe string
   */
  function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Create a DOM element with optional class and content
   * Convenience wrapper around document.createElement
   *
   * @param {string} tag - HTML tag name (e.g., 'div', 'span')
   * @param {string} className - CSS class name(s) to apply
   * @param {string} innerHTML - HTML content to insert
   * @returns {HTMLElement} Created DOM element
   */
  function createElement(tag, className = '', innerHTML = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML !== undefined && innerHTML !== null) el.innerHTML = innerHTML;
    return el;
  }

  /**
   * Add a student header row to a widget container
   * Used in verbose mode to separate students visually
   *
   * @param {HTMLElement} container - Widget container element
   * @param {string} studentTitle - Student name to display in header
   */
  function addHeader(container, studentTitle = '') {
    const header = createElement('div', 'wu-row wu-row-header', studentTitle);
    container.appendChild(header);
  }

  /**
   * Add a data row to a widget container
   * Creates a 3-column row: student | meta | data
   *
   * Column behavior:
   *   - Student column: Always created (empty div if no title) to maintain grid alignment
   *   - If text2 is provided: meta and data columns are separate
   *   - If only text1 is provided: meta column spans full width
   *
   * @param {HTMLElement} container - Widget container element
   * @param {string} type - Row type CSS class (e.g., 'wu-row-lesson', 'wu-row-exam')
   * @param {string} studentTitle - Student name (empty in compact mode)
   * @param {string} text1 - Content for meta column (date, time, etc.)
   * @param {string} text2 - Content for data column (subject, description, etc.)
   * @param {string} addClass - Additional CSS classes for data column (e.g., 'cancelled', 'exam')
   */
  function addRow(container, type, studentTitle = '', text1 = '', text2 = '', addClass = '') {
    const row = createElement('div');
    row.className = `wu-row ${type}`;

    // Always create student column (empty div if no title) to maintain grid alignment
    const studentCol = createElement('div', 'wu-col wu-col-student', studentTitle);
    row.appendChild(studentCol);

    const metaCol = createElement('div', 'wu-col wu-col-meta', text1);
    row.appendChild(metaCol);

    if (text2 !== '') {
      const dataCol = createElement('div', 'wu-col wu-col-data', text2);
      // Apply additional classes to the data column (e.g., cancelled, substitution, exam)
      if (addClass) {
        dataCol.className = `${dataCol.className} ${addClass}`.trim();
      }
      row.appendChild(dataCol);
    } else if (text1 !== '') {
      // If no text2, make text1 take both columns
      metaCol.className = 'wu-col wu-col-full';
    }

    container.appendChild(row);
  }

  /**
   * Add a full-width row to a widget container
   * Used for messages, warnings, or special content that spans the entire width
   *
   * @param {HTMLElement} container - Widget container element
   * @param {string} type - Row type CSS class (e.g., 'wu-row-message')
   * @param {string} content - HTML content to display
   * @param {string} addClass - Additional CSS classes for the row
   */
  function addFullRow(container, type, content = '', addClass = '') {
    const row = createElement('div');
    row.className = `wu-row ${type}`;

    const fullCol = createElement('div', 'wu-col wu-col-full-width', content);
    if (addClass) {
      fullCol.className = `${fullCol.className} ${addClass}`.trim();
    }
    row.appendChild(fullCol);

    container.appendChild(row);
  }

  /**
   * Create a widget container element with standard classes
   * Container is styled for MagicMirror's display (bright, small, light)
   *
   * @returns {HTMLElement} Container div with wu-widget-container class
   */
  function createContainer() {
    const container = createElement('div');
    container.className = 'wu-widget-container bright small light';
    return container;
  }

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
   * Resolve widget config value with a unified precedence chain:
   * 1) studentConfig.<widgetName>.<configKey>
   * 2) ctx.defaults.<widgetName>.<configKey>
   * 3) optional fallback value
   *
   * @param {Object} studentConfig - Student configuration object from backend
   * @param {Object} ctx - Main module context (optional, used for defaults)
   * @param {string} widgetName - Widget name (e.g., 'lessons', 'grid', 'exams')
   * @param {string} configKey - Configuration key to retrieve
   * @param {Object} options - Resolution options
   * @param {*} [options.fallback] - Optional fallback if no value is found
   * @returns {*} Resolved configuration value
   */
  function getWidgetConfigResolved(studentConfig, ctx, widgetName, configKey, options = {}) {
    const { fallback } = options || {};

    const directValue = getWidgetConfig(studentConfig, widgetName, configKey);
    if (directValue !== undefined) return directValue;

    const defaultValue = ctx?.defaults?.[widgetName]?.[configKey];
    if (defaultValue !== undefined) return defaultValue;

    return fallback;
  }

  /**
   * Check if a lesson or status represents an "irregular" lesson (substitution/replacement/additional).
   * Accepts either a lesson object or a status string.
   *
   * @param {Object|string} lessonOrStatus - Lesson object or REST API status code string
   * @returns {boolean} True if status represents irregular lesson
   */
  function isIrregularStatus(lessonOrStatus) {
    if (typeof lessonOrStatus === 'string') {
      return IRREGULAR_STATUSES.has(String(lessonOrStatus || '').toUpperCase());
    }
    if (lessonOrStatus && typeof lessonOrStatus === 'object') {
      const status = String(lessonOrStatus.status || '').toUpperCase();
      const activityType = String(lessonOrStatus.activityType || '').toUpperCase();
      if (IRREGULAR_STATUSES.has(status)) return true;
      if (IRREGULAR_ACTIVITY_TYPES.has(activityType)) return true;
      return false;
    }
    return false;
  }

  /**
   * Build a Set of field keys that changed in a lesson entry.
   * Considers changedFields array and presence of *Old arrays (suOld, teOld, roOld).
   *
   * @param {Object} entry - Lesson entry object
   * @returns {Set<string>} Set of changed field keys ('su', 'te', 'ro', ...)
   */
  function getChangedFieldSet(entry) {
    const changed = new Set(Array.isArray(entry?.changedFields) ? entry.changedFields : []);
    if (Array.isArray(entry?.suOld) && entry.suOld.length > 0) changed.add('su');
    if (Array.isArray(entry?.teOld) && entry.teOld.length > 0) changed.add('te');
    if (Array.isArray(entry?.roOld) && entry.roOld.length > 0) changed.add('ro');
    return changed;
  }

  /**
   * Return the display name of the first element in a field array (e.g. su, te, ro).
   *
   * @param {Array} entries - Array of field objects with name/longname properties
   * @returns {string} Trimmed display name or empty string
   */
  function getFirstFieldName(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    const first = entries[0] || {};
    return String(first.name || first.longname || '').trim();
  }

  /**
   * Initialize widget utilities and DOM helpers
   * Returns an object with all common widget utilities to reduce boilerplate
   * Provides safe fallbacks if any utility is missing
   *
   * @param {Object} widgetRoot - The MMMWebuntisWidgets root object
   * @returns {Object} Object containing util and dom helper functions
   */
  function resolveWidgetHelpers(widgetRoot) {
    const util = widgetRoot.util || {};
    const dom = widgetRoot.dom || {};
    return {
      log: typeof util.log === 'function' ? util.log : () => {},
      escapeHtml: typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || ''),
      formatDisplayDate: typeof util.formatDisplayDate === 'function' ? util.formatDisplayDate : () => '',
      formatDisplayTime: typeof util.formatDisplayTime === 'function' ? util.formatDisplayTime : () => '',
      toMinutesSinceMidnight: typeof util.toMinutesSinceMidnight === 'function' ? util.toMinutesSinceMidnight : () => NaN,
      getWidgetConfig: typeof util.getWidgetConfig === 'function' ? util.getWidgetConfig : () => undefined,
      getWidgetConfigResolved: typeof util.getWidgetConfigResolved === 'function' ? util.getWidgetConfigResolved : () => undefined,
      addRow: typeof dom.addRow === 'function' ? dom.addRow : () => {},
      addFullRow: typeof dom.addFullRow === 'function' ? dom.addFullRow : () => {},
      addHeader: typeof dom.addHeader === 'function' ? dom.addHeader : () => {},
      createElement: typeof dom.createElement === 'function' ? dom.createElement : () => document.createElement('div'),
      createContainer: typeof dom.createContainer === 'function' ? dom.createContainer : () => document.createElement('div'),
      createWidgetContext:
        typeof util.createWidgetContext === 'function'
          ? util.createWidgetContext
          : () => ({ isVerbose: false, getConfig: () => undefined }),
      initializeWidgetContextAndHeader:
        typeof util.initializeWidgetContextAndHeader === 'function' ? util.initializeWidgetContextAndHeader : () => ({}),
      buildWidgetHeaderTitle: typeof util.buildWidgetHeaderTitle === 'function' ? util.buildWidgetHeaderTitle : () => '',
      // Flexible field configuration functions
      getTeachers: typeof util.getTeachers === 'function' ? util.getTeachers : () => [],
      getSubject: typeof util.getSubject === 'function' ? util.getSubject : () => '',
      getRoom: typeof util.getRoom === 'function' ? util.getRoom : () => '',
      getClass: typeof util.getClass === 'function' ? util.getClass : () => '',
      getStudentGroup: typeof util.getStudentGroup === 'function' ? util.getStudentGroup : () => '',
      getInfo: typeof util.getInfo === 'function' ? util.getInfo : () => '',
      // Lesson status / change helpers
      isIrregularStatus,
      getChangedFieldSet,
      getFirstFieldName,
    };
  }

  /**
   * Create a widget instance configuration wrapper
   * Provides convenient config access and mode detection for all widgets
   *
   * @param {string} widgetName - Widget name (e.g., 'lessons', 'grid', 'exams')
   * @param {Object} studentConfig - Student configuration from backend
   * @param {Object} util - Utility functions object
   * @param {Object|null} ctx - Main module context (optional, used for defaults lookup)
   * @returns {Object} Widget config wrapper with:
   *   - name: Widget name
   *   - config: Student configuration
   *   - isVerbose: True if mode is 'verbose'
   *   - getConfig(key, defaultValueOrOptions): Get resolved widget config value
   *   - log(level, msg): Logging function
   */
  function createWidgetContext(widgetName, studentConfig, util, ctx = null) {
    return {
      name: widgetName,
      config: studentConfig,
      isVerbose: (studentConfig?.mode ?? 'compact') === 'verbose',
      getConfig: (key, optionsOrFallback) => {
        if (optionsOrFallback && typeof optionsOrFallback === 'object' && !Array.isArray(optionsOrFallback)) {
          return getWidgetConfigResolved(studentConfig, ctx, widgetName, key, optionsOrFallback);
        }
        return getWidgetConfigResolved(studentConfig, ctx, widgetName, key, { fallback: optionsOrFallback });
      },
      log: (level, msg) => util?.log?.(level, msg),
    };
  }

  /**
   * Initialize widget context and optionally add header for verbose mode
   * Consolidates common initialization pattern used by all widgets
   *
   * @param {string} widgetName - Widget identifier (e.g., 'exams', 'homework')
   * @param {Object} ctx - Main module context
   * @param {HTMLElement} container - DOM element for widget content
   * @param {string} studentCellTitle - Student name for display
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Object} options - Additional options
   * @param {boolean} options.forceHeader - Always add header regardless of verbose mode (default: false)
   * @returns {Object} { widgetCtx, studentLabelText } - Context and label for compact mode
   */
  function initializeWidgetContextAndHeader(widgetName, ctx, container, studentCellTitle, studentConfig, options = {}) {
    const widgetCtx = createWidgetContext(widgetName, studentConfig, root.util || {}, ctx);
    const studentLabelText = widgetCtx.isVerbose ? '' : studentCellTitle;

    // Add header in verbose mode, or if forceHeader is true
    if (options.forceHeader || (widgetCtx.isVerbose && studentCellTitle !== '')) {
      addHeader(container, buildWidgetHeaderTitle(ctx, widgetName, widgetCtx, studentCellTitle));
    }

    return { widgetCtx, studentLabelText };
  }

  function normalizeDays(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, parsed);
  }

  function widgetDisplayName(ctx, widgetName) {
    const t = (key, fallback) => {
      const translated = ctx?.translate?.(key);
      return translated && translated !== key ? translated : fallback;
    };

    if (widgetName === 'messagesofday') return ctx?.translate?.('messagesofday') || 'Messages of the Day';
    if (widgetName === 'exams') return ctx?.translate?.('exams') || 'Exams';
    if (widgetName === 'homework') return ctx?.translate?.('homework') || 'Homework';
    if (widgetName === 'absences') return ctx?.translate?.('absences') || 'Absences';
    if (widgetName === 'lessons') return t('widget_lessons', 'Lessons');
    if (widgetName === 'grid') return t('widget_timetable', 'Timetable');
    return String(widgetName || 'Widget');
  }

  function widgetFilterLabel(ctx, widgetName, widgetCtx) {
    const t = (key, fallback) => {
      const translated = ctx?.translate?.(key);
      return translated && translated !== key ? translated : fallback;
    };
    const daysLabel = t('widget_filter_days', 'days');
    const weekViewLabel = t('widget_filter_week_view', 'week view');
    const allLabel = t('widget_filter_all', 'all');

    if (!widgetCtx || typeof widgetCtx.getConfig !== 'function') return allLabel;

    const buildRelativeDayWindowLabel = () => {
      const pastDays = normalizeDays(widgetCtx.getConfig('pastDays', 0), 0);
      const nextDays = normalizeDays(widgetCtx.getConfig('nextDays', 0), 0);
      return `-${pastDays}/+${nextDays} ${daysLabel}`;
    };

    if (widgetName === 'grid') {
      const weekView = Boolean(widgetCtx.getConfig('weekView'));
      if (weekView) return weekViewLabel;
      return buildRelativeDayWindowLabel();
    }

    if (widgetName === 'lessons' || widgetName === 'homework' || widgetName === 'absences') {
      return buildRelativeDayWindowLabel();
    }

    if (widgetName === 'exams') {
      const nextDays = normalizeDays(widgetCtx.getConfig('nextDays', 0), 0);
      return `+${nextDays} ${daysLabel}`;
    }

    if (widgetName === 'messagesofday') {
      return allLabel;
    }

    return allLabel;
  }

  function buildWidgetHeaderTitle(ctx, widgetName, widgetCtx, studentName = '') {
    const name = escapeHtml(widgetDisplayName(ctx, widgetName));
    const filter = escapeHtml(widgetFilterLabel(ctx, widgetName, widgetCtx));
    const student = escapeHtml(String(studentName || '').trim());
    const meta = student ? `${student}, ${filter}` : filter;
    return `${name} <span class="wu-header-meta">(${meta})</span>`;
  }

  /**
   * Extract field value from lesson data structure
   * Generic function to extract any field type (teacher, subject, room, class, etc.)
   * Supports both traditional (te/su/ro) and dynamic (cl/sg) fields
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} fieldType - Field type to extract (e.g., 'te', 'su', 'ro', 'cl', 'sg')
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Field value or empty string if not found
   */
  function getFieldValue(lesson, fieldType, format = 'short') {
    if (!lesson) return '';

    const field = lesson[fieldType];
    if (!field || !Array.isArray(field) || field.length === 0) return '';

    const item = field[0];
    if (!item) return '';

    return format === 'long' ? item.longname || item.name : item.name || item.longname;
  }

  /**
   * Get all teachers from lesson (handles multiple teachers)
   * Returns array of teacher names for flexible display
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string[]} Array of teacher names (may be empty)
   */
  function getTeachers(lesson, format = 'short') {
    if (!lesson?.te || !Array.isArray(lesson.te)) return [];
    return lesson.te
      .map((teacher) => (format === 'long' ? teacher.longname || teacher.name : teacher.name || teacher.longname))
      .filter(Boolean);
  }

  /**
   * Get subject name from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Subject name or empty string
   */
  function getSubject(lesson, format = 'short') {
    return getFieldValue(lesson, 'su', format);
  }

  /**
   * Get room name from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Room name or empty string
   */
  function getRoom(lesson, format = 'short') {
    return getFieldValue(lesson, 'ro', format);
  }

  /**
   * Get class name from lesson (useful for teacher view)
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Class name or empty string
   */
  function getClass(lesson, format = 'short') {
    return getFieldValue(lesson, 'cl', format);
  }

  /**
   * Get student group name from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Student group name or empty string
   */
  function getStudentGroup(lesson, format = 'short') {
    return getFieldValue(lesson, 'sg', format);
  }

  /**
   * Get additional info from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Info text or empty string
   */
  function getInfo(lesson, format = 'short') {
    return getFieldValue(lesson, 'info', format);
  }

  root.util = {
    formatYmd,
    formatDisplayTime,
    toMinutesSinceMidnight,
    formatDisplayDate,
    escapeHtml,
    log,
    getWidgetConfig,
    resolveWidgetHelpers,
    getWidgetConfigResolved,
    createWidgetContext,
    initializeWidgetContextAndHeader,
    buildWidgetHeaderTitle,
    isIrregularStatus,
    getChangedFieldSet,
    getFirstFieldName,
    getFieldValue,
    getTeachers,
    getSubject,
    getRoom,
    getClass,
    getStudentGroup,
    getInfo,
  };

  root.dom = {
    createElement,
    addHeader,
    addRow,
    addFullRow,
    createContainer,
  };
})();
