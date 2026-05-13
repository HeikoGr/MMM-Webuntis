/**
 * Widget Utilities Module
 * Provides common utility functions for all MMM-Webuntis widgets
 * Functions include: date/time formatting, DOM manipulation, logging, field extraction
 */
(() => {
  const root = window.MMMWebuntisWidgets || {};
  window.MMMWebuntisWidgets = root;

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
   * @param {string} level - Log level
   * @param {...any} args - Log payload
   */
  function log(level, ...args) {
    if (typeof level !== 'string') return;

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
      // Route non-error widget logs through warn so they stay visible in restricted environments.
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
   * Get current time as HHMM integer.
   *
   * @param {Date} [date=new Date()] - Source date object
   * @returns {number} HHMM value (e.g., 1345)
   */
  function currentTimeAsHHMM(date = new Date()) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 0;
    return date.getHours() * 100 + date.getMinutes();
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
      const displayIcons = Array.isArray(lessonOrStatus.displayIcons)
        ? lessonOrStatus.displayIcons.map((icon) => String(icon || '').toUpperCase())
        : [];
      if (IRREGULAR_STATUSES.has(status)) return true;
      if (displayIcons.some((icon) => IRREGULAR_ACTIVITY_TYPES.has(icon))) return true;
      return false;
    }
    return false;
  }

  /**
   * Build a Set of field keys that changed in a lesson entry.
   * Considers changedFields array and presence of canonical previous* arrays.
   *
   * @param {Object} entry - Lesson entry object
   * @returns {Set<string>} Set of changed field keys ('subject', 'teacher', 'room', ...)
   */
  function getChangedFieldSet(entry) {
    const changed = new Set((Array.isArray(entry?.changedFields) ? entry.changedFields : []).filter(Boolean));

    if (Array.isArray(entry?.previousSubjects) && entry.previousSubjects.length > 0) changed.add('subject');
    if (Array.isArray(entry?.previousTeachers) && entry.previousTeachers.length > 0) changed.add('teacher');
    if (Array.isArray(entry?.previousRooms) && entry.previousRooms.length > 0) changed.add('room');

    return changed;
  }

  /**
   * Return first array item when available.
   *
   * @param {Array} entries - Array of values
   * @returns {*} First entry or null
   */
  function getPrimaryFieldEntry(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return entries[0] ?? null;
  }

  /**
   * Resolve a display name from a canonical field value.
   * Supports object values ({ name, longname }) and primitive values (string/number).
   *
   * @param {*} entry - Field value
   * @param {string} format - 'short' prefers name, 'long' prefers longname
   * @returns {string} Trimmed display name or empty string
   */
  function getFieldDisplayName(entry, format = 'short') {
    if (entry === null || entry === undefined) return '';

    if (typeof entry === 'string' || typeof entry === 'number') {
      return String(entry).trim();
    }

    if (typeof entry !== 'object') return '';

    const shortName = String(entry.name ?? '').trim();
    const longName = String(entry.longname ?? '').trim();
    return format === 'long' ? longName || shortName : shortName || longName;
  }

  /**
   * Return the display name of the first element in a canonical field array.
   *
   * @param {Array} entries - Array of field values
   * @param {string} format - 'short' (default) or 'long'
   * @returns {string} Trimmed display name or empty string
   */
  function getFirstFieldName(entries, format = 'short') {
    return getFieldDisplayName(getPrimaryFieldEntry(entries), format);
  }

  /**
   * Compare entries by date, then by start time (ascending).
   *
   * @param {Object} a - Left entry
   * @param {Object} b - Right entry
   * @param {Object} options - Key names for date/time fields
   * @param {string} [options.dateKey='date'] - Date field key (YYYYMMDD)
   * @param {string} [options.timeKey='startTime'] - Time field key (HHMM)
   * @returns {number} Comparator result for Array.sort
   */
  function compareByDateAndStartTime(a, b, options = {}) {
    const dateKey = options.dateKey || 'date';
    const timeKey = options.timeKey || 'startTime';
    return (Number(a?.[dateKey]) || 0) - (Number(b?.[dateKey]) || 0) || (Number(a?.[timeKey]) || 0) - (Number(b?.[timeKey]) || 0);
  }

  function normalizeComparableText(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  /**
   * Initialize widget utilities and DOM helpers
   * Returns an object with all common widget utilities to reduce boilerplate
   * Fails fast if required helpers are missing
   *
   * @param {Object} widgetRoot - The MMMWebuntisWidgets root object
   * @returns {Object} Object containing util and dom helper functions
   */
  function resolveWidgetHelpers(widgetRoot) {
    const util = widgetRoot.util || {};
    const dom = widgetRoot.dom || {};

    const requireFunction = (helperName, fn) => {
      if (typeof fn !== 'function') {
        throw new Error(`[MMM-Webuntis] Missing required helper: ${helperName}`);
      }
      return fn;
    };

    return {
      log: requireFunction('util.log', util.log),
      escapeHtml: requireFunction('util.escapeHtml', util.escapeHtml),
      formatDisplayDate: requireFunction('util.formatDisplayDate', util.formatDisplayDate),
      formatDisplayTime: requireFunction('util.formatDisplayTime', util.formatDisplayTime),
      currentTimeAsHHMM: requireFunction('util.currentTimeAsHHMM', util.currentTimeAsHHMM),
      toMinutesSinceMidnight: requireFunction('util.toMinutesSinceMidnight', util.toMinutesSinceMidnight),
      getWidgetConfig: requireFunction('util.getWidgetConfig', util.getWidgetConfig),
      getWidgetConfigResolved: requireFunction('util.getWidgetConfigResolved', util.getWidgetConfigResolved),
      addRow: requireFunction('dom.addRow', dom.addRow),
      addFullRow: requireFunction('dom.addFullRow', dom.addFullRow),
      addHeader: requireFunction('dom.addHeader', dom.addHeader),
      createElement: requireFunction('dom.createElement', dom.createElement),
      createContainer: requireFunction('dom.createContainer', dom.createContainer),
      createWidgetContext: requireFunction('util.createWidgetContext', util.createWidgetContext),
      initializeWidgetContextAndHeader: requireFunction('util.initializeWidgetContextAndHeader', util.initializeWidgetContextAndHeader),
      buildWidgetHeaderTitle: requireFunction('util.buildWidgetHeaderTitle', util.buildWidgetHeaderTitle),
      // Flexible field configuration functions
      getTeachers: requireFunction('util.getTeachers', util.getTeachers),
      getSubject: requireFunction('util.getSubject', util.getSubject),
      getRoom: requireFunction('util.getRoom', util.getRoom),
      getClass: requireFunction('util.getClass', util.getClass),
      getStudentGroup: requireFunction('util.getStudentGroup', util.getStudentGroup),
      getInfo: requireFunction('util.getInfo', util.getInfo),
      getEmptyDayState: requireFunction('util.getEmptyDayState', util.getEmptyDayState),
      // Lesson status / change helpers
      isIrregularStatus,
      getChangedFieldSet,
      getPrimaryFieldEntry,
      getFieldDisplayName,
      getFirstFieldName,
      compareByDateAndStartTime:
        typeof util.compareByDateAndStartTime === 'function' ? util.compareByDateAndStartTime : compareByDateAndStartTime,
      normalizeComparableText: typeof util.normalizeComparableText === 'function' ? util.normalizeComparableText : normalizeComparableText,
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
   * @param {Object} [options.widgetCtx] - Optional existing widget context to reuse (avoids duplicate creation)
   * @returns {Object} { widgetCtx, studentLabelText } - Context and label for compact mode
   */
  function initializeWidgetContextAndHeader(widgetName, ctx, container, studentCellTitle, studentConfig, options = {}) {
    const widgetCtx = options.widgetCtx || createWidgetContext(widgetName, studentConfig, root.util || {}, ctx);
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

  function coerceDayDate(dayValue) {
    if (dayValue instanceof Date) {
      if (Number.isNaN(dayValue.getTime())) return null;
      return new Date(dayValue.getFullYear(), dayValue.getMonth(), dayValue.getDate());
    }

    const raw = String(dayValue || '').trim();
    if (/^\d{8}$/.test(raw)) {
      const year = parseInt(raw.substring(0, 4), 10);
      const month = parseInt(raw.substring(4, 6), 10) - 1;
      const day = parseInt(raw.substring(6, 8), 10);
      const date = new Date(year, month, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [year, month, day] = raw.split('-').map(Number);
      const date = new Date(year, month - 1, day);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  function getDayYmd(dayValue) {
    const dayDate = coerceDayDate(dayValue);
    if (!dayDate) return null;
    return dayDate.getFullYear() * 10000 + (dayDate.getMonth() + 1) * 100 + dayDate.getDate();
  }

  function translateDayState(ctx, key, fallback) {
    const translated = ctx?.translate?.(key);
    return translated && translated !== key ? translated : fallback;
  }

  function getEmptyDayState(ctx, studentTitle, dayValue) {
    const dayDate = coerceDayDate(dayValue);
    const dateYmd = getDayYmd(dayValue);
    if (!dayDate || !dateYmd) return null;

    const holiday = ctx?.holidayMapByStudent?.[studentTitle]?.[dateYmd] || null;
    if (holiday) {
      return {
        type: 'holiday',
        dateYmd,
        label: String(holiday.longName || holiday.name || '').trim(),
        noticeType: 'holiday',
        rowClass: 'holiday-notice',
        inlineIconClass: 'lesson-inline-icon lesson-inline-icon-holiday',
      };
    }

    const dayNotice = ctx?.dayNoticeMapByStudent?.[studentTitle]?.[dateYmd] || null;
    const noticeKind = String(dayNotice?.kind || '').trim();
    const noticeStatus = String(dayNotice?.status || '')
      .trim()
      .toUpperCase();

    if (noticeKind === 'timetable-restricted' || noticeStatus === 'NOT_ALLOWED') {
      return {
        type: 'timetable-restricted',
        dateYmd,
        label: translateDayState(ctx, 'timetable-restricted', 'Plan gesperrt'),
        noticeType: 'timetable-restricted',
        rowClass: 'empty-day-notice',
        inlineIconClass: 'wu-inline-icon wu-icon-warning',
      };
    }

    if ([0, 6].includes(dayDate.getDay())) {
      return {
        type: 'weekend',
        dateYmd,
        label: translateDayState(ctx, 'weekend', 'Wochenende'),
        noticeType: 'no-lessons',
        rowClass: 'empty-day-notice',
        inlineIconClass: 'wu-inline-icon wu-inline-icon-no-lessons',
      };
    }

    return {
      type: 'no-lessons',
      dateYmd,
      label: translateDayState(ctx, 'no-lessons', 'kein Unterricht'),
      noticeType: 'no-lessons',
      rowClass: 'empty-day-notice',
      inlineIconClass: 'wu-inline-icon wu-inline-icon-no-lessons',
    };
  }

  /**
   * Extract field value from lesson data structure
   * Generic function to extract any canonical field type (teacher, subject, room, class, etc.)
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} fieldType - Canonical field type to extract (e.g., 'teachers', 'subjects')
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Field value or empty string if not found
   */
  function getFieldValue(lesson, fieldType, format = 'short') {
    if (!lesson) return '';

    const field = lesson[fieldType];
    return getFirstFieldName(field, format);
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
    const teachers = Array.isArray(lesson?.teachers) ? lesson.teachers : [];
    if (teachers.length === 0) return [];
    return teachers.map((teacher) => getFieldDisplayName(teacher, format)).filter(Boolean);
  }

  /**
   * Get subject name from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Subject name or empty string
   */
  function getSubject(lesson, format = 'short') {
    return getFieldValue(lesson, 'subjects', format);
  }

  /**
   * Get room name from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Room name or empty string
   */
  function getRoom(lesson, format = 'short') {
    return getFieldValue(lesson, 'rooms', format);
  }

  /**
   * Get class name from lesson (useful for teacher view)
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Class name or empty string
   */
  function getClass(lesson, format = 'short') {
    return getFieldValue(lesson, 'classes', format);
  }

  /**
   * Get student group name from lesson
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} format - Name format: 'short' (default) or 'long'
   * @returns {string} Student group name or empty string
   */
  function getStudentGroup(lesson, format = 'short') {
    return getFieldValue(lesson, 'studentGroups', format);
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
    logLevelWeights: LOG_LEVEL_WEIGHTS,
    formatYmd,
    formatDisplayTime,
    currentTimeAsHHMM,
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
    getPrimaryFieldEntry,
    getFieldDisplayName,
    getFirstFieldName,
    compareByDateAndStartTime,
    normalizeComparableText,
    getFieldValue,
    getTeachers,
    getSubject,
    getRoom,
    getClass,
    getStudentGroup,
    getInfo,
    getEmptyDayState,
  };

  root.dom = {
    createElement,
    addHeader,
    addRow,
    addFullRow,
    createContainer,
  };
})();
