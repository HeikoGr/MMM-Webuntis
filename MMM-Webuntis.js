Module.register('MMM-Webuntis', {
  defaults: {
    header: '', // no header by default
    daysToShow: 7, // number of days to show per student
    fetchIntervalMs: 15 * 60 * 1000, // 15 minutes (ms)
    showStartTime: false, // whether to show start time in lesson listings
    useClassTimetable: false, // whether to use class timetable instead of student timetable
    showRegularLessons: false, // whether to show regular lessons (not only substitutions)
    showTeacherMode: 'full', // 'initial'|'full'|'none' - how to show teacher info
    useShortSubject: false, // whether to use short subject names
    showSubstitutionText: false, // whether to show substitution text
    examsDaysAhead: 0, // number of days ahead to show exams
    showExamSubject: true, // whether to show subject in exam listings
    showExamTeacher: true, // whether to show teacher in exam listings
    mode: 'verbose', // 'verbose' or 'compact' mode
    mergeGapMinutes: 15, // maximum gap in minutes allowed between consecutive lessons to merge
    pastDaysToShow: 0, // number of past days to include (show previous days)

    // Comma-separated list of widgets to render, top-to-bottom.
    // Supported widgets: grid, lessons, exams, homework, absences
    // Backwards compatible aliases: 'list' => lessons, exams  |  'grid' => grid
    displayMode: 'list',

    // Maximum number of lessons to display per day in grid view.
    // 0 (default) means show all lessons. Can be overridden per-student.
    maxGridLessons: 0,

    logLevel: 'none', // 'debug' or 'none'

    students: [
      {
        title: 'SET CONFIG!',
        qrcode: '',
        school: '',
        username: '',
        password: '',
        server: '',
        class: '',
      },
    ],
  },

  getStyles() {
    return [this.file('MMM-Webuntis.css')];
  },

  getScripts() {
    return [
      this.file('widgets/util.js'),
      this.file('widgets/lessons.js'),
      this.file('widgets/exams.js'),
      this.file('widgets/homework.js'),
      this.file('widgets/absences.js'),
      this.file('widgets/grid.js'),
    ];
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

  _log(level, ...args) {
    try {
      const prefix = '[MMM-Webuntis]';
      const logger = typeof Log !== 'undefined' && Log ? Log : null;
      if (level === 'info') {
        if (logger?.info) logger.info(prefix, ...args);
        else console.warn(prefix, ...args);
      } else if (level === 'warn') {
        if (logger?.warn) logger.warn(prefix, ...args);
        else console.warn(prefix, ...args);
      } else if (level === 'debug') {
        if (this?.config?.logLevel === 'debug') {
          if (logger?.log) logger.log(prefix + ' [DEBUG]', ...args);
          else console.warn(prefix + ' [DEBUG]', ...args);
        }
      } else {
        if (logger?.log) logger.log(prefix, ...args);
        else console.warn(prefix, ...args);
      }
    } catch (e) {
      console.error('[MMM-Webuntis] [LOGGING ERROR]', e);
    }
  },

  _addTableHeader(table, studentTitle = '') {
    const thisRow = document.createElement('tr');
    const studentCell = this._createEl('th', 'align-left alignTop', studentTitle);
    studentCell.colSpan = 3;
    thisRow.appendChild(studentCell);
    table.appendChild(thisRow);
  },

  _addTableRow(table, type, studentTitle = '', text1 = '', text2 = '', addClass = '') {
    const thisRow = document.createElement('tr');
    thisRow.className = type;

    if (studentTitle !== '') {
      const studentCell = this._createEl('td', 'align-left alignTop bold', studentTitle);
      thisRow.appendChild(studentCell);
    }

    const cell1 = this._createEl('td', 'align-left alignTop', text1);
    if (text2 === '') cell1.colSpan = 2;
    thisRow.appendChild(cell1);

    if (text2 !== '') {
      const cell2 = this._createEl('td', `align-left alignTop ${addClass}`, text2);
      thisRow.appendChild(cell2);
    }

    table.appendChild(thisRow);
  },

  _createEl(tag, className = '', innerHTML = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML !== undefined && innerHTML !== null) el.innerHTML = innerHTML;
    return el;
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

  _toMinutes(t) {
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

  _renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams) {
    const api = this._getWidgetApi();
    const fn = api?.grid?.renderGridForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'grid widget script not loaded');
      return null;
    }
    return fn(this, studentTitle, studentConfig, timetable, homeworks, timeUnits, exams);
  },

  _renderListForStudent(table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap) {
    const api = this._getWidgetApi();
    const fn = api?.lessons?.renderLessonsForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'lessons widget script not loaded');
      return 0;
    }
    return fn(this, table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap);
  },

  _renderExamsForStudent(table, studentCellTitle, studentConfig, exams) {
    const api = this._getWidgetApi();
    const fn = api?.exams?.renderExamsForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'exams widget script not loaded');
      return 0;
    }
    return fn(this, table, studentCellTitle, studentConfig, exams);
  },

  _renderHomeworksForStudent(table, studentCellTitle, studentConfig, homeworks) {
    const api = this._getWidgetApi();
    const fn = api?.homework?.renderHomeworksForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'homework widget script not loaded');
      return 0;
    }
    return fn(this, table, studentCellTitle, studentConfig, homeworks);
  },

  _renderAbsencesForStudent(table, studentCellTitle, studentConfig, absences) {
    const api = this._getWidgetApi();
    const fn = api?.absences?.renderAbsencesForStudent;
    if (typeof fn !== 'function') {
      this._log('warn', 'absences widget script not loaded');
      return 0;
    }
    return fn(this, table, studentCellTitle, studentConfig, absences);
  },

  start() {
    this.config = this._normalizeLegacyConfig(this.config, this.defaults);

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
    this.preprocessedByStudent = {};

    this._paused = false;
    this._startNowLineUpdater();

    const now = new Date();
    this._currentTodayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

    this.config.id = this.identifier;
    this.sendSocketNotification('FETCH_DATA', this.config);
  },

  _startNowLineUpdater() {
    if (this._paused) return;
    if (!this._hasWidget('grid')) return;
    if (this._nowLineTimer || this._nowLineTimerInitialTimeout) return;

    const tick = () => {
      try {
        const nowLocal = new Date();
        const nowYmd = nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
        if (this._currentTodayYmd === undefined) this._currentTodayYmd = nowYmd;
        if (nowYmd !== this._currentTodayYmd) {
          try {
            this.sendSocketNotification('FETCH_DATA', this.config);
          } catch {
            // ignore
          }
          try {
            this.updateDom();
          } catch {
            // ignore
          }
          this._currentTodayYmd = nowYmd;
        }

        this._updateNowLinesAll();
        this._refreshPastMasks();
      } catch (err) {
        this._log('warn', 'minute tick update failed', err);
      }
    };

    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    this._nowLineTimerInitialTimeout = setTimeout(
      () => {
        tick();
        this._nowLineTimer = setInterval(tick, 60 * 1000);
        this._nowLineTimerInitialTimeout = null;
      },
      Math.max(0, msToNextMinute)
    );

    tick();
  },

  _stopNowLineUpdater() {
    if (this._nowLineTimer) {
      clearInterval(this._nowLineTimer);
      this._nowLineTimer = null;
    }
    if (this._nowLineTimerInitialTimeout) {
      clearTimeout(this._nowLineTimerInitialTimeout);
      this._nowLineTimerInitialTimeout = null;
    }
  },

  _refreshPastMasks() {
    try {
      const now = new Date();
      const todayYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const lessons = document.querySelectorAll('.grid-combined .grid-lesson');
      lessons.forEach((ln) => {
        const ds = ln.getAttribute('data-date');
        const de = ln.getAttribute('data-end-min');
        if (!ds) return;
        const lessonYmd = Number(ds) || 0;
        const endMin = de !== null && de !== undefined ? Number(de) : NaN;
        let isPast = false;
        if (lessonYmd < todayYmd) {
          isPast = true;
        } else if (lessonYmd === todayYmd) {
          if (!Number.isNaN(endMin) && endMin <= nowMin) isPast = true;
        }
        if (isPast) ln.classList.add('past');
        else ln.classList.remove('past');
      });
    } catch (e) {
      this._log('warn', 'failed to refresh past masks', e);
    }
  },

  _startFetchTimer() {
    if (this._paused) return;
    if (this._fetchTimer) return;
    if (typeof this.config?.fetchIntervalMs !== 'number') return;

    this._fetchTimer = setInterval(() => {
      this.sendSocketNotification('FETCH_DATA', this.config);
    }, this.config.fetchIntervalMs);
  },

  _stopFetchTimer() {
    if (this._fetchTimer) {
      clearInterval(this._fetchTimer);
      this._fetchTimer = null;
    }
  },

  suspend() {
    this._paused = true;
    this._stopNowLineUpdater();
    this._stopFetchTimer();
  },

  resume() {
    this._paused = false;
    this.sendSocketNotification('FETCH_DATA', this.config);
    this._startFetchTimer();
    this._startNowLineUpdater();
  },

  _updateNowLinesAll() {
    try {
      const inners = document.querySelectorAll('.day-column-inner');
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      inners.forEach((inner) => {
        const nl = inner._nowLine;
        const allS = inner._allStart;
        const allE = inner._allEnd;
        const h = inner._totalHeight;
        if (!nl || allS === undefined || allE === undefined || h === undefined) return;
        if (nowMin < allS || nowMin > allE) {
          nl.style.display = 'none';
          return;
        }
        nl.style.display = 'block';
        const top = Math.round(((nowMin - allS) / (allE - allS)) * h);
        nl.style.top = `${top}px`;
      });
    } catch (e) {
      this._log('warn', 'updateNowLinesAll failed', e);
    }
  },

  getDom() {
    const wrapper = document.createElement('div');
    const widgets = this._getDisplayWidgets();

    const makeTable = () => {
      const t = document.createElement('table');
      t.className = 'bright small light';
      return t;
    };

    if (!this.timetableByStudent || Object.keys(this.timetableByStudent).length === 0) {
      return wrapper;
    }

    const sortedStudentTitles = Object.keys(this.timetableByStudent).sort();

    for (const widget of widgets) {
      if (widget === 'grid') {
        for (const studentTitle of sortedStudentTitles) {
          const timetable = this.timetableByStudent[studentTitle] || [];
          const studentConfig = this.configByStudent[studentTitle] || this.config;
          const timeUnits = this.timeUnitsByStudent[studentTitle] || [];
          const homeworks = this.homeworksByStudent?.[studentTitle] || [];
          const exams = this.examsByStudent?.[studentTitle] || [];

          if (timeUnits.length > 0 && timetable.length > 0) {
            const gridElem = this._renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits, exams);
            if (gridElem) wrapper.appendChild(gridElem);
          }
        }
        continue;
      }

      if (widget === 'lessons') {
        const table = makeTable();
        let tableHasRows = false;

        for (const studentTitle of sortedStudentTitles) {
          const timetable = this.timetableByStudent[studentTitle] || [];
          const studentConfig = this.configByStudent[studentTitle] || this.config;
          const startTimesMap = this.periodNamesByStudent?.[studentTitle] || {};

          let studentCellTitle = '';
          if (this.config.mode === 'verbose' && this.config.students.length > 1) {
            this._addTableHeader(table, studentTitle);
          } else {
            studentCellTitle = studentTitle;
          }

          const listCount = this._renderListForStudent(table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap);
          if (listCount > 0) tableHasRows = true;
        }

        if (tableHasRows) wrapper.appendChild(table);
        continue;
      }

      if (widget === 'exams') {
        const table = makeTable();
        let tableHasRows = false;

        for (const studentTitle of sortedStudentTitles) {
          const studentConfig = this.configByStudent[studentTitle] || this.config;
          const exams = this.examsByStudent?.[studentTitle] || [];

          let studentCellTitle = '';
          if (this.config.mode === 'verbose' && this.config.students.length > 1) {
            this._addTableHeader(table, studentTitle);
          } else {
            studentCellTitle = studentTitle;
          }

          if (Array.isArray(exams) && Number(studentConfig?.examsDaysAhead) > 0) {
            const examCount = this._renderExamsForStudent(table, studentCellTitle, studentConfig, exams);
            if (examCount > 0) tableHasRows = true;
          }
        }

        if (tableHasRows) wrapper.appendChild(table);
        continue;
      }

      if (widget === 'homework') {
        const table = makeTable();
        let tableHasRows = false;

        for (const studentTitle of sortedStudentTitles) {
          const studentConfig = this.configByStudent[studentTitle] || this.config;
          const homeworks = this.homeworksByStudent?.[studentTitle] || [];

          let studentCellTitle = '';
          if (this.config.mode === 'verbose' && this.config.students.length > 1) {
            this._addTableHeader(table, studentTitle);
          } else {
            studentCellTitle = studentTitle;
          }

          const hwCount = this._renderHomeworksForStudent(table, studentCellTitle, studentConfig, homeworks);
          if (hwCount > 0) tableHasRows = true;
        }

        if (tableHasRows) wrapper.appendChild(table);
        continue;
      }

      if (widget === 'absences') {
        const table = makeTable();
        let tableHasRows = false;

        for (const studentTitle of sortedStudentTitles) {
          const studentConfig = this.configByStudent[studentTitle] || this.config;
          const absences = this.absencesByStudent?.[studentTitle] || [];

          let studentCellTitle = '';
          if (this.config.mode === 'verbose' && this.config.students.length > 1) {
            this._addTableHeader(table, studentTitle);
          } else {
            studentCellTitle = studentTitle;
          }

          const abCount = this._renderAbsencesForStudent(table, studentCellTitle, studentConfig, absences);
          if (abCount > 0) tableHasRows = true;
        }

        if (tableHasRows) wrapper.appendChild(table);
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

    const grid = payload.timegrid || [];
    let timeUnits = [];
    try {
      if (Array.isArray(grid) && grid[0] && Array.isArray(grid[0].timeUnits)) {
        timeUnits = grid[0].timeUnits.map((u) => ({
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

    this.timetableByStudent[title] = Array.isArray(payload.timetableRange) ? payload.timetableRange : [];

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

    this.updateDom();
  },
});
