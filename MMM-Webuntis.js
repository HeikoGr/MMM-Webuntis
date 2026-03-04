Module.register('MMM-Webuntis', {
  // Increment this value to ensure browser reloads updated scripts/styles
  _cacheVersion: '2.0.2',

  /**
   * Simple frontend logger factory for widget logging
   * Creates a lightweight logger that respects the configured log level
   * Avoids bundler require() issues by using pure JavaScript
   *
   * @param {string} moduleName - Module name for log prefixes (default: 'MMM-Webuntis')
   * @returns {Object} Logger object with log(level, msg) method
   */
  _createFrontendLogger(moduleName = 'MMM-Webuntis') {
    // Create a logger object for frontend widgets, respecting configured log level
    const METHODS = { error: 'error', warn: 'warn', info: 'warn', debug: 'warn' };
    const levels = { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
    return {
      log(level, msg) {
        try {
          // Use global logLevel if set, otherwise default to 'info'
          const configured = window.MMMWebuntisLogLevel || 'info';
          const configuredLevel = levels[configured] !== undefined ? configured : 'info';
          const msgLevel = levels[level] !== undefined ? level : 'info';

          // Only log if message level is within configured threshold
          if (levels[msgLevel] > levels[configuredLevel]) {
            return;
          }

          const method = METHODS[level] || 'warn';
          // Output to browser console
          // eslint-disable-next-line no-console
          console[method](`${moduleName}: ${msg}`);
        } catch {
          // Ignore logging errors
        }
      },
    };
  },

  /**
   * Generate a random session identifier.
   * Uses a cryptographically secure random number generator when available.
   *
   * @param {number} length - Length of the identifier to generate.
   * @returns {string} Random session identifier consisting of [0-9a-z].
   * @private
   */
  _generateSessionId(length = 9) {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

    // Prefer cryptographically secure random values when available
    const cryptoObj =
      (typeof window !== 'undefined' && window.crypto) ||
      (typeof self !== 'undefined' && self.crypto) ||
      (typeof crypto !== 'undefined' && crypto);

    let result = '';

    if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
      const array = new Uint8Array(length);
      cryptoObj.getRandomValues(array);
      for (let i = 0; i < length; i += 1) {
        // Map each random byte to a character in the alphabet
        const idx = array[i] % alphabet.length;
        result += alphabet.charAt(idx);
      }
      return result;
    }

    // Fallback to Math.random() only if crypto is not available
    for (let i = 0; i < length; i += 1) {
      const idx = Math.floor(Math.random() * alphabet.length);
      result += alphabet.charAt(idx);
    }
    return result;
  },

  defaults: {
    // === GLOBAL OPTIONS ===
    header: 'MMM-Webuntis', // displayed as module title in MagicMirror
    updateInterval: 5 * 60 * 1000, // fetch interval in milliseconds (default: 5 minutes)
    timezone: 'Europe/Berlin', // timezone for date calculations

    // === DEBUG OPTIONS ===
    logLevel: 'none', // One of: "error", "warn", "info", "debug". Default is "info".
    debugDate: null, // set to 'YYYY-MM-DD' to freeze "today" for debugging (null = disabled)
    demoDataFile: null, // optional relative JSON fixture path for frontend demo mode (skips backend/API)
    dumpBackendPayloads: false, // dump raw payloads from backend in ./debug_dumps/ folder
    dumpRawApiResponses: false, // save raw REST API responses to ./debug_dumps/raw_api_*.json

    // === DISPLAY OPTIONS ===
    // Comma-separated list of widgets to render (top-to-bottom).
    // Supported widgets: grid, lessons, exams, homework, absences, messagesofday
    displayMode: 'lessons, exams',
    mode: 'verbose', // 'verbose' (per-student sections) or 'compact' (combined view)
    useClassTimetable: false,

    // === AUTHENTICATION ===
    // username: 'your username', // WebUntis username (leave empty if using studentId/qrcode)
    // password: 'your password', // WebUntis password (leave empty if using studentId/qrcode)
    // school: 'your school',     // WebUntis school name (most likely subdomain)
    // server: 'schoolserver.webuntis.com',  // WebUntis server URL (usually subdomain.webuntis.com)

    // === STUDENTS ===
    // students: [
    //   {
    //     title: 'kids name', // Display name for the student
    //     studentId: 1234, // replace with student ID for individual title
    //     qrcode: null, // optional: untis:// URL from WebUntis QR code
    //   },
    // ],

    // === WIDGET NAMESPACED DEFAULTS ===
    // Per-widget configuration namespaces
    lessons: {
      nextDays: 2, // widget-specific days ahead
      dateFormat: 'EEE', // format for lesson dates
      showStartTime: false, // show lesson start time instead of timeunit
      showRegular: false, // show also regular lessons
      useShortSubject: false, // use short subject names
      showTeacherMode: 'full', // 'off'|'initial'|'full'
      showRoom: false, // show room in lessons widget
      showSubstitution: false, // show substitution info
      naText: 'N/A', // placeholder for changed fields with no current value
    },

    grid: {
      nextDays: 4, // widget-specific days ahead
      pastDays: 0, // widget-specific days past
      weekView: false, // show Monday-Friday calendar week (overrides nextDays/pastDays; auto-advances on Friday after last lesson)
      dateFormat: 'EEE dd.MM.', // format for grid dates
      showNowLine: true, // show current time line
      mergeGap: 15, // minutes gap to merge adjacent lessons
      maxLessons: 0, // max lessons per day (0 = no limit)
      naText: 'N/A', // placeholder for changed fields with no current value

      // Flexible field display configuration
      fields: {
        primary: 'subject', // Primary field to display (subject, teacher, room, class, studentGroup)
        secondary: 'teacher', // Secondary field to display
        additional: ['room'], // Array of additional fields to show as badges
        format: {
          subject: 'long', // 'short' or 'long' name format
          teacher: 'long',
          class: 'short',
          room: 'short',
          studentGroup: 'short',
        },
      },
    },

    exams: {
      nextDays: 21, // widget-specific days ahead
      dateFormat: 'EEE dd.MM.', // format for exam dates
      showSubject: true, // show subject name with exam
      showTeacher: true, // show teacher name with exam
    },

    homework: {
      nextDays: 28, // widget-specific days ahead
      pastDays: 0, // widget-specific days past
      dateFormat: 'EEE dd.MM.', // format for homework dates
      showSubject: true, // show subject name with homework
      showText: true, // show homework description/text
    },

    absences: {
      pastDays: 21, // days in the past to show
      nextDays: 7, // days in the future to show
      dateFormat: 'EEE dd.MM.', // format for absence dates
      showDate: true, // show absence date
      showExcused: true, // show excused/unexcused status
      showReason: true, // show reason for absence
      maxItems: null, // max number of absence entries to show (null = no limit)
    },

    messagesofday: {}, // no specific defaults yet
  },

  /**
   * Return array of CSS files to load for this module
   * Called by MagicMirror during module initialization
   *
   * @returns {string[]} Array of CSS file paths
   */
  getStyles() {
    // Return array of CSS files to load for this module
    return [this.file('MMM-Webuntis.css')];
  },

  /**
   * Called by MagicMirror during module initialization
   * Return array of JavaScript files to load for this module
   *
   * @returns {string[]} Array of JavaScript file paths
   */
  getScripts() {
    // Store logLevel globally so widgets can access it during initialization
    window.MMMWebuntisLogLevel = (this.config && this.config.logLevel) || this.defaults.logLevel || 'info';

    // Always load util.js for widget helpers
    const scripts = [this.file('widgets/util.js')];

    // Map widget keys to their script files
    const widgetScriptMap = {
      lessons: 'widgets/lessons.js',
      exams: 'widgets/exams.js',
      homework: 'widgets/homework.js',
      absences: 'widgets/absences.js',
      grid: 'widgets/grid.js',
      messagesofday: 'widgets/messagesofday.js',
    };

    // Load only scripts for widgets that are enabled in config
    const widgets = Array.from(new Set(this._getDisplayWidgets()));
    for (const widget of widgets) {
      const scriptPath = widgetScriptMap[widget];
      if (!scriptPath) continue;
      scripts.push(this.file(scriptPath));
    }

    return scripts;
  },

  /**
   * Return translation files for supported languages
   * Called by MagicMirror's i18n system
   *
   * @returns {Object} Map of language codes to translation file paths
   */
  getTranslations() {
    // Provide translation files for supported languages
    return {
      en: 'translations/en.json',
      de: 'translations/de.json',
    };
  },

  /**
   * Get global widget API object
   * The widget API is populated by widget scripts (widgets/*.js) at load time
   * Provides access to widget rendering functions and utilities
   *
   * @returns {Object|null} Widget API object or null if not available
   */
  _getWidgetApi() {
    // Return global widget API object if available
    try {
      return window.MMMWebuntisWidgets || null;
    } catch {
      return null;
    }
  },

  _isDemoModeEnabled() {
    const raw = this.config?.demoDataFile;
    return typeof raw === 'string' && raw.trim() !== '';
  },

  _getDemoDataUrl() {
    const raw = String(this.config?.demoDataFile || '')
      .trim()
      .replace(/^\/+/, '');
    if (!raw) return null;
    return this.file(raw);
  },

  _normalizeDemoPayloads(rawData) {
    if (!rawData) return [];
    if (Array.isArray(rawData)) return rawData;
    if (Array.isArray(rawData?.payloads)) return rawData.payloads;
    return [rawData];
  },

  async _loadDemoPayloads() {
    const demoUrl = this._getDemoDataUrl();
    if (!demoUrl) return [];

    const cacheKey = String(this.config?.demoDataFile || '').trim();
    if (this._demoPayloadCacheKey === cacheKey && Array.isArray(this._demoPayloadCache) && this._demoPayloadCache.length > 0) {
      return this._demoPayloadCache;
    }

    const response = await fetch(demoUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`Failed to load demo fixture (${response.status}) from ${demoUrl}`);
    }

    const json = await response.json();
    const payloads = this._normalizeDemoPayloads(json);
    if (!Array.isArray(payloads) || payloads.length === 0) {
      throw new Error(`Demo fixture ${demoUrl} contains no payloads`);
    }

    this._demoPayloadCacheKey = cacheKey;
    this._demoPayloadCache = payloads;
    return payloads;
  },

  async _emitDemoPayload(reason = 'manual') {
    try {
      const payloads = await this._loadDemoPayloads();
      const statusDefaults = {
        timetable: 200,
        exams: 200,
        homework: 200,
        absences: 200,
        messagesOfDay: 200,
      };
      const fetchDefaults = {
        fetchTimetable: true,
        fetchTimegrid: true,
        fetchExams: true,
        fetchHomeworks: true,
        fetchAbsences: true,
        fetchMessagesOfDay: true,
      };

      payloads.forEach((entry, index) => {
        const fallbackTitle = this.config?.students?.[index]?.title || this.config?.students?.[0]?.title || `Demo Student ${index + 1}`;
        const payload = {
          ...(entry || {}),
          title: String(entry?.title || fallbackTitle),
          config: entry?.config || this.config,
          warnings: Array.isArray(entry?.warnings) ? entry.warnings : [],
          apiStatus: { ...statusDefaults, ...(entry?.apiStatus || {}) },
          fetchFlags: { ...fetchDefaults, ...(entry?.fetchFlags || {}) },
          sessionId: this._sessionId,
          id: this.identifier,
        };
        this.socketNotificationReceived('GOT_DATA', payload);
      });

      this._log('debug', `[DEMO] Rendered ${payloads.length} demo payload(s) (${reason})`);
    } catch (error) {
      const msg = `Demo mode failed: ${error?.message || String(error)}`;
      this._log('error', msg);
      this.moduleWarningsSet = this.moduleWarningsSet || new Set();
      this.moduleWarningsSet.add(msg);
      this.updateDom();
    }
  },

  /**
   * Check if a specific widget is enabled in the current displayMode
   *
   * @param {string} name - Widget name to check (e.g., 'grid', 'lessons')
   * @returns {boolean} True if widget is enabled
   */
  _hasWidget(name) {
    // Check if a widget is enabled in the current displayMode
    return this._getDisplayWidgets().includes(String(name).toLowerCase());
  },

  /**
   * Parse displayMode config and return array of enabled widgets
   * Handles special cases:
   *   - 'grid' → ['grid']
   *   - 'list' → ['lessons', 'exams']
   *   - 'lessons,exams,homework' → ['lessons', 'exams', 'homework']
   *
   * Also normalizes aliases (e.g., 'homework' = 'homeworks', 'absence' = 'absences')
   *
   * @returns {string[]} Array of enabled widget names (lowercase, canonical form)
   */
  _getDisplayWidgets() {
    // Extract displayMode from config (e.g. "lessons, exams, grid")
    const raw = this?.config?.displayMode;
    // Normalize to string and lowercase for consistent matching
    const s = raw === undefined || raw === null ? '' : String(raw);
    const lower = s.toLowerCase().trim();

    // Special case: if displayMode is exactly "grid", only show grid widget
    if (lower === 'grid') return ['grid'];
    // Special case: if displayMode is exactly "list", show lessons and exams widgets
    if (lower === 'list') return ['lessons', 'exams'];

    // Split comma-separated list into individual widget names
    const parts = lower
      .split(',')
      .map((p) => p.trim()) // Remove extra whitespace
      .filter(Boolean); // Remove empty strings

    // Map various aliases and singular/plural forms to canonical widget keys
    const map = {
      grid: 'grid',
      list: 'list',
      lessons: 'lessons',
      lesson: 'lessons',
      exams: 'exams',
      exam: 'exams',
      homework: 'homework',
      homeworks: 'homework',
      absences: 'absences',
      absence: 'absences',
      messagesofday: 'messagesofday',
      messages: 'messagesofday',
    };

    // Build output list of widgets to display, avoiding duplicates
    const out = [];
    for (const p of parts) {
      const w = map[p]; // Translate alias to canonical widget name
      if (!w) continue; // Skip unknown entries
      // If "list" is present, add both lessons and exams widgets
      if (w === 'list') {
        if (!out.includes('lessons')) out.push('lessons');
        if (!out.includes('exams')) out.push('exams');
        continue;
      }
      // Add widget if not already included
      if (!out.includes(w)) out.push(w);
    }

    // Fallback: if no valid widgets found, default to lessons and exams
    return out.length > 0 ? out : ['lessons', 'exams'];
  },

  /**
   * Simple log helper to control verbosity from the module config
   * Respects the configured logLevel (none, error, warn, info, debug)
   * Delegates to frontend logger if available, otherwise uses console
   *
   * @param {string} level - Log level ('error', 'warn', 'info', 'debug')
   * @param {...any} args - Arguments to log (strings, objects, etc.)
   */
  _log(level, ...args) {
    // Log messages to frontend logger or browser console, respecting log level
    // If a frontend logger is available, delegate to it. Otherwise fallback to console.
    try {
      const frontendFactory = this._createFrontendLogger;
      if (frontendFactory && !this.frontendLogger) {
        this.frontendLogger = frontendFactory('MMM-Webuntis');
      }
      if (this.frontendLogger && typeof this.frontendLogger.log === 'function') {
        const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        this.frontendLogger.log(level, msg);
        return;
      }
    } catch {
      // ignore and fallback to legacy console behavior
    }

    const levels = { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
    const configured = (this.config && this.config.logLevel) || this.defaults.logLevel || 'none';
    const configuredLevel = levels[configured] !== undefined ? configured : 'none';
    const msgLevel = levels[level] !== undefined ? level : 'info';
    if (levels[msgLevel] <= levels[configuredLevel]) {
      try {
        if (msgLevel === 'error') console.error('[MMM-Webuntis]', ...args);
        else if (msgLevel === 'warn') console.warn('[MMM-Webuntis]', ...args);
        else if (msgLevel === 'info') console.warn('[MMM-Webuntis]', ...args);
        else console.warn('[MMM-Webuntis]', ...args);
      } catch {
        // ignore any console errors
      }
    }
  },

  /**
   * Get DOM helper from widget API
   * The DOM helper provides utility functions for creating widget containers
   * and headers (defined in widgets/util.js)
   *
   * @returns {Object|null} DOM helper object or null if unavailable
   */
  _getDomHelper() {
    // Get DOM helper from widget API, log warning if unavailable
    const helper = this._getWidgetApi()?.dom || null;
    if (!helper) {
      this._log('warn', 'MMM-Webuntis dom helper not available, widget container helpers will be skipped.');
    }
    return helper;
  },

  /**
   * Create a container element for a widget
   * Uses DOM helper if available, otherwise creates a basic div
   *
   * @returns {HTMLElement} Container element with wu-widget-container class
   */
  _createWidgetContainer() {
    // Create a container element for a widget, using helper if available
    const helper = this._getDomHelper();
    if (helper && typeof helper.createContainer === 'function') {
      return helper.createContainer();
    }
    const container = document.createElement('div');
    container.className = 'wu-widget-container bright small light';
    return container;
  },

  /**
   * Determine if a student header should be rendered
   * Headers are shown in verbose mode when multiple students are configured
   *
   * @param {Object} studentConfig - Student configuration object
   * @returns {boolean} True if header should be rendered
   */
  _shouldRenderStudentHeader(studentConfig) {
    // Determine if a student header should be rendered (for verbose mode and multiple students)
    const mode = studentConfig?.mode ?? this.config.mode;
    return mode === 'verbose' && Array.isArray(this.config.students) && this.config.students.length > 1;
  },

  /**
   * Prepare student label for widget rendering
   * In verbose mode with multiple students, adds header to container and returns empty string
   * Otherwise returns student title as label string
   *
   * @param {HTMLElement} container - Container element to add header to
   * @param {string} studentTitle - Student name/title
   * @param {Object} studentConfig - Student configuration object
   * @returns {string} Label string (empty if header was added to container)
   */
  _prepareStudentLabel(container, studentTitle, studentConfig) {
    // Add student header to container if needed, otherwise return label string
    if (this._shouldRenderStudentHeader(studentConfig)) {
      const helper = this._getDomHelper();
      if (helper && typeof helper.addHeader === 'function') {
        helper.addHeader(container, studentTitle);
      }
      return '';
    }
    return studentTitle;
  },

  /**
   * Get sorted list of student titles for widget rendering
   * Sorts alphabetically for consistent display order
   *
   * @returns {string[]} Sorted array of student titles
   */
  _getSortedStudentTitles() {
    // Return sorted list of student titles for rendering widgets
    if (!this.timetableByStudent || typeof this.timetableByStudent !== 'object') return [];
    return Object.keys(this.timetableByStudent).sort();
  },

  /**
   * Invoke a widget renderer function from the widget API
   * Safely calls widget methods with error handling
   *
   * @param {string} widgetKey - Widget name (e.g., 'lessons', 'exams')
   * @param {string} methodName - Method name to call (e.g., 'renderLessonsForStudent')
   * @param {...any} args - Arguments to pass to the widget renderer
   * @returns {any} Result from widget renderer (typically row count)
   */
  _invokeWidgetRenderer(widgetKey, methodName, ...args) {
    // Call a widget renderer function from the widget API, log warning if missing
    const api = this._getWidgetApi();
    const fn = api?.[widgetKey]?.[methodName];
    if (typeof fn !== 'function') {
      this._log('warn', `${widgetKey} widget script not loaded`);
      return 0;
    }
    return fn(this, ...args);
  },

  /**
   * Render widget rows for multiple students
   * Creates a document fragment containing one container per student
   * Only includes containers that actually have content (count > 0)
   *
   * @param {string[]} studentTitles - Array of student titles to render
   * @param {Function} renderRow - Renderer function: (studentTitle, studentLabel, studentConfig, container) => count
   * @returns {DocumentFragment|null} Fragment with widget containers or null if no content
   */
  _renderWidgetTableRows(studentTitles, renderRow) {
    // Render a table of widgets for each student, using the provided row renderer
    // Create a fragment that will contain one container per student (if they have rows).
    const frag = document.createDocumentFragment();

    for (const studentTitle of studentTitles) {
      const studentConfig = this.configByStudent?.[studentTitle] || this.config;
      const container = this._createWidgetContainer();
      const studentLabel = this._prepareStudentLabel(container, studentTitle, studentConfig);
      try {
        const count = renderRow(studentTitle, studentLabel, studentConfig, container);
        if (count > 0) {
          frag.appendChild(container);
        }
      } catch (err) {
        this._log('error', `Error rendering widget for ${studentTitle}:`, err);
      }
    }

    return frag.hasChildNodes() ? frag : null;
  },

  /**
   * Compute today's date as YYYYMMDD integer
   * Uses cached value if available (set during start() or resume())
   * Supports debugDate for testing (frozen date simulation)
   *
   * @returns {number} Date as YYYYMMDD integer (e.g., 20260130)
   */
  _computeTodayYmdValue() {
    // Compute today's date as YYYYMMDD integer, using debugDate if set
    // If debugDate is set, always use it instead of current date
    if (this._currentTodayYmd) return this._currentTodayYmd;
    const now = new Date();
    return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  },

  /**
   * Shift a YYYYMMDD date integer by deltaDays
   * Handles month/year boundaries correctly
   *
   * @param {number} baseYmd - Base date as YYYYMMDD integer (e.g., 20260130)
   * @param {number} deltaDays - Number of days to shift (positive or negative)
   * @returns {number|null} Shifted date as YYYYMMDD integer or null if invalid
   */
  _shiftYmd(baseYmd, deltaDays = 0) {
    // Shift a YYYYMMDD date integer by deltaDays, return new YYYYMMDD integer
    const num = Number(baseYmd);
    if (!Number.isFinite(num)) return null;
    const year = Math.floor(num / 10000);
    const month = Math.floor((num % 10000) / 100) - 1;
    const day = num % 100;
    const date = new Date(year, month, day);
    date.setDate(date.getDate() + deltaDays);
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  },

  /**
   * Build day-level holiday lookup map from holiday ranges
   * Input is a list of ranges ({startDate, endDate, ...}) and output is
   * a map keyed by YYYYMMDD for O(1) per-day lookups in widgets.
   *
   * @param {Array} holidays - Holiday ranges
   * @returns {Object} Map of YYYYMMDD -> holiday object
   */
  _buildHolidayMapFromRanges(holidays) {
    if (!Array.isArray(holidays) || holidays.length === 0) return {};

    const map = {};
    holidays.forEach((holiday) => {
      const startNum = Number(holiday?.startDate);
      const endNum = Number(holiday?.endDate);
      if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return;

      const startY = Math.floor(startNum / 10000);
      const startM = Math.floor((startNum % 10000) / 100) - 1;
      const startD = startNum % 100;
      const endY = Math.floor(endNum / 10000);
      const endM = Math.floor((endNum % 10000) / 100) - 1;
      const endD = endNum % 100;

      const cursor = new Date(startY, startM, startD);
      const endDate = new Date(endY, endM, endD);

      if (Number.isNaN(cursor.getTime()) || Number.isNaN(endDate.getTime())) return;

      while (cursor <= endDate) {
        const ymd = cursor.getFullYear() * 10000 + (cursor.getMonth() + 1) * 100 + cursor.getDate();
        map[ymd] = holiday;
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    return map;
  },

  /**
   * Build configuration object to send to backend
   * Backend performs normalization/default handling for nested widget configs
   *
   * @returns {Object} Config object with session metadata for backend processing
   */
  _buildSendConfig() {
    // Build config object to send to backend.
    // Central normalization/default handling lives in node_helper.js.
    const rawStudents = Array.isArray(this.config.students) ? this.config.students : [];

    const sendConfig = {
      ...this.config,
      students: rawStudents,
      id: this.identifier,
      sessionId: this._sessionId, // Include session ID for config isolation
    };

    // Note: legacy config normalization is performed server-side in node_helper.js.
    // Keep client-side bundle minimal and rely on backend normalization for compatibility.

    // ===== VALIDATE MODULE CONFIG =====
    this._validateAndWarnConfig(sendConfig);

    return sendConfig;
  },

  /**
   * Validate module configuration and collect warnings
   * Checks:
   *   - displayMode contains valid widget names
   *   - logLevel is valid
   *   - Numeric ranges (nextDays, pastDays) are not negative
   *   - Student credentials or parent credentials are configured
   *
   * Warnings are logged and stored in moduleWarningsSet to avoid duplicates
   *
   * @param {Object} config - Configuration object to validate
   */
  _validateAndWarnConfig(config) {
    // Validate config and collect warnings for displayMode, logLevel, numeric ranges, and student setup
    const warnings = [];

    // Validate displayMode
    const validWidgets = ['list', 'grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'];
    if (config.displayMode && typeof config.displayMode === 'string') {
      const widgets = config.displayMode
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean)
        .map((w) => w.toLowerCase());
      const invalid = widgets.filter((w) => !validWidgets.includes(w));
      if (invalid.length > 0) {
        warnings.push(`displayMode contains unknown widgets: "${invalid.join(', ')}". Supported: ${validWidgets.join(', ')}`);
      }
    }

    // Validate logLevel
    const validLogLevels = ['none', 'error', 'warn', 'info', 'debug'];
    if (config.logLevel && !validLogLevels.includes(String(config.logLevel).toLowerCase())) {
      warnings.push(`Invalid logLevel "${config.logLevel}". Use one of: ${validLogLevels.join(', ')}`);
    }

    // Validate numeric ranges
    if (Number.isFinite(config.nextDays) && config.nextDays < 0) {
      warnings.push(`nextDays cannot be negative. Value: ${config.nextDays}`);
    }
    if (Number.isFinite(config.pastDays) && config.pastDays < 0) {
      warnings.push(`pastDays cannot be negative. Value: ${config.pastDays}`);
    }
    if (Number.isFinite(config.grid?.mergeGap) && config.grid.mergeGap < 0) {
      warnings.push(`grid.mergeGap cannot be negative. Value: ${config.grid.mergeGap}`);
    }

    // Check if no students configured AND no parent credentials for auto-discovery
    const hasParentCreds = Boolean((config.username && config.password && config.school) || config.qrcode);
    if (!Array.isArray(config.students) || config.students.length === 0) {
      if (!hasParentCreds) {
        warnings.push(
          'No students configured and no parent credentials provided. Either configure students[] or provide username, password, and school for auto-discovery.'
        );
      } else {
        // Auto-discovery will happen in backend - don't show warning in frontend yet
        this._log('info', 'Empty students[] with parent credentials: waiting for auto-discovery from backend...');
      }
    }

    // Warn for each unique warning
    warnings.forEach((warning) => {
      if (!this.moduleWarningsSet.has(warning)) {
        this.moduleWarningsSet.add(warning);
        this._log('warn', warning);
      }
    });
  },

  /**
   * Store runtime warnings per student so they can be cleared on the next successful fetch
   * @param {string} studentTitle - Student label from the payload
   * @param {string[]} warningsList - Warning messages returned by the backend
   */
  _updateRuntimeWarnings(studentTitle, warningsList) {
    const key = studentTitle || '__module__';
    this.runtimeWarningsByStudent = this.runtimeWarningsByStudent || {};
    if (Array.isArray(warningsList) && warningsList.length > 0) {
      this.runtimeWarningsByStudent[key] = new Set(warningsList);
    } else {
      delete this.runtimeWarningsByStudent[key];
    }
  },

  /**
   * Aggregate the currently active runtime warnings across all students
   * @returns {string[]} Unique runtime warnings still active
   */
  _getRuntimeWarnings() {
    if (!this.runtimeWarningsByStudent) return [];
    const aggregate = new Set();
    Object.values(this.runtimeWarningsByStudent).forEach((warningSet) => {
      if (!warningSet) return;
      if (warningSet instanceof Set) {
        warningSet.forEach((w) => aggregate.add(w));
      } else if (Array.isArray(warningSet)) {
        warningSet.forEach((w) => aggregate.add(w));
      }
    });
    return Array.from(aggregate);
  },

  /**
   * Log runtime warnings once to avoid spamming the console while an outage persists
   * @param {string[]} warningsList - Warning messages returned by the backend
   */
  _logRuntimeWarnings(warningsList) {
    if (!Array.isArray(warningsList) || warningsList.length === 0) return;
    this._runtimeWarningsLogged = this._runtimeWarningsLogged || new Set();
    warningsList.forEach((warning) => {
      if (!this._runtimeWarningsLogged.has(warning)) {
        this._runtimeWarningsLogged.add(warning);
        this._log('warn', `Runtime warning: ${warning}`);
      }
    });
  },

  /**
   * Convert time string or integer to minutes since midnight
   * Supports multiple formats:
   *   - "13:50" → 830 minutes
   *   - 1350 → 830 minutes
   *   - "08:15" → 495 minutes
   *
   * @param {string|number} t - Time value to convert
   * @returns {number} Minutes since midnight (NaN if invalid)
   */
  _toMinutes(t) {
    // Convert time string or integer (e.g. "13:50" or 1350) to minutes since midnight
    const util = this._getWidgetApi()?.util;
    if (util && typeof util.toMinutes === 'function') {
      return util.toMinutes(t);
    }
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
  },

  /**
   * Check if warnings array contains critical errors
   * Critical errors include:
   *   - Authentication failures
   *   - Connection errors (timeout, cannot connect)
   *   - HTTP error status codes (4xx, 5xx)
   *   - Rate limiting
   *
   * @param {string[]} warnings - Array of warning messages
   * @returns {boolean} True if any warning indicates a critical error
   */
  _hasErrorWarnings(warnings = []) {
    // Check if any warnings indicate a critical error (auth, connection, HTTP status)
    if (!Array.isArray(warnings) || warnings.length === 0) return false;
    const pattern = /(authentication failed|cannot connect|timeout|temporarily unavailable|rate limit|http\s*\d{3})/i;
    return warnings.some((w) => pattern.test(String(w)));
  },

  /**
   * Normalize runtime warnings against current effective data and API status.
   *
   * Goals:
   * - Remove stale "No <type> found..." warnings if data for that type exists again.
   * - Remove stale critical connection/auth warnings when all fetched APIs are healthy (2xx).
   *
   * @param {string[]} warningsList - Raw warnings from backend payload
   * @param {Object} context - Runtime context
   * @param {Object} context.effectiveData - Effective data arrays after preserve logic
   * @param {Object} context.apiStatus - API status object from payload.state.api
   * @param {Object} context.fetchFlags - Fetch flags object from payload.state.fetch
   * @returns {string[]} Normalized warnings
   */
  _normalizeRuntimeWarnings(warningsList, context = {}) {
    if (!Array.isArray(warningsList) || warningsList.length === 0) return [];

    const effectiveData = context.effectiveData || {};
    const apiStatus = context.apiStatus || {};
    const fetchFlags = context.fetchFlags || {};
    const warningMeta = Array.isArray(context.warningMeta) ? context.warningMeta : [];

    const metaByMessage = new Map();
    warningMeta.forEach((entry) => {
      const message = String(entry?.message || '');
      if (!message) return;
      metaByMessage.set(message, entry);
    });

    const typeAlias = {
      lesson: 'lessons',
      lessons: 'lessons',
      exam: 'exams',
      exams: 'exams',
      homework: 'homework',
      homeworks: 'homework',
      absence: 'absences',
      absences: 'absences',
      message: 'messages',
      messages: 'messages',
      messagesofday: 'messages',
    };

    const isStatusOk = (status) => {
      const numericStatus = Number(status);
      return Number.isFinite(numericStatus) && numericStatus >= 200 && numericStatus < 300;
    };

    const fetchedApiChecks = [
      { enabled: fetchFlags.timetable, status: apiStatus.timetable },
      { enabled: fetchFlags.exams, status: apiStatus.exams },
      { enabled: fetchFlags.homework, status: apiStatus.homework },
      { enabled: fetchFlags.absences, status: apiStatus.absences },
      { enabled: fetchFlags.messages, status: apiStatus.messages },
    ].filter((entry) => entry.enabled === true);

    const allFetchedApisHealthy = fetchedApiChecks.length > 0 && fetchedApiChecks.every((entry) => isStatusOk(entry.status));

    return warningsList.filter((warning) => {
      const warningText = String(warning || '');
      const warningMetaEntry = metaByMessage.get(warningText) || null;

      if (warningMetaEntry?.kind === 'config') {
        return true;
      }

      if (warningMetaEntry?.kind === 'no_data') {
        const canonicalType =
          typeAlias[String(warningMetaEntry.dataType || '').toLowerCase()] || String(warningMetaEntry.dataType || '').toLowerCase();
        const currentData = effectiveData[canonicalType];
        if (Array.isArray(currentData) && currentData.length > 0) {
          return false;
        }
        return true;
      }

      // For generic API warnings, rely on API status health instead of text patterns.
      if (allFetchedApisHealthy) {
        return false;
      }

      return true;
    });
  },

  /**
   * Decide whether to preserve previous data when new data is empty or fetch failed
   * Preserves data if:
   *   - Previous data exists AND new data is empty
   *   - Data type wasn't fetched (fetchFlag=false)
   *   - API returned error status (>= 400 or 0)
   *   - Warnings contain critical errors (auth, connection)
   *
   * This prevents blank widgets during temporary API outages
   *
   * @param {Array} nextData - New data from backend
   * @param {Array} prevData - Previous cached data
   * @param {boolean} fetchFlag - Whether this data type was actually fetched
   * @param {number} status - HTTP status code from API
   * @param {string[]} warnings - Warning messages from fetch
   * @returns {boolean} True if previous data should be preserved
   */
  _shouldPreserveData(nextData, prevData, fetchFlag, status, warnings) {
    // Decide whether to keep previous data if new data is empty or fetch failed
    const nextIsArray = Array.isArray(nextData);
    const prevIsArray = Array.isArray(prevData);
    const nextEmpty = nextIsArray && nextData.length === 0;
    const prevHasData = prevIsArray && prevData.length > 0;

    if (!prevHasData) return false;
    if (!nextEmpty) return false;

    // If this data type wasn't fetched, keep previous data
    if (fetchFlag === false) return true;

    const numericStatus = Number(status);
    const isBadStatus = Number.isFinite(numericStatus) && (numericStatus === 0 || numericStatus >= 400);
    const hasErrorWarning = this._hasErrorWarnings(warnings);

    return isBadStatus || hasErrorWarning;
  },

  /**
   * Render grid widget for a student
   * Delegates to grid widget script (widgets/grid.js)
   *
   * @param {string} studentTitle - Student name/title
   * @param {Object} studentConfig - Student configuration
   * @param {Array} timetable - Filtered timetable entries
   * @param {Array} homeworks - Homework entries
   * @param {Array} timeUnits - Time slots (periods)
   * @param {Array} exams - Exam entries
   * @param {Array} absences - Absence entries
   * @returns {HTMLElement|null} Grid DOM element or null if widget not loaded
   */
  _renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences) {
    // Render grid widget for a student using widget API
    const api = this._getWidgetApi();
    const fn = api?.grid?.renderGridForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'grid widget script not loaded');
      return null;
    }
    return fn(this, studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences);
  },

  /**
   * Render lessons list widget for a student
   * Delegates to lessons widget script (widgets/lessons.js)
   *
   * @param {HTMLElement} container - Container element to render into
   * @param {string} studentLabel - Student label string (or empty if header added)
   * @param {string} studentTitle - Student name/title
   * @param {Object} studentConfig - Student configuration
   * @param {Array} timetable - Filtered timetable entries
   * @param {Map} startTimesMap - Map of time units for formatting
   * @param {Array} holidays - Holiday entries
   * @returns {number} Number of rendered rows
   */
  _renderListForStudent(container, studentLabel, studentTitle, studentConfig, timetable, startTimesMap, holidays) {
    // Render lessons list widget for a student using widget API
    return this._invokeWidgetRenderer(
      'lessons',
      'renderLessonsForStudent',
      container,
      studentLabel,
      studentTitle,
      studentConfig,
      timetable,
      startTimesMap,
      holidays
    );
  },

  /**
   * Render exams widget for a student
   * Delegates to exams widget script (widgets/exams.js)
   *
   * @param {HTMLElement} container - Container element to render into
   * @param {string} studentLabel - Student label string
   * @param {Object} studentConfig - Student configuration
   * @param {Array} exams - Exam entries
   * @returns {number} Number of rendered rows
   */
  _renderExamsForStudent(container, studentLabel, studentConfig, exams) {
    // Render exams widget for a student using widget API
    return this._invokeWidgetRenderer('exams', 'renderExamsForStudent', container, studentLabel, studentConfig, exams);
  },

  /**
   * Render homework widget for a student
   * Delegates to homework widget script (widgets/homework.js)
   *
   * @param {HTMLElement} container - Container element to render into
   * @param {string} studentLabel - Student label string
   * @param {Object} studentConfig - Student configuration
   * @param {Array} homeworks - Homework entries
   * @returns {number} Number of rendered rows
   */
  _renderHomeworksForStudent(container, studentLabel, studentConfig, homeworks) {
    // Render homework widget for a student using widget API
    return this._invokeWidgetRenderer('homework', 'renderHomeworksForStudent', container, studentLabel, studentConfig, homeworks);
  },

  /**
   * Render absences widget for a student
   * Delegates to absences widget script (widgets/absences.js)
   *
   * @param {HTMLElement} container - Container element to render into
   * @param {string} studentLabel - Student label string
   * @param {Object} studentConfig - Student configuration
   * @param {Array} absences - Absence entries
   * @returns {number} Number of rendered rows
   */
  _renderAbsencesForStudent(container, studentLabel, studentConfig, absences) {
    // Render absences widget for a student using widget API
    return this._invokeWidgetRenderer('absences', 'renderAbsencesForStudent', container, studentLabel, studentConfig, absences);
  },

  /**
   * Render messages of day widget for a student
   * Delegates to messagesofday widget script (widgets/messagesofday.js)
   *
   * @param {HTMLElement} container - Container element to render into
   * @param {string} studentLabel - Student label string
   * @param {Object} studentConfig - Student configuration
   * @param {Array} messagesOfDay - Message entries
   * @returns {number} Number of rendered rows
   */
  _renderMessagesOfDayForStudent(container, studentLabel, studentConfig, messagesOfDay) {
    // Render messages of day widget for a student using widget API
    return this._invokeWidgetRenderer(
      'messagesofday',
      'renderMessagesOfDayForStudent',
      container,
      studentLabel,
      studentConfig,
      messagesOfDay
    );
  },

  /**
   * Module initialization - called by MagicMirror at startup
   *
   * Performs:
   *   1. Store log level in global config for widget access
   *   2. Initialize data storage structures (timetableByStudent, examsByStudent, etc.)
   *   3. Generate unique session ID for browser window isolation
   *   4. Parse and set debugDate if configured (frozen date for testing)
   *   5. Defer INIT_MODULE until first visible resume() (avoids hidden-start fetches)
   *
   * Multi-instance support: Each instance should have a unique identifier in config.js
   */
  start() {
    // --- 1. Session Context & Identifiers ---
    // Generate unique session ID for this browser window/tab instance
    // IMPORTANT: Memory-only - each browser window must have its own unique sessionId for proper isolation
    this._sessionId = this._generateSessionId(9);

    // Multi-instance support via explicit identifiers.
    // For multiple MMM-Webuntis instances, you MUST add unique 'identifier' fields in config.js:
    // { module: 'MMM-Webuntis', identifier: 'student_alice', position: '...', config: { ... } }
    // Without explicit identifiers, MagicMirror will auto-assign them (MMM-Webuntis_0, MMM-Webuntis_1, etc)
    if (this.identifier) {
      this._log('debug', `[start] Using explicit identifier from config: ${this.identifier}`);
    } else {
      this._log('warn', '[start] No explicit identifier set. For multiple instances, add "identifier" to module config in config.js');
    }
    this._log('info', `[start] identifier="${this.identifier}", sessionId="${this._sessionId}" (memory-only, unique per window)`);

    // --- 2. Global Config & Environment ---
    // Store logLevel in global config so widgets can access it independently
    if (typeof window !== 'undefined') {
      window.MMMWebuntisConfig = window.MMMWebuntisConfig || {};
      window.MMMWebuntisConfig.logLevel = this.config.logLevel || this.defaults.logLevel || 'info';
    }

    // Ensure we always have a locale string for widgets.
    try {
      if (!this.config.language && typeof config !== 'undefined' && config && config.language) {
        this.config.language = config.language;
      }
    } catch {
      // ignore
    }

    // Initialize module-level today value. If `debugDate` is configured, use it
    // (accepts 'YYYY-MM-DD' or 'YYYYMMDD'), otherwise use the real current date.
    // NOTE: debugDate is never persisted across fetch cycles - always read from config
    if (this.config && typeof this.config.debugDate === 'string' && this.config.debugDate) {
      const s = String(this.config.debugDate).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(s + 'T00:00:00');
        this._currentTodayYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        this._log('debug', `[start] debugDate="${s}" (frozen test mode)`);
      } else if (/^\d{8}$/.test(s)) {
        const by = parseInt(s.substring(0, 4), 10);
        const bm = parseInt(s.substring(4, 6), 10) - 1;
        const bd = parseInt(s.substring(6, 8), 10);
        const d = new Date(by, bm, bd);
        this._currentTodayYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        const normalizedDate = `${String(by).padStart(4, '0')}-${String(bm + 1).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
        this._log('debug', `[start] debugDate="${normalizedDate}" (frozen test mode)`);
      }
    }
    if (!this._currentTodayYmd) {
      const now = new Date();
      this._currentTodayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    }

    // --- 3. Initial State & Data Objects ---
    this.timetableByStudent = {};
    this.examsByStudent = {};
    this.configByStudent = {};
    this.timeUnitsByStudent = {};
    this.periodNamesByStudent = {};
    this.homeworksByStudent = {};
    this.absencesByStudent = {};
    this.absencesUnavailableByStudent = {};
    this.messagesOfDayByStudent = {};
    this.holidaysByStudent = {};
    this.holidayMapByStudent = {};
    this.preprocessedByStudent = {};

    this.moduleWarningsSet = new Set();
    this.runtimeWarningsByStudent = {};
    this._runtimeWarningStreakByStudent = {};
    this._runtimeWarningsLogged = new Set();

    this._updateDomTimer = null; // Timer for batching multiple GOT_DATA updates
    this._initialized = false; // Track initialization status
    this._initRequested = false; // Track whether INIT_MODULE was already sent

    // Track if module has been resumed at least once (MagicMirror calls resume() on all modules at startup)
    // We want to skip the initial resume() call to avoid duplicate FETCH_DATA with post-init
    this._hasBeenResumedOnce = false;

    // Track when data was last received to optimize resume() behavior
    // (prevents unnecessary API calls during rapid carousel page switches)
    this._lastDataReceivedAt = null;

    // --- 4. Visibility & Timers ---
    this._paused = this._isModuleSuspended();
    if (this._paused) {
      this._log('debug', '[start] Module starts hidden/suspended, deferring timers until resume()');
    } else {
      this._startNowLineUpdater();
    }
    this._sendSessionState(this._paused ? 'paused' : 'active', 'start');

    // --- 5. Special Modes (Demo) ---
    // Optional demo mode: load local fixture payload in frontend and skip backend/API entirely.
    if (this._isDemoModeEnabled()) {
      this._initialized = true;
      this._initializedAt = Date.now();
      this._log('info', `[DEMO] Enabled with fixture "${this.config.demoDataFile}"`);
      this._emitDemoPayload('start');
      this._startFetchTimer();
      return;
    }

    // Defer backend initialization until module is actually visible (resume)
    // to avoid unnecessary initial fetches on hidden carousel slides.

    this._log('info', 'MMM-Webuntis initializing with config:', this.config);
  },

  // ===== Visibility & Timer State =====

  /**
   * Start the now line updater for grid view
   * The now line shows current time position in the grid widget
   * Only starts if showNowLine config is not explicitly disabled
   */
  _startNowLineUpdater() {
    // Start the now line updater for grid view if enabled
    if (this.config?.grid?.showNowLine === false) return;
    const fn = this._getWidgetApi()?.grid?.startNowLineUpdater;
    if (typeof fn === 'function') fn(this);
  },

  /**
   * Stop the now line updater for grid view
   * Called during suspend() to stop unnecessary timer updates
   */
  _stopNowLineUpdater() {
    // Stop the now line updater for grid view
    const fn = this._getWidgetApi()?.grid?.stopNowLineUpdater;
    if (typeof fn === 'function') fn(this);
  },

  /**
   * Check whether module is currently hidden/suspended by MagicMirror
   *
   * @returns {boolean} True if module should be treated as suspended
   */
  _isModuleSuspended() {
    return this._paused === true || this.hidden === true || this.data?.hidden === true;
  },

  /**
   * Start periodic data fetch timer
   * Sends FETCH_DATA to backend at configured updateInterval
   * Timer is skipped if module is paused or interval is invalid
   */
  _startFetchTimer() {
    // Start periodic data fetch timer based on updateInterval
    if (this._isModuleSuspended()) {
      this._paused = true;
      return;
    }
    if (this._fetchTimer) return;
    const interval = typeof this.config?.updateInterval === 'number' ? Number(this.config.updateInterval) : null;
    if (!interval || !Number.isFinite(interval) || interval <= 0) return;

    this._fetchTimer = setInterval(() => {
      if (this._isModuleSuspended()) {
        this._paused = true;
        this._stopFetchTimer();
        return;
      }
      this._sendFetchData('periodic');
    }, interval);
  },

  // ===== Socket Notifications =====

  /**
   * Notify backend about current session visibility state
   *
   * @param {'paused'|'active'} state - Session state from frontend lifecycle
   * @param {string} reason - Lifecycle reason
   */
  _sendSessionState(state, reason = 'manual') {
    this.sendSocketNotification('SESSION_STATE', {
      id: this.identifier,
      sessionId: this._sessionId,
      state,
      reason,
    });
  },

  /**
   * Send INIT_MODULE notification to backend
   * Triggers one-time module initialization (config validation, student discovery)
   * Backend responds with MODULE_INITIALIZED when ready
   *
   * @param {string} reason - Reason for initialization trigger
   */
  _sendInit(reason = 'manual') {
    // Send INIT_MODULE notification to backend with config
    this._log('debug', `[INIT] Sending INIT_MODULE to backend (reason=${reason})`);
    this.sendSocketNotification('INIT_MODULE', {
      ...this._buildSendConfig(),
      reason,
    });
  },

  /**
   * Send FETCH_DATA notification to backend for data refresh
   * Only sends if module is initialized (prevents fetch before init)
   * Stores pending resume request if called during initialization
   *
   * @param {string} reason - Reason for fetch ('manual', 'periodic', 'resume')
   */
  _sendFetchData(reason = 'manual') {
    // Send FETCH_DATA notification to backend, unless not initialized
    // Prevent fetch before initialization is complete
    if (this._isDemoModeEnabled()) {
      this._emitDemoPayload(reason);
      return;
    }

    // Hard guard: never send FETCH_DATA while module is suspended/paused.
    // This covers timer race conditions where a queued callback might still fire
    // right around suspend().
    if (this._paused) {
      this._log('debug', `[FETCH_DATA] Skipped while suspended (reason=${reason})`);
      return;
    }

    if (!this._initialized) {
      // Store pending resume request to execute after initialization
      if (reason === 'resume') {
        this._pendingResumeRequest = true;
      }
      return;
    }

    this.sendSocketNotification('FETCH_DATA', {
      ...this._buildSendConfig(),
      reason,
    });
  },

  /**
   * Stop periodic data fetch timer
   * Called during suspend() to stop unnecessary fetch attempts
   */
  _stopFetchTimer() {
    // Stop periodic data fetch timer
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
    }
  },

  // ===== Lifecycle Hooks =====

  /**
   * Suspend module - called by MagicMirror when module becomes hidden
   * Stops all timers to reduce unnecessary processing:
   *   - Now line updater (grid widget)
   *   - Periodic fetch timer
   *   - DOM update batching timer
   */
  suspend() {
    this._log('info', '[suspend] Module suspended');
    this._paused = true;
    this._stopNowLineUpdater();
    this._stopFetchTimer();

    // Clear update dom timer batching
    if (this._updateDomTimer) {
      clearTimeout(this._updateDomTimer);
      this._updateDomTimer = null;
    }

    this._sendSessionState('paused', 'suspend');
  },

  /**
   * Resume module - called by MagicMirror when module becomes visible
   *
   * Performs:
   *   1. Aborts immediately if module is secretly hidden (e.g. MMM-Carousel background loading)
   *   2. Starts visual timers and background data loops
   *   3. Detects midnight/date rollovers across sleep
   *   4. Lazily triggers initialization OR smart-fetches stale data if needed
   */
  resume() {
    this._log('debug', `[resume] Module resumed (hidden=${this.hidden}, config.debugDate=${this.config?.debugDate})`);

    // 1. Guard against startup race: MagicMirror may call resume() while module is still hidden
    if (this.hidden === true || this.data?.hidden === true) {
      this._paused = true;
      this._sendSessionState('paused', 'resume-while-hidden');
      return;
    }

    this._paused = false;
    this._sendSessionState('active', 'resume');

    // 2. Start recurrent visual/fetch timers now that module is visible
    this._startFetchTimer();
    this._startNowLineUpdater();

    // 3. Handle midnight / date rollover (only if not using a fixed debug test date)
    if (!this.config?.debugDate) {
      const now = new Date();
      const realTodayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
      if (this._currentTodayYmd !== realTodayYmd) {
        this._log('debug', `[resume] Detected day change while suspended: ${this._currentTodayYmd || 'unset'} -> ${realTodayYmd}`);
        this._currentTodayYmd = realTodayYmd;
      }
    }

    // 4. Initialization: Sent only once upon first visible resume
    if (!this._initialized && !this._initRequested) {
      this._initRequested = true;
      this._sendInit('first-visible-resume');
      return; // Backend auto-triggers the first FETCH_DATA internally upon init success
    }

    // 5. Initial MagicMirror boot cycle skip (MagicMirror aggressively calls resume() on all modules at boot)
    if (!this._hasBeenResumedOnce) {
      this._hasBeenResumedOnce = true;
      return;
    }

    // 6. Carousel Optimization: Only trigger a fetch if data is actually stale
    const dataAge = this._lastDataReceivedAt ? Date.now() - this._lastDataReceivedAt : Infinity;
    const interval = this.config?.updateInterval || 5 * 60 * 1000; // Default: 5 minutes

    if (dataAge >= interval) {
      this._log('debug', `[resume] Data is stale (age=${Math.round(dataAge / 1000)}s), sending FETCH_DATA...`);
      this._sendFetchData('resume-stale-data');
    } else {
      this._log(
        'debug',
        `[resume] Data is fresh (age=${Math.round(dataAge / 1000)}s < ${Math.round(interval / 1000)}s), skipping duplicate fetch`
      );
    }
  },

  getDom() {
    // Build and return DOM for module, rendering widgets and warnings
    const wrapper = document.createElement('div');
    const widgets = this._getDisplayWidgets();
    const withWarningIcon = (element, text) => {
      const icon = document.createElement('span');
      icon.className = 'wu-inline-icon wu-icon-warning';
      icon.setAttribute('aria-hidden', 'true');
      element.replaceChildren(icon, document.createTextNode(` ${text}`));
    };

    const sortedStudentTitles = this._getSortedStudentTitles();

    // Render any module-level warnings once, above all widgets
    if (this.moduleWarningsSet && this.moduleWarningsSet.size > 0) {
      const warnContainer = document.createDocumentFragment();
      for (const w of Array.from(this.moduleWarningsSet)) {
        const warnDiv = document.createElement('div');
        // Add critical class for dependency-related warnings
        const isCritical = w.includes('Dependency issues') || w.includes('npm install') || w.includes('node_modules');
        warnDiv.className = isCritical ? 'mmm-webuntis-warning critical small bright' : 'mmm-webuntis-warning small bright';
        try {
          withWarningIcon(warnDiv, w);
        } catch {
          withWarningIcon(warnDiv, 'Configuration warning');
        }
        warnContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(warnContainer);
    }

    const runtimeWarnings = this._getRuntimeWarnings();
    if (runtimeWarnings.length > 0) {
      const runtimeContainer = document.createDocumentFragment();
      for (const warning of runtimeWarnings) {
        const warnDiv = document.createElement('div');
        warnDiv.className = 'mmm-webuntis-warning runtime small bright';
        try {
          withWarningIcon(warnDiv, warning);
        } catch {
          withWarningIcon(warnDiv, 'Fetch warning');
        }
        runtimeContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(runtimeContainer);
    }

    if (sortedStudentTitles.length === 0) {
      return wrapper;
    }

    // demo transformations are applied when data arrives per-student to avoid interfering with live updates

    for (const widget of widgets) {
      if (widget === 'grid') {
        for (const studentTitle of sortedStudentTitles) {
          const timetable = this.timetableByStudent[studentTitle] || [];
          const studentConfig = this.configByStudent[studentTitle] || this.config;
          const timeUnits = this.timeUnitsByStudent[studentTitle] || [];
          const homeworks = this.homeworksByStudent?.[studentTitle] || [];
          const exams = this.examsByStudent?.[studentTitle] || [];
          const holidays = this.holidaysByStudent?.[studentTitle] || [];

          // Render grid if we have timeUnits OR holidays
          // This ensures the grid is shown even during holidays when there are no lessons/timeUnits
          const hasHolidays = holidays.length > 0;
          if (timeUnits.length > 0 || hasHolidays) {
            try {
              const absences = this.absencesByStudent?.[studentTitle] || [];
              const gridElem = this._renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences);
              if (gridElem) {
                wrapper.appendChild(gridElem);
              }
            } catch (error) {
              this._log('error', `Failed to render grid widget for ${studentTitle}: ${error.message}`);
              const errorDiv = document.createElement('div');
              errorDiv.className = 'widget-error dimmed';
              withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: 'Grid' }));
              wrapper.appendChild(errorDiv);
            }
          }
        }
        continue;
      }

      if (widget === 'lessons') {
        try {
          const lessonsContainer = this._renderWidgetTableRows(
            sortedStudentTitles,
            (studentTitle, studentLabel, studentConfig, container) => {
              const timetable = this.timetableByStudent[studentTitle] || [];
              const startTimesMap = this.periodNamesByStudent?.[studentTitle] || {};
              const holidays = this.holidaysByStudent?.[studentTitle] || [];
              return this._renderListForStudent(container, studentLabel, studentTitle, studentConfig, timetable, startTimesMap, holidays);
            }
          );
          if (lessonsContainer) {
            wrapper.appendChild(lessonsContainer);
          }
        } catch (error) {
          this._log('error', `Failed to render lessons widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: 'Lessons' }));
          wrapper.appendChild(errorDiv);
        }
        continue;
      }

      if (widget === 'exams') {
        try {
          const examsContainer = this._renderWidgetTableRows(
            sortedStudentTitles,
            (studentTitle, studentLabel, studentConfig, container) => {
              const exams = this.examsByStudent?.[studentTitle] || [];
              if (!Array.isArray(exams) || Number(studentConfig?.exams?.nextDays ?? 0) <= 0) return 0;
              return this._renderExamsForStudent(container, studentLabel, studentConfig, exams);
            }
          );
          if (examsContainer) wrapper.appendChild(examsContainer);
        } catch (error) {
          this._log('error', `Failed to render exams widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: 'Exams' }));
          wrapper.appendChild(errorDiv);
        }
        continue;
      }

      if (widget === 'homework') {
        try {
          const homeworkContainer = this._renderWidgetTableRows(
            sortedStudentTitles,
            (studentTitle, studentLabel, studentConfig, container) => {
              const homeworks = this.homeworksByStudent?.[studentTitle] || [];
              return this._renderHomeworksForStudent(container, studentLabel, studentConfig, homeworks);
            }
          );
          if (homeworkContainer) wrapper.appendChild(homeworkContainer);
        } catch (error) {
          this._log('error', `Failed to render homework widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: 'Homework' }));
          wrapper.appendChild(errorDiv);
        }
        continue;
      }

      if (widget === 'absences') {
        // Check if absences are unavailable due to parent account limitation
        const hasUnavailableAbsences = sortedStudentTitles.some((title) => this.absencesUnavailableByStudent?.[title]);
        if (hasUnavailableAbsences) {
          const infoDiv = document.createElement('div');
          infoDiv.className = 'dimmed small absences-unavailable-info';
          withWarningIcon(infoDiv, this.translate('absences_unavailable_parent_account'));
          wrapper.appendChild(infoDiv);
        }

        try {
          const absencesContainer = this._renderWidgetTableRows(
            sortedStudentTitles,
            (studentTitle, studentLabel, studentConfig, container) => {
              const absences = this.absencesByStudent?.[studentTitle] || [];
              return this._renderAbsencesForStudent(container, studentLabel, studentConfig, absences);
            }
          );
          if (absencesContainer) wrapper.appendChild(absencesContainer);
        } catch (error) {
          this._log('error', `Failed to render absences widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: 'Absences' }));
          wrapper.appendChild(errorDiv);
        }
        continue;
      }

      if (widget === 'messagesofday') {
        try {
          const messagesContainer = this._renderWidgetTableRows(
            sortedStudentTitles,
            (studentTitle, studentLabel, studentConfig, container) => {
              const messagesOfDay = this.messagesOfDayByStudent?.[studentTitle] || [];
              return this._renderMessagesOfDayForStudent(container, studentLabel, studentConfig, messagesOfDay);
            }
          );
          if (messagesContainer) wrapper.appendChild(messagesContainer);
        } catch (error) {
          this._log('error', `Failed to render messagesofday widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          withWarningIcon(errorDiv, this.translate('widget_render_error', { widget: 'Messages of Day' }));
          wrapper.appendChild(errorDiv);
        }
        continue;
      }
    }

    return wrapper;
  },

  notificationReceived(notification) {
    // Handle MagicMirror notifications (e.g. DOM_OBJECTS_CREATED for legacy config warnings)
    if (notification === 'DOM_OBJECTS_CREATED') {
      // Display deprecation warnings if legacy config keys are detected
      if (this.config.__legacyUsed && this.config.__legacyUsed.length > 0) {
        this._log('warn', `⚠️ DEPRECATED CONFIG DETECTED: ${this.config.__legacyUsed.join(', ')}`);
        this._log('warn', 'Your configuration uses deprecated keys that will be removed in future versions.');
        this._log('warn', 'Please update your config.js to use the new configuration format.');
        this._log('warn', 'See the module documentation for migration details.');
      }
    }
  },

  // ===== Socket Notification Handlers =====

  socketNotificationReceived(notification, payload) {
    if (!this._isValidTargetInstance(payload)) return;

    switch (notification) {
      case 'MODULE_INITIALIZED':
        this._handleModuleInitialized(payload);
        break;

      case 'INIT_ERROR':
        this._handleInitError(payload);
        break;

      case 'CONFIG_WARNING':
      case 'CONFIG_ERROR':
        this._handleConfigIssues(payload);
        break;

      case 'GOT_DATA':
        this._handleGotData(payload);
        break;

      default:
        // Ignore unknown notifications
        break;
    }
  },

  /**
   * Ensure the payload matches the current module instance's sessionId or identifier
   */
  _isValidTargetInstance(payload) {
    if (payload?.sessionId && this._sessionId !== payload.sessionId) return false;
    if (payload?.id && !payload?.sessionId && this.identifier !== payload.id) return false;
    return true;
  },

  _handleModuleInitialized(payload) {
    if (this._initialized) {
      this._log('debug', `[MODULE_INITIALIZED] sessionId=${payload?.sessionId} Already initialized, ignoring duplicate notification`);
      return;
    }

    this._log('info', `Module initialized successfully, sessionId=${payload?.sessionId}`);
    this._initialized = true;
    this._initializedAt = Date.now();

    if (this._pendingResumeRequest) {
      this._log('debug', '[MODULE_INITIALIZED] Clearing pending resume request (backend handles initial fetch)');
      this._pendingResumeRequest = false;
    }

    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      this.moduleWarningsSet = this.moduleWarningsSet || new Set();
      payload.warnings.forEach((w) => {
        if (!this.moduleWarningsSet.has(w)) {
          this.moduleWarningsSet.add(w);
          this._log('warn', `Init warning: ${w}`);
        }
      });
    }

    this._log('debug', '[MODULE_INITIALIZED] Backend will auto-fetch data, starting periodic timer only');
    this._startFetchTimer();
  },

  _handleInitError(payload) {
    this._log('error', `Module initialization failed (sessionId=${payload?.sessionId}):`, payload.message || 'Unknown error');
    if (Array.isArray(payload.errors)) {
      payload.errors.forEach((err) => this._log('error', `  - ${err}`));
    }
    if (Array.isArray(payload.warnings)) {
      payload.warnings.forEach((warn) => this._log('warn', `  - ${warn}`));
    }
    this._initialized = false;
    this.updateDom();
  },

  _handleConfigIssues(payload) {
    const warnList = Array.isArray(payload?.warnings) ? payload.warnings : [];
    this.moduleWarningsSet = this.moduleWarningsSet || new Set();
    warnList.forEach((w) => {
      if (!this.moduleWarningsSet.has(w)) {
        this.moduleWarningsSet.add(w);
        this._log('warn', `Config warning: ${w}`);
        if (w.includes('Dependency issues') || w.includes('npm install')) {
          this._log('error', `CRITICAL: ${w}`);
        }
      }
    });
    this.updateDom();
  },

  _handleGotData(payload) {
    if (Number(payload?.contractVersion) !== 2) {
      this._log('warn', `[GOT_DATA] Ignored unsupported contractVersion=${payload?.contractVersion}`);
      return;
    }

    const title = payload?.context?.student?.title;
    if (!title) {
      this._log('warn', '[GOT_DATA] Missing context.student.title in payload');
      return;
    }

    this._log('debug', `[GOT_DATA] Received for student=${title}, sessionId=${payload?.sessionId}`);
    this._lastDataReceivedAt = Date.now();
    this.configByStudent[title] = payload?.context?.config || {};

    this._syncDebugDate(this.configByStudent[title]);
    this._processPayloadData(title, payload);
    this._processGotDataWarnings(title, payload);

    // Update DOM immediately
    if (this._updateDomTimer) {
      clearTimeout(this._updateDomTimer);
      this._updateDomTimer = null;
    }
    this.updateDom();
  },

  _syncDebugDate(cfg) {
    this._log('debug', `[GOT_DATA] Before filter: _currentTodayYmd=${this._currentTodayYmd}, cfg.debugDate=${cfg?.debugDate}`);
    if (cfg && typeof cfg.debugDate === 'string' && cfg.debugDate) {
      this._log('debug', `[GOT_DATA] Using debugDate="${cfg.debugDate}" from backend`);
      const dbgNum = Number(String(cfg.debugDate).trim().replace(/-/g, ''));
      if (Number.isFinite(dbgNum) && dbgNum > 0) {
        this._currentTodayYmd = dbgNum;
        this._log('debug', `[GOT_DATA] Updated _currentTodayYmd=${dbgNum} (before timetable filtering)`);
      }
    } else {
      this._log('debug', `[GOT_DATA] No debugDate in cfg, keeping _currentTodayYmd=${this._currentTodayYmd}`);
    }
  },

  _processPayloadData(title, payload) {
    const apiStatus = payload?.state?.api || {};
    const fetchFlags = payload?.state?.fetch || {};
    const warningsList = Array.isArray(payload?.state?.warnings) ? payload.state.warnings : [];

    // --- 1. Time Units ---
    let timeUnits = [];
    try {
      if (Array.isArray(payload?.data?.timeUnits)) {
        timeUnits = payload.data.timeUnits.map((u) => ({
          startTime: u.startTime ?? u.start,
          endTime: u.endTime ?? u.end,
          startMin: this._toMinutes(u.startTime ?? u.start),
          endMin: (u.endTime ?? u.end) ? this._toMinutes(u.endTime ?? u.end) : null,
          name: u.name ?? u.label,
        }));
      }
    } catch (e) {
      this._log('warn', 'failed to build timeUnits from grid', e);
    }

    if (
      !this._shouldPreserveData(
        timeUnits,
        this.timeUnitsByStudent[title] || [],
        fetchFlags.timegrid ?? fetchFlags.timetable ?? true,
        apiStatus.timetable,
        warningsList
      )
    ) {
      this.timeUnitsByStudent[title] = timeUnits;
    }

    const periodMap = {};
    (this.timeUnitsByStudent[title] || []).forEach((u) => {
      periodMap[u.startTime] = u.name;
    });
    this.periodNamesByStudent[title] = periodMap;

    // --- 2. Timetable ---
    const rawLessons = Array.isArray(payload?.data?.lessons) ? payload.data.lessons : [];
    if (
      !this._shouldPreserveData(
        rawLessons,
        this.timetableByStudent[title] || [],
        fetchFlags.timetable ?? true,
        apiStatus.timetable,
        warningsList
      )
    ) {
      this.timetableByStudent[title] = rawLessons;
    }
    this._log('debug', `[GOT_DATA] Timetable updated: ${rawLessons.length} total -> ${this.timetableByStudent[title]?.length || 0} valid`);

    const groupedRaw = {};
    (this.timetableByStudent[title] || []).forEach((el) => {
      const key = el && el.date != null ? String(el.date) : null;
      if (!key) return;
      if (!groupedRaw[key]) groupedRaw[key] = [];
      groupedRaw[key].push(el);
    });
    Object.keys(groupedRaw).forEach((k) => groupedRaw[k].sort((a, b) => (a.startTime || 0) - (b.startTime || 0)));
    this.preprocessedByStudent[title] = { ...(this.preprocessedByStudent[title] || {}), rawGroupedByDate: groupedRaw };

    // --- 3. Exams, Homeworks, Absences, Messages ---
    const dataMaps = [
      { key: 'exams', source: payload?.data?.exams, target: this.examsByStudent, flag: fetchFlags.exams, status: apiStatus.exams },
      {
        key: 'homework',
        source: payload?.data?.homework,
        target: this.homeworksByStudent,
        flag: fetchFlags.homework,
        status: apiStatus.homework,
      },
      {
        key: 'absences',
        source: payload?.data?.absences,
        target: this.absencesByStudent,
        flag: fetchFlags.absences,
        status: apiStatus.absences,
      },
      {
        key: 'messages',
        source: payload?.data?.messages,
        target: this.messagesOfDayByStudent,
        flag: fetchFlags.messages,
        status: apiStatus.messages,
      },
    ];

    dataMaps.forEach(({ source, target, flag, status }) => {
      const parsedArray = Array.isArray(source) ? source : [];
      if (!this._shouldPreserveData(parsedArray, target[title] || [], flag ?? true, status, warningsList)) {
        target[title] = parsedArray;
        if (target === this.absencesByStudent) {
          this.absencesUnavailableByStudent[title] = [403, 404, 410].includes(Number(status));
        }
      }
    });

    // --- 4. Holidays ---
    const holidays = Array.isArray(payload?.data?.holidays?.ranges) ? payload.data.holidays.ranges : [];
    this.holidaysByStudent[title] = holidays;
    this.holidayMapByStudent[title] = this._buildHolidayMapFromRanges(holidays);
  },

  _processGotDataWarnings(title, payload) {
    const warningsList = Array.isArray(payload?.state?.warnings) ? payload.state.warnings : [];
    const warningMeta = Array.isArray(payload?.state?.warningMeta) ? payload.state.warningMeta : [];

    const warningsAfterNormalization = this._normalizeRuntimeWarnings(warningsList, {
      effectiveData: {
        lessons: this.timetableByStudent[title] || [],
        exams: this.examsByStudent[title] || [],
        homework: this.homeworksByStudent[title] || [],
        absences: this.absencesByStudent[title] || [],
        messages: this.messagesOfDayByStudent[title] || [],
      },
      apiStatus: payload?.state?.api || {},
      fetchFlags: payload?.state?.fetch || {},
      warningMeta,
    });

    const metaByMessage = new Map();
    warningMeta.forEach((entry) => {
      if (entry?.message) metaByMessage.set(String(entry.message), entry);
    });

    const persistentWarnings = warningsAfterNormalization.filter((w) => metaByMessage.get(String(w))?.kind === 'config');
    const debouncedWarnings = warningsAfterNormalization.filter((w) => metaByMessage.get(String(w))?.kind !== 'config');

    const hasAnyDebouncedWarningNow = debouncedWarnings.length > 0;
    const prevRuntimeWarningStreak = Number(this._runtimeWarningStreakByStudent?.[title] || 0);
    const nextRuntimeWarningStreak = hasAnyDebouncedWarningNow ? prevRuntimeWarningStreak + 1 : 0;
    this._runtimeWarningStreakByStudent[title] = nextRuntimeWarningStreak;

    const visibleWarnings = nextRuntimeWarningStreak >= 2 ? [...persistentWarnings, ...debouncedWarnings] : [...persistentWarnings];
    if (hasAnyDebouncedWarningNow && nextRuntimeWarningStreak < 2) {
      this._log('debug', `[GOT_DATA] Warning debounce active for ${title}: delaying runtime warning display until next fetch`);
    }

    this._updateRuntimeWarnings(title, visibleWarnings);
    this._logRuntimeWarnings(visibleWarnings);
  },
});
