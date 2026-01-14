Module.register('MMM-Webuntis', {
  // Version marker to force browser cache refresh (increment when making changes)
  _cacheVersion: '2.0.1',

  // Simple frontend logger factory (lightweight, avoids bundler require() issues)
  _createFrontendLogger(moduleName = 'MMM-Webuntis') {
    // Use only console methods allowed by linting rules (warn, error)
    const METHODS = { error: 'error', warn: 'warn', info: 'warn', debug: 'warn' };
    const levels = { none: -1, error: 0, warn: 1, info: 2, debug: 3 };
    return {
      log(level, msg) {
        try {
          // Respect logLevel setting from global window variable
          const configured = window.MMMWebuntisLogLevel || 'info';
          const configuredLevel = levels[configured] !== undefined ? configured : 'info';
          const msgLevel = levels[level] !== undefined ? level : 'info';

          // Skip logging if message level exceeds configured level
          if (levels[msgLevel] > levels[configuredLevel]) {
            return;
          }

          const method = METHODS[level] || 'warn';
          // eslint-disable-next-line no-console
          console[method](`${moduleName}: ${msg}`);
        } catch {
          // ignore
        }
      },
    };
  },

  defaults: {
    // === GLOBAL OPTIONS ===
    header: 'MMM-Webuntis', // displayed as module title in MagicMirror
    updateInterval: 5 * 60 * 1000, // fetch interval in milliseconds (default: 5 minutes)

    // === DEBUG OPTIONS ===
    logLevel: 'none', // One of: "error", "warn", "info", "debug". Default is "info".
    debugDate: null, // set to 'YYYY-MM-DD' to freeze "today" for debugging (null = disabled)
    dumpBackendPayloads: false, // dump raw payloads from backend in ./debug_dumps/ folder
    timezone: 'Europe/Berlin', // timezone for date calculations (important for schools outside UTC)

    // === DISPLAY OPTIONS ===
    // Comma-separated list of widgets to render (top-to-bottom).
    // Supported widgets: grid, lessons, exams, homework, absences, messagesofday
    // Backwards compatible: 'list' => lessons, exams | 'grid' => grid
    displayMode: 'lessons, exams',
    mode: 'verbose', // 'verbose' (per-student sections) or 'compact' (combined view)

    // === AUTHENTICATION ===
    // username: 'your username', // WebUntis username (leave empty if using studentId/qrcode)
    // password: 'your password', // WebUntis password (leave empty if using studentId/qrcode)
    // school: 'your school',     // WebUntis school name (most likley subdomain)
    // server: 'schoolserver.webuntis.com',  // WebUntis server URL (usually subdomain.webuntis.com)

    // === STUDENTS ===
    //students: [
    //  {
    //    title: 'kids name', // Display name for the student
    //    studentId: 1234, // replace with student ID for individual title
    //    qrcode: null, // optional: untis:// URL from WebUntis QR code
    //  },
    //],

    // === WIDGET NAMESPACED DEFAULTS ===
    // Per-widget configuration namespaces
    lessons: {
      nextDays: 2, // widget-specific days ahead
      dateFormat: 'EEE', // format for lesson dates
      showStartTime: false, // show lesson start time instead of timeunit
      showRegular: false, // show also regular lessons
      useShortSubject: false, // use short subject names
      showTeacherMode: 'full', // 'off'|'initial'|'full'
      showSubstitution: false, // show substitution info
    },

    grid: {
      nextDays: 4, // widget-specific days ahead (shows school week Mon-Fri if today is Monday)
      pastDays: 0, // widget-specific days past
      dateFormat: 'EEE dd.MM.', // format for grid dates
      showNowLine: true, // show current time line
      mergeGap: 15, // minutes gap to merge adjacent lessons
      maxLessons: 0, // max lessons per day (0 = no limit)
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

  getStyles() {
    return [this.file('MMM-Webuntis.css')];
  },

  getScripts() {
    // Store logLevel globally so widgets can access it during initialization
    window.MMMWebuntisLogLevel = (this.config && this.config.logLevel) || this.defaults.logLevel || 'info';

    const scripts = [this.file('widgets/util.js')];
    const widgetScriptMap = {
      lessons: 'widgets/lessons.js',
      exams: 'widgets/exams.js',
      homework: 'widgets/homework.js',
      absences: 'widgets/absences.js',
      grid: 'widgets/grid.js',
      messagesofday: 'widgets/messagesofday.js',
    };

    const widgets = Array.from(new Set(this._getDisplayWidgets()));
    for (const widget of widgets) {
      const scriptPath = widgetScriptMap[widget];
      if (!scriptPath) continue;
      scripts.push(this.file(scriptPath));
    }

    return scripts;
  },

  getTranslations() {
    return {
      en: 'translations/en.json',
      de: 'translations/de.json',
    };
  },

  _getWidgetApi() {
    try {
      return window.MMMWebuntisWidgets || null;
    } catch {
      return null;
    }
  },

  _hasWidget(name) {
    return this._getDisplayWidgets().includes(String(name).toLowerCase());
  },

  _getDisplayWidgets() {
    const raw = this?.config?.displayMode;
    const s = raw === undefined || raw === null ? '' : String(raw);
    const lower = s.toLowerCase().trim();

    if (lower === 'grid') return ['grid'];
    if (lower === 'list') return ['lessons', 'exams'];

    const parts = lower
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

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

    const out = [];
    for (const p of parts) {
      const w = map[p];
      if (!w) continue;
      if (w === 'list') {
        if (!out.includes('lessons')) out.push('lessons');
        if (!out.includes('exams')) out.push('exams');
        continue;
      }
      if (!out.includes(w)) out.push(w);
    }

    return out.length > 0 ? out : ['lessons', 'exams'];
  },

  // Simple log helper to control verbosity from the module config
  _log(level, ...args) {
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

  _getDomHelper() {
    const helper = this._getWidgetApi()?.dom || null;
    if (!helper) {
      this._log('warn', 'MMM-Webuntis dom helper not available, widget container helpers will be skipped.');
    }
    return helper;
  },

  _createWidgetContainer() {
    const helper = this._getDomHelper();
    if (helper && typeof helper.createContainer === 'function') {
      return helper.createContainer();
    }
    const container = document.createElement('div');
    container.className = 'wu-widget-container bright small light';
    return container;
  },

  _shouldRenderStudentHeader(studentConfig) {
    const mode = studentConfig?.mode ?? this.config.mode;
    return mode === 'verbose' && Array.isArray(this.config.students) && this.config.students.length > 1;
  },

  _prepareStudentLabel(container, studentTitle, studentConfig) {
    if (this._shouldRenderStudentHeader(studentConfig)) {
      const helper = this._getDomHelper();
      if (helper && typeof helper.addHeader === 'function') {
        helper.addHeader(container, studentTitle);
      }
      return '';
    }
    return studentTitle;
  },

  _getSortedStudentTitles() {
    if (!this.timetableByStudent || typeof this.timetableByStudent !== 'object') return [];
    return Object.keys(this.timetableByStudent).sort();
  },

  _invokeWidgetRenderer(widgetKey, methodName, ...args) {
    const api = this._getWidgetApi();
    const fn = api?.[widgetKey]?.[methodName];
    if (typeof fn !== 'function') {
      this._log('warn', `${widgetKey} widget script not loaded`);
      return 0;
    }
    return fn(this, ...args);
  },

  _renderWidgetTableRows(studentTitles, renderRow) {
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

  _computeTodayYmdValue() {
    // If debugDate is set, always use it instead of current date
    if (this._currentTodayYmd) return this._currentTodayYmd;
    const now = new Date();
    return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  },

  _shiftYmd(baseYmd, deltaDays = 0) {
    const num = Number(baseYmd);
    if (!Number.isFinite(num)) return null;
    const year = Math.floor(num / 10000);
    const month = Math.floor((num % 10000) / 100) - 1;
    const day = num % 100;
    const date = new Date(year, month, day);
    date.setDate(date.getDate() + deltaDays);
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  },

  _filterTimetableRange(entries, studentConfig) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const cfg = studentConfig || {};
    const fallback = this.config || {};
    const defaults = this.defaults || {};

    // Prefer new keys `nextDays` / `pastDays`, fall back to legacy `daysToShow` / `pastDaysToShow`.
    const daysVal =
      cfg.nextDays ?? cfg.daysToShow ?? fallback.nextDays ?? fallback.daysToShow ?? defaults.nextDays ?? defaults.daysToShow ?? 0;
    const pastVal =
      cfg.pastDays ??
      cfg.pastDaysToShow ??
      fallback.pastDays ??
      fallback.pastDaysToShow ??
      defaults.pastDays ??
      defaults.pastDaysToShow ??
      0;
    const daysToShow = Number(daysVal);
    const pastDaysToShow = Number(pastVal);
    const limitFuture = Number.isFinite(daysToShow) && daysToShow > 0;
    const limitPast = Number.isFinite(pastDaysToShow);

    if (!limitFuture && !limitPast) {
      return entries.slice();
    }

    const todayYmd = this._currentTodayYmd || this._computeTodayYmdValue();
    if (!this._currentTodayYmd) this._currentTodayYmd = todayYmd;

    const minYmd = limitPast ? this._shiftYmd(todayYmd, -pastDaysToShow) : null;
    const maxYmd = limitFuture ? this._shiftYmd(todayYmd, daysToShow - 1) : null;

    return entries.filter((lesson) => {
      const ymd = Number(lesson?.date);
      if (!Number.isFinite(ymd)) return false;
      if (minYmd !== null && ymd < minYmd) return false;
      if (maxYmd !== null && ymd > maxYmd) return false;
      return true;
    });
  },

  _buildSendConfig() {
    const defNoStudents = { ...(this.config || {}) };
    delete defNoStudents.students;

    // Deep merge widget defaults from this.defaults into defNoStudents
    // MagicMirror only does shallow merge, so nested widget configs need manual merging
    const widgetKeys = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
    widgetKeys.forEach((widget) => {
      if (this.defaults[widget]) {
        // Start with module defaults
        defNoStudents[widget] = { ...this.defaults[widget], ...(defNoStudents[widget] || {}) };
      }
    });

    this._log('debug', `[_buildSendConfig] defNoStudents.grid.nextDays = ${defNoStudents.grid?.nextDays}`);

    // Always include the persisted debugDate if it was configured, to ensure it persists
    // across multiple FETCH_DATA requests. This allows time-based testing to work correctly.
    if (this._persistedDebugDate) {
      defNoStudents.debugDate = this._persistedDebugDate;
      this._log('debug', `[_buildSendConfig] Persisting debugDate="${this._persistedDebugDate}"`);
    }

    const rawStudents = Array.isArray(this.config.students) ? this.config.students : [];

    // Use merged students from GOT_DATA if available (preserves widget defaults across FETCH_DATA calls)
    const studentsToMerge =
      this._mergedStudents && this._mergedStudents.size > 0
        ? rawStudents.map((s) => {
            const title = s?.title;
            if (title && this._mergedStudents.has(title)) {
              // Use the previously merged config from GOT_DATA
              return this._mergedStudents.get(title);
            }
            return s;
          })
        : rawStudents;

    const mergedStudents = studentsToMerge.map((s) => {
      const merged = { ...defNoStudents, ...(s || {}) };
      // Deep merge student-level widget configs
      widgetKeys.forEach((widget) => {
        if (s && s[widget]) {
          merged[widget] = { ...defNoStudents[widget], ...s[widget] };
        } else if (!merged[widget]) {
          // Ensure widget defaults are present even if student doesn't have them
          merged[widget] = { ...defNoStudents[widget] };
        }
      });
      return merged;
    });

    this._log('debug', `[_buildSendConfig] mergedStudents[0].grid.nextDays = ${mergedStudents[0]?.grid?.nextDays}`);

    const sendConfig = {
      ...this.config,
      students: mergedStudents,
      id: this.identifier,
      sessionId: this._sessionId, // Include session ID for config isolation
    };

    // Ensure debugDate persists in the send config
    if (this._persistedDebugDate) {
      sendConfig.debugDate = this._persistedDebugDate;
    }

    // Note: legacy config normalization is performed server-side in node_helper.js.
    // Keep client-side bundle minimal and rely on backend normalization for compatibility.

    // ===== VALIDATE MODULE CONFIG =====
    this._validateAndWarnConfig(sendConfig);

    return sendConfig;
  },

  /**
   * Validate module configuration and collect warnings before sending to backend
   */
  _validateAndWarnConfig(config) {
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
    // Validate new and legacy range keys
    if (Number.isFinite(config.nextDays) && config.nextDays < 0) {
      warnings.push(`nextDays cannot be negative. Value: ${config.nextDays}`);
    }
    if (Number.isFinite(config.pastDays) && config.pastDays < 0) {
      warnings.push(`pastDays cannot be negative. Value: ${config.pastDays}`);
    }
    if (Number.isFinite(config.daysToShow) && config.daysToShow < 0) {
      warnings.push(`daysToShow cannot be negative (deprecated key). Value: ${config.daysToShow}`);
    }

    if (Number.isFinite(config.grid?.mergeGap) && config.grid.mergeGap < 0) {
      warnings.push(`grid.mergeGap cannot be negative. Value: ${config.grid.mergeGap}`);
    }

    // Check if no students configured AND no parent credentials for auto-discovery
    const hasParentCreds = config.username && config.password && config.school;
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

  _toMinutes(t) {
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

  _renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences) {
    const api = this._getWidgetApi();
    const fn = api?.grid?.renderGridForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'grid widget script not loaded');
      return null;
    }
    return fn(this, studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences);
  },

  _renderListForStudent(container, studentLabel, studentTitle, studentConfig, timetable, startTimesMap, holidays) {
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

  _renderExamsForStudent(container, studentLabel, studentConfig, exams) {
    return this._invokeWidgetRenderer('exams', 'renderExamsForStudent', container, studentLabel, studentConfig, exams);
  },

  _renderHomeworksForStudent(container, studentLabel, studentConfig, homeworks) {
    return this._invokeWidgetRenderer('homework', 'renderHomeworksForStudent', container, studentLabel, studentConfig, homeworks);
  },

  _renderAbsencesForStudent(container, studentLabel, studentConfig, absences) {
    return this._invokeWidgetRenderer('absences', 'renderAbsencesForStudent', container, studentLabel, studentConfig, absences);
  },

  _renderMessagesOfDayForStudent(container, studentLabel, studentConfig, messagesOfDay) {
    return this._invokeWidgetRenderer(
      'messagesofday',
      'renderMessagesOfDayForStudent',
      container,
      studentLabel,
      studentConfig,
      messagesOfDay
    );
  },

  start() {
    // Normalization moved to backend (node_helper); keep frontend config untouched

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

    // Multi-instance support via explicit identifiers.
    // For multiple MMM-Webuntis instances, you MUST add unique 'identifier' fields in config.js:
    // { module: 'MMM-Webuntis', identifier: 'student_alice', position: '...', config: { ... } }
    // Without explicit identifiers, MagicMirror will auto-assign them (MMM-Webuntis_0, MMM-Webuntis_1, etc)
    if (this.identifier) {
      this._log('debug', `[start] Using explicit identifier from config: ${this.identifier}`);
    } else {
      this._log('warn', '[start] No explicit identifier set. For multiple instances, add "identifier" to module config in config.js');
    }

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
    this._domUpdateTimer = null;
    this._lastFetchTime = 0; // Debounce rapid FETCH_DATA requests
    this._initialized = false; // Track initialization status

    this._paused = false;
    this._startNowLineUpdater();
    // Generate or retrieve unique session ID for this browser window instance
    // Use localStorage to persist the sessionId across page reloads
    const storageKey = `MMM-Webuntis_sessionId_${this.identifier}`;
    if (typeof localStorage !== 'undefined' && localStorage.getItem(storageKey)) {
      this._sessionId = localStorage.getItem(storageKey);
      this._log('debug', `[start] Retrieved persisted session ID from localStorage: ${this._sessionId}`);
    } else {
      this._sessionId = Math.random().toString(36).substring(2, 11);
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, this._sessionId);
      }
      this._log('debug', `[start] Generated new session ID: ${this._sessionId}`);
    }

    // Initialize module-level today value. If `debugDate` is configured, use it
    // (accepts 'YYYY-MM-DD' or 'YYYYMMDD'), otherwise use the real current date.
    // Store debugDate separately so it persists across fetch cycles.
    this._persistedDebugDate = null;
    if (this.config && typeof this.config.debugDate === 'string' && this.config.debugDate) {
      const s = String(this.config.debugDate).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(s + 'T00:00:00');
        this._currentTodayYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        this._persistedDebugDate = s;
        this._log('debug', `[start] Set _persistedDebugDate="${s}"`);
      } else if (/^\d{8}$/.test(s)) {
        const by = parseInt(s.substring(0, 4), 10);
        const bm = parseInt(s.substring(4, 6), 10) - 1;
        const bd = parseInt(s.substring(6, 8), 10);
        const d = new Date(by, bm, bd);
        this._currentTodayYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
        this._persistedDebugDate = `${String(by).padStart(4, '0')}-${String(bm + 1).padStart(2, '0')}-${String(bd).padStart(2, '0')}`;
        this._log('debug', `[start] Set _persistedDebugDate="${this._persistedDebugDate}"`);
      }
    }
    if (!this._currentTodayYmd) {
      const now = new Date();
      this._currentTodayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    }

    // Initialize module with backend (separate from data fetching)
    this._sendInit();

    this._log('info', 'MMM-Webuntis initializing with config:', this.config);
  },

  _startNowLineUpdater() {
    // Only start the now line updater if showNowLine is enabled (applies to grid view)
    if (this.config.showNowLine === false) return;
    const fn = this._getWidgetApi()?.grid?.startNowLineUpdater;
    if (typeof fn === 'function') fn(this);
  },

  _stopNowLineUpdater() {
    const fn = this._getWidgetApi()?.grid?.stopNowLineUpdater;
    if (typeof fn === 'function') fn(this);
  },

  _startFetchTimer() {
    if (this._paused) return;
    if (this._fetchTimer) return;
    // Prefer the new `updateInterval` config key, fall back to legacy `fetchIntervalMs`.
    const interval =
      typeof this.config?.updateInterval === 'number'
        ? Number(this.config.updateInterval)
        : typeof this.config?.fetchIntervalMs === 'number'
          ? Number(this.config.fetchIntervalMs)
          : null;
    if (!interval || !Number.isFinite(interval) || interval <= 0) return;

    this._fetchTimer = setInterval(() => {
      this._sendFetchData('periodic');
    }, interval);
  },

  _sendInit() {
    this._log('debug', '[INIT] Sending INIT_MODULE to backend');
    this.sendSocketNotification('INIT_MODULE', this._buildSendConfig());
  },

  _sendFetchData(reason = 'manual') {
    // Prevent fetch before initialization is complete
    if (!this._initialized) {
      this._log('debug', `[FETCH_DATA] Skipped ${reason} fetch - module not yet initialized`);
      return;
    }

    const now = Date.now();
    const timeSinceLastFetch = now - this._lastFetchTime;
    const minInterval = 5000; // Minimum 5 seconds between FETCH_DATA requests

    // Debounce: skip if too soon after last fetch
    if (timeSinceLastFetch < minInterval) {
      this._log('debug', `[FETCH_DATA] Skipped ${reason} fetch (${timeSinceLastFetch}ms since last)`);
      return;
    }

    this._lastFetchTime = now;
    this.sendSocketNotification('FETCH_DATA', this._buildSendConfig());
  },

  _stopFetchTimer() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
    }
  },

  _scheduleDomUpdate(delayMs = 500) {
    if (this._domUpdateTimer) {
      clearTimeout(this._domUpdateTimer);
    }
    this._domUpdateTimer = setTimeout(() => {
      this._domUpdateTimer = null;
      this.updateDom();
    }, delayMs);
  },

  suspend() {
    this._paused = true;
    this._stopNowLineUpdater();
    this._stopFetchTimer();
    if (this._domUpdateTimer) {
      clearTimeout(this._domUpdateTimer);
      this._domUpdateTimer = null;
    }
  },

  resume() {
    this._paused = false;
    this._sendFetchData('resume');
    this._startFetchTimer();
    this._startNowLineUpdater();
  },

  getDom() {
    this._log('debug', `[getDom] Called - generating DOM`);
    const wrapper = document.createElement('div');
    const widgets = this._getDisplayWidgets();

    const sortedStudentTitles = this._getSortedStudentTitles();
    this._log(
      'debug',
      `getDom: sortedStudentTitles=${JSON.stringify(sortedStudentTitles)}, timetableByStudent keys=${Object.keys(this.timetableByStudent || {})}`
    );

    // Render any module-level warnings once, above all widgets
    if (this.moduleWarningsSet && this.moduleWarningsSet.size > 0) {
      const warnContainer = document.createDocumentFragment();
      for (const w of Array.from(this.moduleWarningsSet)) {
        const warnDiv = document.createElement('div');
        // Add critical class for dependency-related warnings
        const isCritical = w.includes('Dependency issues') || w.includes('npm install') || w.includes('node_modules');
        warnDiv.className = isCritical ? 'mmm-webuntis-warning critical small bright' : 'mmm-webuntis-warning small bright';
        try {
          warnDiv.textContent = `⚠️ ${w}`;
        } catch {
          warnDiv.textContent = '⚠️ Configuration warning';
        }
        warnContainer.appendChild(warnDiv);
      }
      wrapper.appendChild(warnContainer);
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

          this._log('debug', `[grid-prep] homeworks for ${studentTitle}: ${homeworks.length} items`);
          if (homeworks.length > 0) {
            this._log('debug', `  First hw: dueDate=${homeworks[0].dueDate}, su=${JSON.stringify(homeworks[0].su)}`);
          }

          // Render grid if we have timeUnits OR holidays
          // This ensures the grid is shown even during holidays when there are no lessons/timeUnits
          const hasHolidays = holidays.length > 0;
          this._log('debug', `[grid-check] timeUnits=${timeUnits.length}, hasHolidays=${hasHolidays}, holidays.length=${holidays.length}`);
          if (timeUnits.length > 0 || hasHolidays) {
            this._log('debug', `[grid-render] Rendering grid for ${studentTitle}`);
            try {
              const absences = this.absencesByStudent?.[studentTitle] || [];
              this._log('debug', `[grid-render] absences for ${studentTitle}: ${absences.length}`);
              const gridElem = this._renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences);
              if (gridElem) {
                this._log('debug', `[grid-append] Grid element created, appending to wrapper`);
                wrapper.appendChild(gridElem);
              } else {
                this._log('debug', `[grid-skip] Grid element was null/undefined`);
              }
            } catch (error) {
              this._log('error', `Failed to render grid widget for ${studentTitle}: ${error.message}`);
              const errorDiv = document.createElement('div');
              errorDiv.className = 'widget-error dimmed';
              errorDiv.innerHTML = `⚠️ ${this.translate('widget_render_error', { widget: 'Grid' })}`;
              wrapper.appendChild(errorDiv);
            }
          } else {
            this._log('debug', `[grid-skip] Condition not met (timeUnits=${timeUnits.length}, hasHolidays=${hasHolidays})`);
          }
        }
        continue;
      }

      if (widget === 'lessons') {
        this._log('debug', '[lessons-check] Rendering lessons widget');
        try {
          const lessonsContainer = this._renderWidgetTableRows(
            sortedStudentTitles,
            (studentTitle, studentLabel, studentConfig, container) => {
              const timetable = this.timetableByStudent[studentTitle] || [];
              const startTimesMap = this.periodNamesByStudent?.[studentTitle] || {};
              const holidays = this.holidaysByStudent?.[studentTitle] || [];
              this._log(
                'debug',
                `[lessons-check] ${studentTitle}: timetable=${timetable.length}, holidays=${holidays.length}, holidayMap=${Object.keys(this.holidayMapByStudent?.[studentTitle] || {}).length}`
              );
              return this._renderListForStudent(container, studentLabel, studentTitle, studentConfig, timetable, startTimesMap, holidays);
            }
          );
          if (lessonsContainer) {
            this._log('debug', '[lessons-check] Appending lessons container to wrapper');
            wrapper.appendChild(lessonsContainer);
          } else {
            this._log('debug', '[lessons-check] No lessons container returned');
          }
        } catch (error) {
          this._log('error', `Failed to render lessons widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          errorDiv.innerHTML = `⚠️ ${this.translate('widget_render_error', { widget: 'Lessons' })}`;
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
              if (!Array.isArray(exams) || Number(studentConfig?.examsDaysAhead) <= 0) return 0;
              return this._renderExamsForStudent(container, studentLabel, studentConfig, exams);
            }
          );
          if (examsContainer) wrapper.appendChild(examsContainer);
        } catch (error) {
          this._log('error', `Failed to render exams widget: ${error.message}`);
          const errorDiv = document.createElement('div');
          errorDiv.className = 'widget-error dimmed';
          errorDiv.innerHTML = `⚠️ ${this.translate('widget_render_error', { widget: 'Exams' })}`;
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
          errorDiv.innerHTML = `⚠️ ${this.translate('widget_render_error', { widget: 'Homework' })}`;
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
          infoDiv.innerHTML = `⚠️ ${this.translate('absences_unavailable_parent_account')}`;
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
          errorDiv.innerHTML = `⚠️ ${this.translate('widget_render_error', { widget: 'Absences' })}`;
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
          errorDiv.innerHTML = `⚠️ ${this.translate('widget_render_error', { widget: 'Messages of Day' })}`;
          wrapper.appendChild(errorDiv);
        }
        continue;
      }
    }

    return wrapper;
  },

  notificationReceived(notification) {
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

  socketNotificationReceived(notification, payload) {
    // Filter by id to ensure data goes to the correct module instance
    // All instances receive the broadcast, but only the matching one processes it
    if (payload && payload.id && this.identifier !== payload.id) {
      this._log('debug', `[socketNotificationReceived] Ignoring data for different id (ours: ${this.identifier}, received: ${payload.id})`);
      return;
    }

    // Handle initialization response
    if (notification === 'MODULE_INITIALIZED') {
      this._log('info', 'Module initialized successfully');
      this._initialized = true;

      // CRITICAL: Store normalized config from backend to preserve widget defaults
      // This ensures all subsequent FETCH_DATA calls use the correct defaults
      if (payload.config) {
        this.config = payload.config;
        this._log('debug', 'Stored normalized config from backend');
      }

      // Process initialization warnings if present
      if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
        this.moduleWarningsSet = this.moduleWarningsSet || new Set();
        payload.warnings.forEach((w) => {
          if (!this.moduleWarningsSet.has(w)) {
            this.moduleWarningsSet.add(w);
            this._log('warn', `Init warning: ${w}`);
          }
        });
      }

      // Start periodic fetching after successful initialization
      this._sendFetchData('post-init');
      this._startFetchTimer();
      return;
    }

    // Handle initialization errors
    if (notification === 'INIT_ERROR') {
      this._log('error', 'Module initialization failed:', payload.message || 'Unknown error');
      if (Array.isArray(payload.errors)) {
        payload.errors.forEach((err) => this._log('error', `  - ${err}`));
      }
      if (Array.isArray(payload.warnings)) {
        payload.warnings.forEach((warn) => this._log('warn', `  - ${warn}`));
      }
      this._initialized = false;
      this.updateDom();
      return;
    }

    if (notification === 'CONFIG_WARNING' || notification === 'CONFIG_ERROR') {
      const warnList = Array.isArray(payload?.warnings) ? payload.warnings : [];
      this.moduleWarningsSet = this.moduleWarningsSet || new Set();
      warnList.forEach((w) => {
        if (!this.moduleWarningsSet.has(w)) {
          this.moduleWarningsSet.add(w);
          this._log('warn', `Config warning: ${w}`);

          // Show critical dependency warnings as browser notification
          if (w.includes('Dependency issues') || w.includes('npm install')) {
            this._log('error', `CRITICAL: ${w}`);
          }
        }
      });
      this.updateDom();
      return;
    }

    if (notification !== 'GOT_DATA') return;

    const title = payload.title;
    const cfg = payload.config || {};

    // Deep merge widget defaults into the received config
    // Backend sends student config which may be missing defaults
    const widgetKeys = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];
    widgetKeys.forEach((widget) => {
      if (this.defaults[widget]) {
        cfg[widget] = { ...this.defaults[widget], ...(cfg[widget] || {}) };
      }
    });

    this.configByStudent[title] = cfg;

    // Store the merged student config back into this.config.students
    // This ensures _buildSendConfig() uses the correct config on next FETCH_DATA
    if (!this._mergedStudents) {
      this._mergedStudents = new Map();
    }
    this._mergedStudents.set(title, cfg);

    // Update persisted debugDate if it's included in the response, to handle any backend changes
    if (cfg && typeof cfg.debugDate === 'string' && cfg.debugDate) {
      this._persistedDebugDate = cfg.debugDate;
      this._log('debug', `[GOT_DATA] Updated _persistedDebugDate="${cfg.debugDate}"`);
    }

    // Collect module-level warnings (deduped) and log newly seen ones to console
    if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
      this.moduleWarningsSet = this.moduleWarningsSet || new Set();
      payload.warnings.forEach((w) => {
        if (!this.moduleWarningsSet.has(w)) {
          this.moduleWarningsSet.add(w);
          this._log('warn', `Module warning: ${w}`);
        }
      });
    }

    const timeUnitsList = payload.timeUnits || [];
    let timeUnits = [];
    try {
      if (Array.isArray(timeUnitsList)) {
        timeUnits = timeUnitsList.map((u) => ({
          startTime: u.startTime,
          endTime: u.endTime,
          startMin: this._toMinutes(u.startTime),
          endMin: u.endTime ? this._toMinutes(u.endTime) : null,
          name: u.name,
        }));
      }
    } catch (e) {
      this._log('warn', 'failed to build timeUnits from grid', e);
    }
    this.timeUnitsByStudent[title] = timeUnits;

    const periodMap = {};
    timeUnits.forEach((u) => {
      periodMap[u.startTime] = u.name;
    });
    this.periodNamesByStudent[title] = periodMap;

    const timetableRange = Array.isArray(payload.timetableRange) ? payload.timetableRange : [];
    this.timetableByStudent[title] = this._filterTimetableRange(timetableRange, cfg);

    const groupedRaw = {};
    (this.timetableByStudent[title] || []).forEach((el) => {
      const key = el && el.date != null ? String(el.date) : null;
      if (!key) return;
      if (!groupedRaw[key]) groupedRaw[key] = [];
      groupedRaw[key].push(el);
    });
    Object.keys(groupedRaw).forEach((k) => {
      groupedRaw[k].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    });
    this.preprocessedByStudent[title] = {
      ...(this.preprocessedByStudent[title] || {}),
      rawGroupedByDate: groupedRaw,
    };

    this.examsByStudent[title] = Array.isArray(payload.exams) ? payload.exams : [];

    const hw = payload.homeworks;
    const hwNorm = Array.isArray(hw) ? hw : Array.isArray(hw?.homeworks) ? hw.homeworks : Array.isArray(hw?.homework) ? hw.homework : [];
    this.homeworksByStudent[title] = hwNorm;
    this._log('debug', `[GOT_DATA] Assigned ${hwNorm.length} homeworks to student "${title}"`);

    this.absencesByStudent[title] = Array.isArray(payload.absences) ? payload.absences : [];

    this.absencesUnavailableByStudent[title] = Boolean(payload.absencesUnavailable);

    this.messagesOfDayByStudent[title] = Array.isArray(payload.messagesOfDay) ? payload.messagesOfDay : [];

    this.holidaysByStudent[title] = Array.isArray(payload.holidays) ? payload.holidays : [];
    this.holidayMapByStudent[title] = payload.holidayByDate || {};

    this._log(
      'debug',
      `[GOT_DATA] holidays: ${this.holidaysByStudent[title].length}, holidayMap keys: ${Object.keys(this.holidayMapByStudent[title] || {}).length}`
    );
    this._log('debug', `[GOT_DATA] Calling _scheduleDomUpdate()`);
    this._scheduleDomUpdate();
    this._log('debug', `[GOT_DATA] _scheduleDomUpdate() called`);
  },
});
