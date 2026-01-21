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

    const levels = { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
    const configured = window.MMMWebuntisLogLevel || 'none';
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

  function addHeader(container, studentTitle = '') {
    const header = createElement('div', 'wu-row wu-row-header', studentTitle);
    container.appendChild(header);
  }

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

  function addFullRow(container, type, content = '', addClass = '') {
    const row = createElement('div');
    row.className = `wu-row ${type}`;

    const fullCol = createElement('div', 'wu-col wu-col-full-width', content);
    // Apply additional classes to the full column
    if (addClass) {
      fullCol.className = `${fullCol.className} ${addClass}`.trim();
    }
    row.appendChild(fullCol);

    container.appendChild(row);
  }

  function createContainer() {
    const container = createElement('div');
    container.className = 'wu-widget-container bright small light';
    return container;
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
      log: typeof util.log === 'function' ? util.log : () => {},
      escapeHtml: typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || ''),
      formatDate: typeof util.formatDate === 'function' ? util.formatDate : () => '',
      formatTime: typeof util.formatTime === 'function' ? util.formatTime : () => '',
      toMinutes: typeof util.toMinutes === 'function' ? util.toMinutes : () => NaN,
      getWidgetConfig: typeof util.getWidgetConfig === 'function' ? util.getWidgetConfig : () => undefined,
      addRow: typeof dom.addRow === 'function' ? dom.addRow : () => {},
      addFullRow: typeof dom.addFullRow === 'function' ? dom.addFullRow : () => {},
      addHeader: typeof dom.addHeader === 'function' ? dom.addHeader : () => {},
      createElement: typeof dom.createElement === 'function' ? dom.createElement : () => document.createElement('div'),
      createContainer: typeof dom.createContainer === 'function' ? dom.createContainer : () => document.createElement('div'),
      createWidgetContext:
        typeof util.createWidgetContext === 'function'
          ? util.createWidgetContext
          : () => ({ isVerbose: false, getConfig: () => undefined }),
      // Flexible field configuration functions
      getTeachers: typeof util.getTeachers === 'function' ? util.getTeachers : () => '',
      getSubject: typeof util.getSubject === 'function' ? util.getSubject : () => '',
      getRoom: typeof util.getRoom === 'function' ? util.getRoom : () => '',
      getClass: typeof util.getClass === 'function' ? util.getClass : () => '',
      getStudentGroup: typeof util.getStudentGroup === 'function' ? util.getStudentGroup : () => '',
      getLessonDisplayMode: typeof util.getLessonDisplayMode === 'function' ? util.getLessonDisplayMode : () => 'auto',
      buildFlexibleLessonDisplay: typeof util.buildFlexibleLessonDisplay === 'function' ? util.buildFlexibleLessonDisplay : null,
    };
  }

  /**
   * Create a widget instance configuration wrapper.
   * Provides convenient config access for all widgets.
   *
   * @param {string} widgetName - Widget name (e.g., 'lessons', 'exams')
   * @param {Object} studentConfig - Student configuration
   * @param {Object} util - Utility functions
   * @returns {Object} Widget config wrapper with helper methods
   */
  function createWidgetContext(widgetName, studentConfig, util) {
    return {
      name: widgetName,
      config: studentConfig,
      isVerbose: (studentConfig?.mode ?? 'compact') === 'verbose',
      getConfig: (key, defaultValue) => getWidgetConfig(studentConfig, widgetName, key) ?? defaultValue,
      log: (level, msg) => util?.log?.(level, msg),
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
    createWidgetContext,
    // New dynamic field utilities
    getFieldValue,
    getTeachers,
    getSubject,
    getRoom,
    getClass,
    getStudentGroup,
    getLessonDisplayMode,
    buildLessonDisplayText,
    // Flexible field configuration
    resolveFieldConfig,
    getConfiguredFieldValue,
    buildFlexibleLessonDisplay,
  };

  /**
   * Extract information from lesson fields flexibly based on available data
   * Supports both traditional (te/su/ro) and dynamic (cl/sg) fields
   */
  function getFieldValue(lesson, fieldType, format = 'short') {
    if (!lesson) return '';

    const field = lesson[fieldType];
    if (!field || !Array.isArray(field) || field.length === 0) return '';

    const item = field[0];
    if (!item) return '';

    // Return short name or long name based on format preference
    return format === 'long' ? item.longname || item.name : item.name || item.longname;
  }

  /**
   * Get all available teachers from lesson (handles multiple teachers)
   */
  function getTeachers(lesson, format = 'short') {
    if (!lesson?.te || !Array.isArray(lesson.te)) return [];
    return lesson.te
      .map((teacher) => (format === 'long' ? teacher.longname || teacher.name : teacher.name || teacher.longname))
      .filter(Boolean);
  }

  /**
   * Get subject information with fallback
   */
  function getSubject(lesson, format = 'short') {
    return getFieldValue(lesson, 'su', format);
  }

  /**
   * Get room information with fallback
   */
  function getRoom(lesson, format = 'short') {
    return getFieldValue(lesson, 'ro', format);
  }

  /**
   * Get class information (for teacher view)
   */
  function getClass(lesson, format = 'short') {
    return getFieldValue(lesson, 'cl', format);
  }

  /**
   * Get student group information
   */
  function getStudentGroup(lesson, format = 'short') {
    return getFieldValue(lesson, 'sg', format);
  }

  /**
   * Determine lesson display mode based on available fields
   * Returns an object with display preferences for the current context
   */
  function getLessonDisplayMode(lesson) {
    const hasTeacher = lesson?.te && lesson.te.length > 0;
    const hasSubject = lesson?.su && lesson.su.length > 0;
    const hasRoom = lesson?.ro && lesson.ro.length > 0;
    const hasClass = lesson?.cl && lesson.cl.length > 0;
    const hasStudentGroup = lesson?.sg && lesson.sg.length > 0;

    // Determine if this appears to be a teacher account (has class info, no student group emphasis)
    const isTeacherView = hasClass && !hasStudentGroup;

    // Determine if this is a student account (has student group, limited class info)
    const isStudentView = hasStudentGroup && !hasClass;

    return {
      isTeacherView,
      isStudentView,
      hasTeacher,
      hasSubject,
      hasRoom,
      hasClass,
      hasStudentGroup,
      // Suggested primary info for different contexts
      primaryInfo: isTeacherView ? 'class' : 'subject',
      secondaryInfo: isTeacherView ? 'room' : 'teacher',
      showStudentGroup: hasStudentGroup && !isTeacherView,
    };
  }

  /**
   * Build flexible lesson display text based on available fields and context
   */
  function buildLessonDisplayText(lesson, options = {}) {
    const {
      showSubject = true,
      showTeacher = true,
      showRoom = false,
      showClass = false,
      showStudentGroup = false,
      format = 'short',
      separator = ' | ',
    } = options;

    const parts = [];

    if (showSubject) {
      const subject = getSubject(lesson, format);
      if (subject) parts.push(subject);
    }

    if (showTeacher) {
      const teachers = getTeachers(lesson, format);
      if (teachers.length > 0) {
        parts.push(teachers.join(', '));
      }
    }

    if (showRoom) {
      const room = getRoom(lesson, format);
      if (room) parts.push(room);
    }

    if (showClass) {
      const className = getClass(lesson, format);
      if (className) parts.push(className);
    }

    if (showStudentGroup) {
      const group = getStudentGroup(lesson, format);
      if (group) parts.push(group);
    }

    return parts.join(separator);
  }

  /**
   * Resolve field configuration from config (uses defaults from MMM-Webuntis.js)
   */
  function resolveFieldConfig(config) {
    const gridConfig = config?.grid?.fields || {};

    // Return config as-is (defaults are already merged by MagicMirror from MMM-Webuntis.js)
    return {
      primary: gridConfig.primary || 'subject',
      secondary: gridConfig.secondary || 'teacher',
      additional: gridConfig.additional || ['room'],
      format: gridConfig.format || {
        subject: 'short',
        teacher: 'short',
        class: 'short',
        room: 'short',
        studentGroup: 'short',
      },
    };
  }

  /**
   * Get field value based on flexible configuration
   */
  function getConfiguredFieldValue(lesson, fieldType, fieldConfig) {
    if (!lesson || !fieldType || fieldType === 'none') return '';

    const format = fieldConfig?.format?.[fieldType] || 'short';

    switch (fieldType) {
      case 'subject':
        return getSubject(lesson, format);
      case 'teacher': {
        const teachers = getTeachers(lesson, format);
        return teachers.length > 0 ? teachers[0] : '';
      }
      case 'room':
        return getRoom(lesson, format);
      case 'class':
        return getClass(lesson, format);
      case 'studentGroup':
        return getStudentGroup(lesson, format);
      default:
        return '';
    }
  }

  /**
   * Build lesson display text using flexible field configuration
   */
  function buildFlexibleLessonDisplay(lesson, config, options = {}) {
    const fieldConfig = resolveFieldConfig(config);
    const { includeAdditional = true } = options;

    const primary = getConfiguredFieldValue(lesson, fieldConfig.primary, fieldConfig);
    const secondary = getConfiguredFieldValue(lesson, fieldConfig.secondary, fieldConfig);

    const parts = { primary, secondary, additional: [] };

    if (includeAdditional && Array.isArray(fieldConfig.additional)) {
      for (const additionalField of fieldConfig.additional) {
        const value = getConfiguredFieldValue(lesson, additionalField, fieldConfig);
        if (value && value !== primary && value !== secondary) {
          parts.additional.push(value);
        }
      }
    }

    return parts;
  }

  root.dom = {
    createElement,
    addHeader,
    addRow,
    addFullRow,
    createContainer,
  };
})();
