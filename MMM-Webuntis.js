Module.register('MMM-Webuntis', {
  // Simple frontend logger factory (lightweight, avoids bundler require() issues)
  _createFrontendLogger(moduleName = 'MMM-Webuntis') {
    // Use only console methods allowed by linting rules (warn, error)
    const METHODS = { error: 'error', warn: 'warn', info: 'warn', debug: 'warn' };
    return {
      log(level, msg) {
        try {
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
    fetchIntervalMs: 15 * 60 * 1000, // fetch interval in milliseconds (default: 15 minutes)
    logLevel: 'none', // One of: "error", "warn", "info", "debug". Default is "info".

    // === DISPLAY OPTIONS ===
    // Comma-separated list of widgets to render (top-to-bottom).
    // Supported widgets: grid, lessons, exams, homework, absences, messagesofday
    // Backwards compatible: 'list' => lessons, exams | 'grid' => grid
    displayMode: 'list',
    mode: 'verbose', // 'verbose' (per-student sections) or 'compact' (combined view)

    // === TIMETABLE FETCH RANGE ===
    daysToShow: 7, // number of upcoming days to fetch/display per student (0 = off)
    pastDaysToShow: 0, // number of past days to include (useful for debugging)

    // === WIDGET NAMESPACED DEFAULTS ===
    // Per-widget configuration namespaces
    lessons: {
      dateFormat: 'EEEE',
      showStartTime: false,
      showRegular: false,
      useShortSubject: false,
      showTeacherMode: 'full',
      showSubstitution: false,
    },

    exams: {
      dateFormat: 'dd.MM.',
      daysAhead: 45,
      showSubject: true,
      showTeacher: true,
    },

    homework: {
      dateFormat: 'dd.MM.',
      pastDays: 14,
      nextDays: 45,
    },

    absences: {
      dateFormat: 'dd.MM.',
      pastDays: 20,
      futureDays: 20,
    },

    // === STUDENTS ===
    students: [
      {
        title: 'M',
        studentId: 1774, // replace with actual student ID
      },
    ],
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

    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const configured = (this.config && this.config.logLevel) || this.defaults.logLevel || 'info';
    const configuredLevel = levels[configured] !== undefined ? configured : 'info';
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
      this._log('warn', 'MMMW Webuntis dom helper not available, table helpers will be skipped.');
    }
    return helper;
  },

  _createWidgetTable() {
    const helper = this._getDomHelper();
    if (helper && typeof helper.createTable === 'function') {
      return helper.createTable();
    }
    const table = document.createElement('table');
    table.className = 'bright small light';
    return table;
  },

  _shouldRenderStudentHeader(studentConfig) {
    const mode = studentConfig?.mode ?? this.config.mode;
    return mode === 'verbose' && Array.isArray(this.config.students) && this.config.students.length > 1;
  },

  _prepareStudentCellTitle(table, studentTitle, studentConfig) {
    if (this._shouldRenderStudentHeader(studentConfig)) {
      const helper = this._getDomHelper();
      if (helper && typeof helper.addTableHeader === 'function') {
        helper.addTableHeader(table, studentTitle);
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
    // Create a fragment that will contain one table per student (if they have rows).
    const frag = document.createDocumentFragment();

    for (const studentTitle of studentTitles) {
      const studentConfig = this.configByStudent?.[studentTitle] || this.config;
      const table = this._createWidgetTable();
      const studentCellTitle = this._prepareStudentCellTitle(table, studentTitle, studentConfig);
      try {
        const count = renderRow(studentTitle, studentCellTitle, studentConfig, table);
        if (count > 0) {
          frag.appendChild(table);
        }
      } catch (err) {
        this._log('error', `Error rendering widget for ${studentTitle}:`, err);
      }
    }

    return frag.hasChildNodes() ? frag : null;
  },

  _computeTodayYmdValue() {
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

    const rawStudents = Array.isArray(this.config.students) ? this.config.students : [];
    const mergedStudents = rawStudents.map((s) => ({ ...defNoStudents, ...(s || {}) }));

    const sendConfig = { ...this.config, students: mergedStudents, id: this.identifier };

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
    const validWidgets = ['grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'];
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

    if (Number.isFinite(config.exams?.daysAhead) && (config.exams.daysAhead < 0 || config.exams.daysAhead > 365)) {
      warnings.push(`exams.daysAhead should be between 0 and 365. Value: ${config.exams.daysAhead}`);
    }

    if (Number.isFinite(config.grid?.mergeGap) && config.grid.mergeGap < 0) {
      warnings.push(`grid.mergeGap cannot be negative. Value: ${config.grid.mergeGap}`);
    }

    // Check if no students configured
    if (!Array.isArray(config.students) || config.students.length === 0) {
      warnings.push(
        'No students configured. Module is idle. Configure students[] or provide parent account credentials for auto-discovery.'
      );
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

  _renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, holidays) {
    const api = this._getWidgetApi();
    const fn = api?.grid?.renderGridForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'grid widget script not loaded');
      return null;
    }
    return fn(this, studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, holidays);
  },

  _renderListForStudent(table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap, holidays) {
    return this._invokeWidgetRenderer(
      'lessons',
      'renderLessonsForStudent',
      table,
      studentCellTitle,
      studentTitle,
      studentConfig,
      timetable,
      startTimesMap,
      holidays
    );
  },

  _renderExamsForStudent(table, studentCellTitle, studentConfig, exams) {
    return this._invokeWidgetRenderer('exams', 'renderExamsForStudent', table, studentCellTitle, studentConfig, exams);
  },

  _renderHomeworksForStudent(table, studentCellTitle, studentConfig, homeworks) {
    return this._invokeWidgetRenderer('homework', 'renderHomeworksForStudent', table, studentCellTitle, studentConfig, homeworks);
  },

  _renderAbsencesForStudent(table, studentCellTitle, studentConfig, absences) {
    return this._invokeWidgetRenderer('absences', 'renderAbsencesForStudent', table, studentCellTitle, studentConfig, absences);
  },

  _renderMessagesOfDayForStudent(table, studentCellTitle, studentConfig, messagesOfDay) {
    return this._invokeWidgetRenderer(
      'messagesofday',
      'renderMessagesOfDayForStudent',
      table,
      studentCellTitle,
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
    this.preprocessedByStudent = {};
    this.moduleWarningsSet = new Set();
    this._domUpdateTimer = null;

    this._paused = false;
    this._startNowLineUpdater();

    // Initialize module-level today value. If `debugDate` is configured, use it
    // (accepts 'YYYY-MM-DD' or 'YYYYMMDD'), otherwise use the real current date.
    if (this.config && typeof this.config.debugDate === 'string' && this.config.debugDate) {
      const s = String(this.config.debugDate).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(s + 'T00:00:00');
        this._currentTodayYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      } else if (/^\d{8}$/.test(s)) {
        const by = parseInt(s.substring(0, 4), 10);
        const bm = parseInt(s.substring(4, 6), 10) - 1;
        const bd = parseInt(s.substring(6, 8), 10);
        const d = new Date(by, bm, bd);
        this._currentTodayYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
      }
    }
    if (!this._currentTodayYmd) {
      const now = new Date();
      this._currentTodayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    }

    // Send a sanitized copy to the backend where each student inherits module
    // defaults and legacy keys have been mapped. The backend (node_helper)
    // expects normalized student objects in a closed system.
    this.sendSocketNotification('FETCH_DATA', this._buildSendConfig());

    this._log('info', 'MMM-Webuntis started with config:', this.config);
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
      this.sendSocketNotification('FETCH_DATA', this._buildSendConfig());
    }, interval);
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
    this.sendSocketNotification('FETCH_DATA', this._buildSendConfig());
    this._startFetchTimer();
    this._startNowLineUpdater();
  },

  getDom() {
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
        warnDiv.className = 'mmm-webuntis-warning small bright';
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

          // Render grid if we have timeUnits AND (lessons OR holidays)
          // This ensures the grid is shown even during holidays when there are no lessons
          const hasLessons = timetable.length > 0;
          const hasHolidays = holidays.length > 0;
          if (timeUnits.length > 0 && (hasLessons || hasHolidays)) {
            const gridElem = this._renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, holidays);
            if (gridElem) wrapper.appendChild(gridElem);
          }
        }
        continue;
      }

      if (widget === 'lessons') {
        const lessonsTable = this._renderWidgetTableRows(sortedStudentTitles, (studentTitle, studentCellTitle, studentConfig, table) => {
          const timetable = this.timetableByStudent[studentTitle] || [];
          const startTimesMap = this.periodNamesByStudent?.[studentTitle] || {};
          const holidays = this.holidaysByStudent?.[studentTitle] || [];
          return this._renderListForStudent(table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap, holidays);
        });
        if (lessonsTable) wrapper.appendChild(lessonsTable);
        continue;
      }

      if (widget === 'exams') {
        const examsTable = this._renderWidgetTableRows(sortedStudentTitles, (studentTitle, studentCellTitle, studentConfig, table) => {
          const exams = this.examsByStudent?.[studentTitle] || [];
          if (!Array.isArray(exams) || Number(studentConfig?.examsDaysAhead) <= 0) return 0;
          return this._renderExamsForStudent(table, studentCellTitle, studentConfig, exams);
        });
        if (examsTable) wrapper.appendChild(examsTable);
        continue;
      }

      if (widget === 'homework') {
        const homeworkTable = this._renderWidgetTableRows(sortedStudentTitles, (studentTitle, studentCellTitle, studentConfig, table) => {
          const homeworks = this.homeworksByStudent?.[studentTitle] || [];
          return this._renderHomeworksForStudent(table, studentCellTitle, studentConfig, homeworks);
        });
        if (homeworkTable) wrapper.appendChild(homeworkTable);
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

        const absencesTable = this._renderWidgetTableRows(sortedStudentTitles, (studentTitle, studentCellTitle, studentConfig, table) => {
          const absences = this.absencesByStudent?.[studentTitle] || [];
          return this._renderAbsencesForStudent(table, studentCellTitle, studentConfig, absences);
        });
        if (absencesTable) wrapper.appendChild(absencesTable);
        continue;
      }

      if (widget === 'messagesofday') {
        const messagesTable = this._renderWidgetTableRows(sortedStudentTitles, (studentTitle, studentCellTitle, studentConfig, table) => {
          const messagesOfDay = this.messagesOfDayByStudent?.[studentTitle] || [];
          return this._renderMessagesOfDayForStudent(table, studentCellTitle, studentConfig, messagesOfDay);
        });
        if (messagesTable) wrapper.appendChild(messagesTable);
        continue;
      }
    }

    return wrapper;
  },

  notificationReceived(notification) {
    if (notification === 'DOM_OBJECTS_CREATED') {
      this._startFetchTimer();
    }
  },

  socketNotificationReceived(notification, payload) {
    if (!payload || this.identifier !== payload.id) {
      return;
    }

    if (notification !== 'GOT_DATA') return;

    const title = payload.title;
    const cfg = payload.config || {};
    this.configByStudent[title] = cfg;
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

    this.absencesByStudent[title] = Array.isArray(payload.absences) ? payload.absences : [];

    this.absencesUnavailableByStudent[title] = Boolean(payload.absencesUnavailable);

    this.messagesOfDayByStudent[title] = Array.isArray(payload.messagesOfDay) ? payload.messagesOfDay : [];

    this.holidaysByStudent[title] = Array.isArray(payload.holidays) ? payload.holidays : [];

    this._scheduleDomUpdate();
  },
});
