Module.register('MMM-Webuntis', {
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

    // === LESSONS WIDGET OPTIONS ===
    showStartTime: false, // show start time instead of lesson number
    showRegularLessons: false, // show regular lessons (not only substitutions/cancellations)
    useShortSubject: false, // use short subject names where available
    showTeacherMode: 'full', // teacher display: 'full', 'initial', or null/falsy for none
    showSubstitutionText: false, // show substitution text/notes for changed lessons

    // === EXAMS WIDGET OPTIONS ===
    examsDaysAhead: 21, // number of days ahead to fetch exams (0 = off)
    showExamSubject: true, // show subject for exams
    showExamTeacher: true, // show teacher name for exams

    // === GRID VIEW OPTIONS ===
    mergeGapMinutes: 15, // max gap (minutes) between lessons to merge them
    maxGridLessons: 0, // max lessons per day in grid (0 = show all)
    showNowLine: true, // show the current time line in grid view

    // === ABSENCES WIDGET OPTIONS ===
    absencesPastDays: 21, // past days to include when fetching absences
    absencesFutureDays: 7, // future days to include when fetching absences

    // === DATE FORMAT OPTIONS ===
    // Structured date formats (per-widget).
    dateFormats: {
      default: 'dd.MM.',
      lessons: 'EEE', // prefix weekday for lessons
      grid: 'EEE dd.MM.',
      exams: 'dd.MM.',
      homework: 'dd.MM.',
      absences: 'dd.MM.',
    },

    // === TIMETABLE SOURCE OPTIONS ===
    useClassTimetable: false, // use class timetable instead of student timetable

    // === PARENT ACCOUNT SUPPORT (optional) ===
    // Uncomment and configure if using parent account to display multiple children
    // parentUsername: '', // parent account email/username
    // parentPassword: '', // parent account password
    // school: '', // school name (can be overridden per student)
    // server: '', // WebUntis server (default: webuntis.com)

    // === DEBUG / DEVELOPMENT OPTIONS ===
    dumpBackendPayloads: false, // dump backend API responses to debug_dumps/ folder

    // === STUDENT CREDENTIALS ===
    // Array of student objects
    // Optional: any global option can be set per-student to override it
    // (fancy but mostly useless)
    students: [
      {
        title: 'SET CONFIG!', // displayed name for the student
        // - studentId (number): student ID when using parent account [parent account mode]
        qrcode: '', // WebUntis QR code (untis://setschool?...) [direct student login]
        // alternative (if no qrcode):
        username: '',
        password: '',
        school: '',
        server: '', // defaults to 'webuntis.at'
        class: '', // class name (only needed for class timetable mode)
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
      const count = renderRow(studentTitle, studentCellTitle, studentConfig, table);
      if (count > 0) {
        frag.appendChild(table);
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

    const daysVal = cfg.daysToShow ?? fallback.daysToShow ?? defaults.daysToShow ?? 0;
    const pastVal = cfg.pastDaysToShow ?? fallback.pastDaysToShow ?? defaults.pastDaysToShow ?? 0;
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

  _normalizeLegacyConfig(cfg, defaultsRef) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const out = { ...cfg };
    const def = defaultsRef && typeof defaultsRef === 'object' ? defaultsRef : this?.defaults || {};

    const legacyUsed = [];
    const mapLegacy = (obj, legacyKey, newKey, transform, context = 'config') => {
      if (!obj || typeof obj !== 'object') return;
      const hasLegacy = obj[legacyKey] !== undefined && obj[legacyKey] !== null && obj[legacyKey] !== '';
      if (!hasLegacy) return;
      legacyUsed.push(`${context}.${legacyKey}`);
      const legacyVal = typeof transform === 'function' ? transform(obj[legacyKey]) : obj[legacyKey];
      obj[newKey] = legacyVal;
    };

    mapLegacy(out, 'fetchInterval', 'fetchIntervalMs', (v) => Number(v), 'config');
    mapLegacy(out, 'days', 'daysToShow', (v) => Number(v), 'config');
    mapLegacy(out, 'examsDays', 'examsDaysAhead', (v) => Number(v), 'config');
    mapLegacy(out, 'mergeGapMin', 'mergeGapMinutes', (v) => Number(v), 'config');

    const dbg = out.debug ?? out.enableDebug;
    if (typeof dbg === 'boolean') {
      legacyUsed.push('config.debug|enableDebug');
      out.logLevel = dbg ? 'debug' : 'none';
    }

    if (out.displaymode !== undefined && out.displaymode !== null && out.displaymode !== '') {
      legacyUsed.push('config.displaymode');
      out.displayMode = String(out.displaymode).toLowerCase();
    }
    if (typeof out.displayMode === 'string') out.displayMode = out.displayMode.toLowerCase();

    if (Array.isArray(out.students)) {
      for (let i = 0; i < out.students.length; i++) {
        const s = out.students[i];
        if (!s || typeof s !== 'object') continue;
        // IMPORTANT: do not merge `students` into each student config.
        // Doing so creates circular references (student -> students[] -> student)
        // which breaks Socket.IO payload serialization (hasBinary recursion).
        const defNoStudents = { ...def };
        delete defNoStudents.students;
        const outNoStudents = { ...out };
        delete outNoStudents.students;

        const ns = { ...defNoStudents, ...outNoStudents, ...s };

        mapLegacy(ns, 'fetchInterval', 'fetchIntervalMs', (v) => Number(v), `students[${i}]`);
        mapLegacy(ns, 'days', 'daysToShow', (v) => Number(v), `students[${i}]`);
        mapLegacy(ns, 'examsDays', 'examsDaysAhead', (v) => Number(v), `students[${i}]`);
        mapLegacy(ns, 'mergeGapMin', 'mergeGapMinutes', (v) => Number(v), `students[${i}]`);

        if (ns.displaymode !== undefined && ns.displaymode !== null && ns.displaymode !== '') {
          ns.displayMode = String(ns.displaymode).toLowerCase();
          legacyUsed.push(`students[${i}].displaymode`);
        }
        if (typeof ns.displayMode === 'string') ns.displayMode = ns.displayMode.toLowerCase();

        out.students[i] = ns;
      }
    }

    if (legacyUsed.length > 0) {
      try {
        const uniq = Array.from(new Set(legacyUsed));
        const msg = `Deprecated config keys detected and mapped: ${uniq.join(', ')}. Please update your config to use the new keys.`;
        if (typeof Log !== 'undefined' && Log && typeof Log.warn === 'function') {
          Log.warn('[MMM-Webuntis] ' + msg);
        } else {
          console.warn('[MMM-Webuntis] ' + msg);
        }
      } catch {
        // ignore
      }
    }

    this._log('debug', 'Normalized legacy config keys (post-merge)', out);
    return out;
  },

  _buildSendConfig() {
    const defNoStudents = { ...(this.config || {}) };
    delete defNoStudents.students;

    const rawStudents = Array.isArray(this.config.students) ? this.config.students : [];
    const mergedStudents = rawStudents.map((s) => ({ ...defNoStudents, ...(s || {}) }));

    return { ...this.config, students: mergedStudents, id: this.identifier };
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

    const now = new Date();
    this._currentTodayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

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
    if (typeof this.config?.fetchIntervalMs !== 'number') return;

    this._fetchTimer = setInterval(() => {
      this.sendSocketNotification('FETCH_DATA', this._buildSendConfig());
    }, this.config.fetchIntervalMs);
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
          try {
            console.warn('MMM-Webuntis warning:', w);
          } catch {
            /* ignore console errors */
          }
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
