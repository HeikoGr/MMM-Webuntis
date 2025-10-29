// eslint-disable-next-line no-undef
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
    displayMode: 'list', // 'list' (default) or 'grid'
    logLevel: 'none', // enable debug logging ('debug' or 'none')
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
    return ['MMM-Webuntis.css'];
  },

  getTranslations() {
    return {
      en: 'translations/en.json',
      de: 'translations/de.json',
    };
  },

  /* Helper to add a table header row */
  _addTableHeader(table, studentTitle = '') {
    const thisRow = document.createElement('tr');
    const cellType = 'th';
    const studentCell = this._createEl(cellType, 'align-left alignTop', studentTitle);
    studentCell.colSpan = 3;
    thisRow.appendChild(studentCell);
    table.appendChild(thisRow);
  },

  /* Helper to add a table row */
  _addTableRow(table, type, studentTitle = '', text1 = '', text2 = '', addClass = '') {
    const thisRow = document.createElement('tr');
    thisRow.className = type;
    const cellType = 'td';

    if (studentTitle != '') {
      const studentCell = this._createEl(cellType, 'align-left alignTop bold', studentTitle);
      thisRow.appendChild(studentCell);
    }

    const cell1 = this._createEl(cellType, 'align-left alignTop ', text1);
    if (text2 == '') {
      cell1.colSpan = 2;
    }
    thisRow.appendChild(cell1);

    if (text2 != '') {
      const cell2 = this._createEl(cellType, `align-left alignTop ${addClass}`, text2);
      thisRow.appendChild(cell2);
    }

    table.appendChild(thisRow);
  },

  /* Small DOM factory helper to reduce repetition */
  _createEl(tag, className = '', innerHTML = '') {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (innerHTML !== undefined && innerHTML !== null) el.innerHTML = innerHTML;
    return el;
  },

  /* Small helper to safely count arrays (returns 0 for non-arrays) */
  _countArray(arr) {
    return Array.isArray(arr) ? arr.length : 0;
  },

  /* Lightweight logging helper with levels: info, debug, warn */
  _log(level, ...args) {
    try {
      const prefix = '[MMM-Webuntis]';
      if (level === 'info') {
        console.info(prefix, ...args);
      } else if (level === 'warn') {
        console.warn(prefix, ...args);
      } else if (level === 'debug') {
        // Only output debug when module-level config enables it
        if (this && this.config && this.config.logLevel === 'debug') {
          if (typeof console.debug === 'function') {
            console.debug(prefix + ' [DEBUG]', ...args);
          } else {
            console.info(prefix + ' [DEBUG]', ...args);
          }
        }
      } else {
        console.log(prefix, ...args);
      }
    } catch (e) {
      console.error('[MMM-Webuntis] [LOGGING ERROR]', e);
      // swallow logging errors
    }
  },

  /* Map legacy 0.1.0-style config keys to current keys (returns a normalized copy)
    Important: MagicMirror merges defaults before start(), so new keys already exist.
    Current strategy: If a legacy key is present in the user's config, the legacy
    value is applied and will override the corresponding new key (legacy values win).
    A list of detected legacy keys is collected and a red console warning is emitted
    so users can update their `config.js`. The mapper operates on both top-level
    config and per-student objects. */
  _normalizeLegacyConfig(cfg, defaultsRef) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const out = { ...cfg };
    const def = defaultsRef && typeof defaultsRef === 'object' ? defaultsRef : this?.defaults || {};

    const legacyUsed = [];
    const mapLegacy = (obj, defLocal, legacyKey, newKey, transform, context = 'config') => {
      if (!obj || typeof obj !== 'object') return;
      const hasLegacy = obj[legacyKey] !== undefined && obj[legacyKey] !== null && obj[legacyKey] !== '';
      if (!hasLegacy) return;
      // record usage for a warning later
      legacyUsed.push(`${context}.${legacyKey}`);
      const legacyVal = typeof transform === 'function' ? transform(obj[legacyKey]) : obj[legacyKey];
      // Unconditionally apply legacy value so legacy keys "win"
      obj[newKey] = legacyVal;
    };

    // ----- Top-level mappings -----
    mapLegacy(out, def, 'fetchInterval', 'fetchIntervalMs', (v) => Number(v), 'config');
    mapLegacy(out, def, 'days', 'daysToShow', (v) => Number(v), 'config');
    mapLegacy(out, def, 'examsDays', 'examsDaysAhead', (v) => Number(v), 'config');
    mapLegacy(out, def, 'mergeGapMin', 'mergeGapMinutes', (v) => Number(v), 'config');

    // Logging: simple map debug/enableDebug -> logLevel when legacy key present
    const dbg = out.debug ?? out.enableDebug;
    if (typeof dbg === 'boolean') {
      legacyUsed.push('config.debug|enableDebug');
      out.logLevel = dbg ? 'debug' : 'none';
    }

    // displayMode casing and legacy alias: map unconditionally when legacy provided
    if (out.displaymode !== undefined && out.displaymode !== null && out.displaymode !== '') {
      legacyUsed.push('config.displaymode');
      out.displayMode = String(out.displaymode).toLowerCase();
    }
    if (typeof out.displayMode === 'string') out.displayMode = out.displayMode.toLowerCase();

    // ----- Per-student overrides -----
    if (Array.isArray(out.students)) {
      // per-student default baseline inherits from top-level (so student defaults == module-level after normalization)
      const defForStudent = { ...def, ...out };
      for (let i = 0; i < out.students.length; i++) {
        const s = out.students[i];
        if (!s || typeof s !== 'object') continue;
        const ns = { ...s };
        const ctx = `students[${i}]`;
        mapLegacy(ns, defForStudent, 'fetchInterval', 'fetchIntervalMs', (v) => Number(v), ctx);
        mapLegacy(ns, defForStudent, 'days', 'daysToShow', (v) => Number(v), ctx);
        mapLegacy(ns, defForStudent, 'examsDays', 'examsDaysAhead', (v) => Number(v), ctx);
        mapLegacy(ns, defForStudent, 'mergeGapMin', 'mergeGapMinutes', (v) => Number(v), ctx);

        // logLevel from per-student debug/enableDebug (legacy wins)
        const sdbg = ns.debug ?? ns.enableDebug;
        if (typeof sdbg === 'boolean') {
          ns.logLevel = sdbg ? 'debug' : 'none';
          legacyUsed.push(`${ctx}.debug|enableDebug`);
        }

        // displayMode per-student (legacy wins)
        if (ns.displaymode !== undefined && ns.displaymode !== null && ns.displaymode !== '') {
          ns.displayMode = String(ns.displaymode).toLowerCase();
          legacyUsed.push(`${ctx}.displaymode`);
        }
        if (typeof ns.displayMode === 'string') ns.displayMode = ns.displayMode.toLowerCase();
        out.students[i] = ns;
      }
    }

    // If any legacy keys were used, warn in the browser console (red) so users notice during startup
    if (Array.isArray(legacyUsed) && legacyUsed.length > 0) {
      try {
        const uniq = Array.from(new Set(legacyUsed));
        const msg = `Deprecated config keys detected and mapped: ${uniq.join(', ')}. Please update your config to use the new keys.`;
        // styled warning (red, bold) in browser console
        if (typeof console !== 'undefined' && typeof console.warn === 'function') {
          console.warn('%c[MMM-Webuntis] ' + msg, 'color: #c00; font-weight: bold');
        } else if (typeof console !== 'undefined' && typeof console.log === 'function') {
          console.log('[MMM-Webuntis] ' + msg);
        }
      } catch {
        // ignore console failures
      }
    }

    this._log('debug', 'Normalized legacy config keys (post-merge)', out);
    return out;
  },

  // ===== Frontend data processing helpers =====
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

  /* Render the multi-day grid for a student: returns a DOM element containing header and grid */
  _renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits) {
    // studentTitle: title/key for the student used to lookup preprocessed groups
    // studentConfig: per-student options merged with module defaults
    // lessons: array of lesson objects (must contain numeric startMin/endMin)
    // homeworks: optional array of homework objects to link to lessons
    // timeUnits: array of named time rows used to draw hour lines
    // number of upcoming days to show (per-student config overrides module config)
    const daysToShow = studentConfig.daysToShow && studentConfig.daysToShow > 0 ? parseInt(studentConfig.daysToShow) : 1;
    // pastDaysToShow: how many past days to include (can be set per-student or globally)
    const pastDays = Math.max(0, parseInt(studentConfig.pastDaysToShow ?? this.config.pastDaysToShow ?? 0));
    // start offset (negative means we start in the past)
    const startOffset = -pastDays;
    // total days displayed = pastDays + future/current window
    const totalDisplayDays = daysToShow;

    const header = document.createElement('div');
    header.className = 'grid-days-header';
    // build columns: first column is time axis, then for each displayed day two columns (left/right)
    const cols = ['minmax(60px,auto)'];
    for (let d = 0; d < totalDisplayDays; d++) {
      cols.push('1fr'); // left half
      cols.push('1fr'); // right half
    }
    header.style.gridTemplateColumns = cols.join(' ');

    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'grid-days-header-empty';
    header.appendChild(emptyHeader);

    const today = new Date();
    // apply startOffset to include past days when configured
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d; // negative for past days
      const dayDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayIndex);
      const dayLabel = document.createElement('div');
      dayLabel.className = 'grid-daylabel';
      dayLabel.innerText = `${dayDate.toLocaleDateString(this.config.language, { weekday: 'short', day: 'numeric', month: 'numeric' })}`;
      // span both columns for this day
      const startCol = 2 + d * 2;
      const endCol = startCol + 2;
      dayLabel.style.gridColumn = `${startCol} / ${endCol}`;
      header.appendChild(dayLabel);
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-combined';
    // We position lessons absolutely inside per-day columns based on exact start/end times.
    grid.style.gridTemplateColumns = cols.join(' ');

    // Minute conversion is handled in the frontend; compute numeric startMin/endMin from raw entries on the fly.

    let allStart = Infinity;
    let allEnd = -Infinity;
    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      timeUnits.forEach((u) => {
        if (u.startMin !== undefined && u.startMin !== null) allStart = Math.min(allStart, u.startMin);
        if (u.endMin !== undefined && u.endMin !== null) allEnd = Math.max(allEnd, u.endMin);
      });
    } else {
      // compute from raw timetable but filter out full-day-ish events (>= 12h)
      (Array.isArray(timetable) ? timetable : []).forEach((el) => {
        const s = this._toMinutes(el.startTime);
        const e = el.endTime ? this._toMinutes(el.endTime) : null;
        if (s !== null && s !== undefined && e !== null && e !== undefined) {
          if (e - s < 12 * 60) {
            allStart = Math.min(allStart, s);
            allEnd = Math.max(allEnd, e);
          }
        } else if (s !== null && s !== undefined) {
          allStart = Math.min(allStart, s);
        }
      });
    }

    if (!isFinite(allStart) || allEnd <= allStart) {
      // fallback to standard school day
      allStart = 7 * 60; // 07:00
      allEnd = 17 * 60; // 17:00
    }

    const totalMinutes = allEnd - allStart;
    // visual scale: pixels per minute (2px/min gives ~120px for 2 hours)
    const pxPerMinute = 1;
    const totalHeight = Math.max(120, Math.round(totalMinutes * pxPerMinute));

    // Create time axis column as the left column with absolute-positioned labels
    const timeAxis = document.createElement('div');
    timeAxis.className = 'grid-timecell';
    // inner timeline container
    const timeInner = document.createElement('div');
    timeInner.style.position = 'relative';
    timeInner.style.height = `${totalHeight}px`;
    timeInner.style.width = '100%';
    // add markers from timeUnits or hourly markers
    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      for (let u of timeUnits) {
        if (u.startMin === undefined || u.startMin === null) continue;
        const m = u.startMin;
        const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
        const lab = document.createElement('div');
        lab.style.position = 'absolute';
        lab.style.top = `${top}px`;
        lab.style.left = '4px';
        lab.style.zIndex = 2; // ensure label sits above hour lines
        lab.style.fontSize = '0.85em';
        lab.style.color = '#666';
        lab.innerText = `${u.name} Std.\n ${String(u.startTime)
          .padStart(4, '0')
          .replace(/(\d{2})(\d{2})/, '$1:$2')}`;
        timeInner.appendChild(lab);
        // mirror hour line in the time axis to match day columns
        if (u.endMin !== undefined && u.endMin !== null && u.endMin >= allStart && u.endMin <= allEnd) {
          const lineTop = Math.round(((u.endMin - allStart) / totalMinutes) * totalHeight);
          const tline = document.createElement('div');
          tline.className = 'grid-hourline';
          tline.style.top = `${lineTop + 2}px`;
          timeInner.appendChild(tline);
        }
      }
    } else {
      // hourly markers
      for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
        const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
        const lab = document.createElement('div');
        lab.style.position = 'absolute';
        lab.style.top = `${top}px`;
        lab.style.zIndex = 2;
        lab.style.left = '4px';
        lab.style.fontSize = '0.85em';
        lab.style.color = '#666';
        const hh = String(Math.floor(m / 60)).padStart(2, '0');
        const mm = String(m % 60).padStart(2, '0');
        lab.innerText = `${hh}:${mm}`;
        timeInner.appendChild(lab);
        // add corresponding hour line
        const tline = document.createElement('div');
        tline.className = 'grid-hourline';
        tline.style.top = `${top}px`;
        timeInner.appendChild(tline);
      }
    }
    timeAxis.appendChild(timeInner);
    timeAxis.style.gridColumn = '1';
    grid.appendChild(timeAxis);

    // Build per-day lessons later using pre-grouped source
    // build one column group per displayed day; account for past days by applying startOffset
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const targetDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + dayIndex);
      const dateStr = `${targetDate.getFullYear()}${('0' + (targetDate.getMonth() + 1)).slice(-2)}${('0' + targetDate.getDate()).slice(-2)}`;

      // Build day's lessons from raw timetable entries
      // Prefer grouped raw entries if available to avoid filtering the whole array
      const groupedRaw =
        this.preprocessedByStudent && this.preprocessedByStudent[studentTitle] && this.preprocessedByStudent[studentTitle].rawGroupedByDate
          ? this.preprocessedByStudent[studentTitle].rawGroupedByDate
          : null;

      const sourceForDay =
        groupedRaw && groupedRaw[dateStr]
          ? groupedRaw[dateStr]
          : (Array.isArray(timetable) ? timetable : [])
              .filter((el) => String(el.date) === dateStr)
              .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      let dayLessons = sourceForDay.map((el) => ({
        dateStr: String(el.date),
        startMin: this._toMinutes(el.startTime),
        endMin: el.endTime ? this._toMinutes(el.endTime) : null,
        startTime: el.startTime ? String(el.startTime).padStart(4, '0') : '',
        endTime: el.endTime ? String(el.endTime).padStart(4, '0') : null,
        subjectShort: el.su?.[0]?.name || el.su?.[0]?.longname || 'N/A',
        subject: el.su?.[0]?.longname || el.su?.[0]?.name || 'N/A',
        teacherInitial: el.te?.[0]?.name || el.te?.[0]?.longname || 'N/A',
        teacher: el.te?.[0]?.longname || el.te?.[0]?.name || 'N/A',
        code: el.code || '',
        substText: el.substText || '',
        text: el.lstext || '',
        lessonId: el.id ?? el.lid ?? el.lessonId ?? null,
      }));

      // merge double lessons
      const mergedLessons = [];
      for (let i = 0; i < dayLessons.length; i++) {
        let curr = { ...dayLessons[i] };
        // preserve all lesson ids for merged lessons
        curr.lessonIds = [];
        const firstId = curr.lessonId ?? curr.id ?? curr.lid ?? null;
        if (firstId !== null && firstId !== undefined) curr.lessonIds.push(String(firstId));
        // ensure text fields exist
        curr.substText = curr.substText || '';
        curr.text = curr.text || '';
        let j = i + 1;
        // Merge loop: use numeric minute comparisons and configurable gap (mergeGapMin)
        while (j < dayLessons.length) {
          const cand = dayLessons[j];
          const currEndMin = curr.endMin !== undefined && curr.endMin !== null ? curr.endMin : null;
          const candStartMin = cand.startMin !== undefined && cand.startMin !== null ? cand.startMin : null;
          const candEndMin = cand.endMin !== undefined && cand.endMin !== null ? cand.endMin : null;
          const gapMin = candStartMin - currEndMin;
          const allowedGap = Number(this.config.mergeGapMinutes ?? 15);
          const sameContent =
            cand.subjectShort === curr.subjectShort && cand.teacherInitial === curr.teacherInitial && cand.code === curr.code;

          // require candidate to start at or after current end, within allowed gap, and same content
          if (currEndMin === null || candStartMin === null) {
            // missing numeric times: cannot reliably merge; break
            break;
          }
          if (!(candStartMin >= currEndMin && gapMin <= allowedGap && sameContent)) {
            break;
          }

          // extend merged lesson (update both string times and numeric minutes)
          curr.endTime = cand.endTime;
          curr.endMin = candEndMin !== null ? candEndMin : candStartMin + 45;
          curr.substText = curr.substText || '';
          curr.text = curr.text || '';
          if (cand.substText && !curr.substText.includes(cand.substText)) curr.substText += `\n${cand.substText}`;
          if (cand.text && !curr.text.includes(cand.text)) curr.text += `\n${cand.text}`;
          // collect lesson ids
          const addId = cand.lessonId ?? cand.id ?? cand.lid ?? null;
          if (addId !== null && addId !== undefined) curr.lessonIds.push(String(addId));
          j++;
        }
        // ensure lessonId is set when available
        if ((!curr.lessonId || curr.lessonId === null) && curr.lessonIds && curr.lessonIds.length > 0) curr.lessonId = curr.lessonIds[0];
        // ensure numeric bounds on merged lesson exist
        if (curr.startMin === undefined || curr.startMin === null) {
          // try to take from curr.startTime if possible (no conversion allowed here) -> skip if not present
          // In normal operation node_helper provides startMin; log in debug
          this._log(
            'warn',
            'Merged lesson missing startMin; backend should provide numeric startMin/endMin',
            curr.lessonId ? { lessonId: curr.lessonId } : curr
          );
        }
        if (curr.endMin === undefined || curr.endMin === null) {
          // if still missing, try set endMin = startMin + 45 when startMin available
          if (curr.startMin !== undefined && curr.startMin !== null) curr.endMin = curr.startMin + 45;
        }
        mergedLessons.push(curr);
        i = j - 1;
      }

      const colLeft = 2 + d * 2;
      const colRight = colLeft + 1;

      // Create per-day wrappers once: left, right and both (span both columns)
      const leftWrap = document.createElement('div');
      leftWrap.style.gridColumn = `${colLeft}`;
      leftWrap.style.gridRow = '1';
      const leftInner = document.createElement('div');
      leftInner.className = 'day-column-inner';
      leftInner.style.height = `${totalHeight}px`;
      leftInner.style.position = 'relative';
      leftWrap.appendChild(leftInner);

      const rightWrap = document.createElement('div');
      rightWrap.style.gridColumn = `${colRight}`;
      rightWrap.style.gridRow = '1';
      const rightInner = document.createElement('div');
      rightInner.className = 'day-column-inner';
      rightInner.style.height = `${totalHeight}px`;
      rightInner.style.position = 'relative';
      rightWrap.appendChild(rightInner);

      const bothWrap = document.createElement('div');
      bothWrap.style.gridColumn = `${colLeft} / ${colRight + 1}`; // span both columns
      bothWrap.style.gridRow = '1';
      const bothInner = document.createElement('div');
      bothInner.className = 'day-column-inner';
      bothInner.style.height = `${totalHeight}px`;
      bothInner.style.position = 'relative';
      bothWrap.appendChild(bothInner);

      // append wrappers to grid (bothWrap first so it sits behind left/right if overlapping)
      grid.appendChild(bothWrap);
      grid.appendChild(leftWrap);
      grid.appendChild(rightWrap);

      // add thin hour divider lines to the day's background (use timeUnits if available)
      try {
        if (Array.isArray(timeUnits) && timeUnits.length > 0) {
          for (let u of timeUnits) {
            if (u.endMin === undefined || u.endMin === null) continue;
            // only draw if within visible range
            if (u.endMin < allStart || u.endMin > allEnd) continue;
            const top = Math.round(((u.endMin - allStart) / totalMinutes) * totalHeight);
            const line = document.createElement('div');
            line.className = 'grid-hourline';
            line.style.top = `${top + 2}px`;
            bothInner.appendChild(line);
          }
        } else {
          for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
            const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
            const line = document.createElement('div');
            line.className = 'grid-hourline';
            line.style.top = `${top}px`;
            bothInner.appendChild(line);
          }
        }
      } catch (e) {
        // non-fatal if drawing hour lines fails
        this._log('warn', 'failed to draw hour lines', e);
      }

      // Create and append 'now' line for this day and register to updater
      const nowLine = document.createElement('div');
      nowLine.className = 'grid-nowline';
      bothInner.appendChild(nowLine);
      // store reference on wrapper for updater
      bothInner._nowLine = nowLine;
      bothInner._allStart = allStart;
      bothInner._allEnd = allEnd;
      bothInner._totalHeight = totalHeight;

      // virtual no-lessons block when none -> create a single block spanning both columns
      if (mergedLessons.length === 0) {
        const noLesson = document.createElement('div');
        noLesson.className = 'grid-lesson lesson lesson-content no-lesson';
        noLesson.style.position = 'absolute';
        noLesson.style.top = '0px';
        noLesson.style.left = '0px';
        noLesson.style.right = '0px';
        noLesson.style.height = `${totalHeight}px`;
        noLesson.innerHTML = `<b>${this.translate('no-lessons')}</b>`;

        bothInner.appendChild(noLesson);
      }

      for (let idx = 0; idx < mergedLessons.length; idx++) {
        const lesson = mergedLessons[idx];

        // compute absolute positioning within the day's column using minutes
        // compute start/end minutes and clamp them to the visible range
        let sMin = lesson.startMin;
        let eMin = lesson.endMin;
        // clamp to within first/last lesson times so full-day events don't expand the timeline
        sMin = Math.max(sMin, allStart);
        eMin = Math.min(eMin, allEnd);
        // skip lessons that do not overlap the visible range
        if (eMin <= sMin) continue;
        const topPx = Math.round(((sMin - allStart) / totalMinutes) * totalHeight);
        const heightPx = Math.max(12, Math.round(((eMin - sMin) / totalMinutes) * totalHeight));

        // create lesson elements depending on type
        const leftCell = document.createElement('div');
        leftCell.className = 'grid-lesson lesson';
        leftCell.style.position = 'absolute';
        leftCell.style.top = `${topPx}px`;
        leftCell.style.left = '0px';
        leftCell.style.right = '0px';
        leftCell.style.height = `${heightPx}px`;

        const rightCell = document.createElement('div');
        rightCell.className = 'grid-lesson lesson';
        rightCell.style.position = 'absolute';
        rightCell.style.top = `${topPx}px`;
        rightCell.style.left = '0px';
        rightCell.style.right = '0px';
        rightCell.style.height = `${heightPx}px`;

        const bothCell = document.createElement('div');
        bothCell.className = 'grid-lesson lesson';
        bothCell.style.position = 'absolute';
        bothCell.style.top = `${topPx}px`;
        bothCell.style.left = '0px';
        bothCell.style.right = '0px';
        bothCell.style.height = `${heightPx}px`;

        const makeInner = (lsn) => {
          const base = `<b>${lsn.subjectShort || lsn.subject}</b><br>${lsn.teacherInitial || lsn.teacher}`;
          const subst = lsn.substText ? `<br><span class='xsmall dimmed'>${lsn.substText.replace(/\n/g, '<br>')}</span>` : '';
          const txt = lsn.text ? `<br><span class='xsmall dimmed'>${lsn.text.replace(/\n/g, '<br>')}</span>` : '';
          return `<div class='lesson-content'>${base + subst + txt}</div>`;
        };

        if (lesson.code === 'irregular') {
          leftCell.classList.add('lesson-replacement');
          leftCell.innerHTML = makeInner(lesson);
        } else if (lesson.code === 'cancelled') {
          rightCell.classList.add('lesson-cancelled-split');
          rightCell.innerHTML = makeInner(lesson);
        } else {
          bothCell.classList.add('lesson-regular');
          bothCell.innerHTML = makeInner(lesson);
        }

        if (homeworks && Array.isArray(homeworks)) {
          const hwMatch = homeworks.some((hw) => {
            const hwLessonId = hw.lessonId ?? hw.lid ?? hw.id ?? null;
            // const lessonLessonId = lesson.lessonId ?? null;
            const lessonIds =
              lesson.lessonIds && Array.isArray(lesson.lessonIds) ? lesson.lessonIds : lesson.lessonId ? [String(lesson.lessonId)] : [];
            const lessonIdMatch = hwLessonId && lessonIds.length > 0 ? lessonIds.includes(String(hwLessonId)) : false;
            const subjectMatch = hw.su && (hw.su.name === lesson.subjectShort || hw.su.longname === lesson.subject);
            return lessonIdMatch || subjectMatch;
          });
          if (hwMatch) {
            const icon = document.createElement('span');
            icon.className = 'homework-icon';
            icon.innerHTML = '📘';
            if (leftCell && leftCell.innerHTML) leftCell.appendChild(icon.cloneNode(true));
            else if (rightCell && rightCell.innerHTML) rightCell.appendChild(icon);
          }
        }

        // attach events and append to appropriate wrapper
        if (lesson.code === 'irregular') {
          leftInner.appendChild(leftCell);
        } else if (lesson.code === 'cancelled') {
          rightInner.appendChild(rightCell);
        } else {
          bothInner.appendChild(bothCell);
        }
      }
    }

    wrapper.appendChild(grid);
    return wrapper;
  },

  /* Render the list view for a student's timetable changes into the provided table */
  _renderListForStudent(table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap) {
    let addedRows = 0;

    if (!(studentConfig && studentConfig.daysToShow > 0)) return 0;

    // current local date/time as comparable numbers (YYYYMMDD and HHMM)
    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const nowHm = now.getHours() * 100 + now.getMinutes();

    // sort raw timetable entries by date and startTime
    const lessonsSorted = (Array.isArray(timetable) ? timetable : []).slice().sort((a, b) => {
      const da = Number(a.date) || 0;
      const db = Number(b.date) || 0;
      return da - db || (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
    });

    for (let i = 0; i < lessonsSorted.length; i++) {
      const entry = lessonsSorted[i];
      const dateStr = String(entry.date);
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10);
      const day = parseInt(dateStr.substring(6, 8), 10);
      const stNum = Number(entry.startTime) || 0;
      const stHour = Math.floor(stNum / 100);
      const stMin = stNum % 100;
      // Date object only for weekday label
      const timeForDay = new Date(year, month - 1, day);

      // Skip if nothing special or past lessons (unless in debug mode)
      const isPast = Number(entry.date) < nowYmd || (Number(entry.date) === nowYmd && stNum < nowHm);
      if (
        (!studentConfig.showRegularLessons && (entry.code || '') === '') ||
        (isPast && (entry.code || '') !== 'error' && this.config.logLevel !== 'debug')
      ) {
        continue;
      }

      addedRows++;

      let timeStr = `${timeForDay.toLocaleDateString(this.config.language, { weekday: 'short' }).toUpperCase()}&nbsp;`;
      if (studentConfig.showStartTime || startTimesMap[entry.startTime] === undefined) {
        const hh = String(stHour).padStart(2, '0');
        const mm = String(stMin).padStart(2, '0');
        timeStr += `${hh}:${mm}`;
      } else {
        timeStr += `${startTimesMap[entry.startTime]}.`;
      }

      // subject
      const subjLong = entry.su?.[0]?.longname || entry.su?.[0]?.name || 'N/A';
      const subjShort = entry.su?.[0]?.name || entry.su?.[0]?.longname || 'N/A';
      let subjectStr = studentConfig.useShortSubject ? subjShort : subjLong;

      // teacher name
      if (studentConfig.showTeacherMode === 'initial') {
        const teacherInitial = entry.te?.[0]?.name || entry.te?.[0]?.longname || '';
        if (teacherInitial !== '') subjectStr += '&nbsp;' + `(${teacherInitial})`;
      } else if (studentConfig.showTeacherMode === 'full') {
        const teacherFull = entry.te?.[0]?.longname || entry.te?.[0]?.name || '';
        if (teacherFull !== '') subjectStr += '&nbsp;' + `(${teacherFull})`;
      }

      // substitution text
      if (studentConfig.showSubstitutionText && (entry.substText || '') !== '') {
        subjectStr += `<br/><span class='xsmall dimmed'>${entry.substText}</span>`;
      }

      if ((entry.lstext || '') !== '') {
        if (subjectStr.trim() !== '') subjectStr += '<br/>';
        subjectStr += `<span class='xsmall dimmed'>${entry.lstext}</span>`;
      }

      let addClass = '';
      if (entry.code == 'cancelled' || entry.code == 'error' || entry.code == 'info') {
        addClass = entry.code;
      }

      this._addTableRow(table, 'lessonRow', studentCellTitle, timeStr, subjectStr, addClass);
    }

    if (addedRows === 0) {
      this._addTableRow(table, 'lessonRowEmpty', studentCellTitle, this.translate('nothing'));
    }

    return addedRows;
  },

  /* Render the exams list for a student into the provided table */
  _renderExamsForStudent(table, studentCellTitle, studentConfig, exams) {
    let addedRows = 0;
    if (!Array.isArray(exams)) return 0;
    // current local date/time as comparable numbers (YYYYMMDD and HHMM)
    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const nowHm = now.getHours() * 100 + now.getMinutes();

    // sort exams by examDate then startTime (numeric)
    exams.sort((a, b) => (Number(a.examDate) || 0) - (Number(b.examDate) || 0) || (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

    for (let i = 0; i < exams.length; i++) {
      const exam = exams[i];
      const examYmd = Number(exam.examDate) || 0;
      const examHm = Number(exam.startTime) || 0;
      // Skip if exam has started (unless in debug mode)
      const examInPast = examYmd < nowYmd || (examYmd === nowYmd && examHm < nowHm);
      if (examInPast && this.config.logLevel !== 'debug') continue;

      addedRows++;

      // date (day.month.)
      const day = examYmd % 100;
      const month = Math.floor(examYmd / 100) % 100;
      const dateTimeCell = `${day}.${month}.&nbsp;`;

      // subject of exam
      let nameCell = exam.name;
      if (studentConfig.showExamSubject) {
        nameCell = `${exam.subject}: &nbsp;${exam.name}`;
      }

      // teacher
      if (studentConfig.showExamTeacher) {
        const teacher = Array.isArray(exam.teachers) && exam.teachers.length > 0 ? exam.teachers[0] : '';
        if (teacher) nameCell += '&nbsp;' + `(${teacher})`;
      }

      // additional text
      if (exam.text) {
        nameCell += `<br/><span class="xsmall dimmed">${exam.text}</span>`;
      }

      this._addTableRow(table, 'examRow', studentCellTitle, dateTimeCell, nameCell);
    }

    if (addedRows === 0) {
      this._addTableRow(table, 'examRowEmpty', studentCellTitle, this.translate('no_exams'));
    }

    return addedRows;
  },

  start() {
    // Normalize legacy configuration before using it anywhere
    this.config = this._normalizeLegacyConfig(this.config, this.defaults);
    this.timetableByStudent = [];
    this.examsByStudent = [];
    this.configByStudent = [];
    this.timeUnitsByStudent = [];
    this.periodNamesByStudent = [];
    // first updates every 5s, then after the first tick switch to 30s.
    if (this.config.displayMode === 'grid' && !this._nowLineTimer) {
      try {
        const initialIntervalMs = 5 * 1000; // first runs every 5s
        const laterIntervalMs = 30 * 1000; // then switch to every 30s

        const invokeNowLines = () => {
          try {
            this._updateNowLinesAll();
          } catch (e) {
            this._log('warn', 'now-line centralized update failed', e);
          }
        };

        // start the initial fast interval
        this._nowLineTimer = setInterval(invokeNowLines, initialIntervalMs);

        // schedule switching to the steady interval after one initial interval
        this._nowLineTimerSwitchTimeout = setTimeout(() => {
          try {
            if (this._nowLineTimer) clearInterval(this._nowLineTimer);
          } catch {
            // non-fatal
          }
          // start steady updater
          this._nowLineTimer = setInterval(invokeNowLines, laterIntervalMs);
        }, initialIntervalMs + 50);
      } catch (e) {
        console.error('[MMM-Webuntis] [LOGGING ERROR]', e);
      }
    }

    this.config.id = this.identifier;
    this.sendSocketNotification('FETCH_DATA', this.config);
  },

  /* Centralized updater for all now-lines rendered by the module */
  _updateNowLinesAll() {
    try {
      const inners = document.querySelectorAll('.day-column-inner');
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      inners.forEach((inner) => {
        try {
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
        } catch (e) {
          console.error('[MMM-Webuntis] [LOGGING ERROR]', e);
        }
      });
      this._log('debug', 'updated now-lines at', new Date().toISOString());
    } catch (e) {
      console.error('[MMM-Webuntis] [LOGGING ERROR]', e);
    }
  },

  getDom() {
    const wrapper = document.createElement('div');
    const table = document.createElement('table');
    table.className = 'bright small light';
    let tableHasRows = false;

    // no student
    if (this.timetableByStudent === undefined) {
      this._log('info', 'No student data available - check module configuration and that GOT_DATA was received.');
      return table;
    }

    const sortedStudentTitles = Object.keys(this.timetableByStudent).sort();

    // iterate through students
    for (const studentTitle of sortedStudentTitles) {
      const timetable = this.timetableByStudent[studentTitle] || [];
      const studentConfig = this.configByStudent[studentTitle];
      const exams = this.examsByStudent[studentTitle];
      const timeUnits = this.timeUnitsByStudent[studentTitle];
      // use precomputed startTime->name period map
      const startTimesMap = (this.periodNamesByStudent && this.periodNamesByStudent[studentTitle]) || {};

      const homeworks = this.homeworksByStudent && this.homeworksByStudent[studentTitle] ? this.homeworksByStudent[studentTitle] : [];
      if (Array.isArray(homeworks) && homeworks.length > 0) {
        // only construct sample when debug enabled to avoid extra work
        if (this.config && this.config.logLevel === 'debug') {
          const hwSample = homeworks.slice(0, 5).map((h) => ({
            id: h.id ?? h.lid ?? h.lessonId ?? null,
            su: h.su?.[0]?.name || h.su?.[0]?.longname || null,
          }));
          this._log('debug', `Homeworks for ${studentTitle}: count=${homeworks.length}, sample=`, hwSample);
        }
      }

      // use module-level helpers: this._addTableHeader / this._addTableRow
      let studentCellTitle = '';

      // only display student name as header cell if there are more than one student
      if (this.config.mode == 'verbose' && this.config.students.length > 1) {
        this._addTableHeader(table, studentTitle);
      } else {
        studentCellTitle = studentTitle;
      }

      if (this.config.displayMode === 'list') {
        const listCount = this._renderListForStudent(table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap);
        if (listCount > 0) tableHasRows = true;

        // Exams rendering (optional): render only when enabled; do not skip grid when absent
        if (Array.isArray(exams) && Number(studentConfig?.examsDaysAhead) > 0) {
          const examCount = this._renderExamsForStudent(table, studentCellTitle, studentConfig, exams);
          if (examCount > 0) tableHasRows = true;
        }
      }

      // --- Multi-day timetable grid display ---
      if (this.config.displayMode === 'grid') {
        if (timeUnits && timeUnits.length > 0 && timetable && timetable.length > 0) {
          // delegate grid rendering to a helper
          const gridElem = this._renderGridForStudent(studentTitle, studentConfig, timetable, homeworks, timeUnits);
          if (gridElem) wrapper.appendChild(gridElem);
        }
      }
    } // end for students

    if (tableHasRows) wrapper.appendChild(table);
    return wrapper;
  },

  notificationReceived(notification) {
    switch (notification) {
      case 'DOM_OBJECTS_CREATED':
        // Ensure config is normalized before scheduling fetches
        //this.config = this._normalizeLegacyConfig(this.config, this.defaults);
        this._fetchTimer = setInterval(() => {
          this.sendSocketNotification('FETCH_DATA', this.config);
        }, this.config.fetchIntervalMs);
        break;
    }
  },

  socketNotificationReceived(notification, payload) {
    if (this.identifier !== payload.id) {
      return;
    }

    if (notification === 'GOT_DATA') {
      // Transform raw payload into render-ready structures on the frontend
      const title = payload.title;
      const cfg = payload.config || {};
      this.configByStudent[title] = cfg;

      // Build timeUnits from raw timegrid
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

      // Store raw timetable; processing will be done in render functions
      // also precompute a startTime->period name map to simplify list rendering
      this.periodNamesByStudent = this.periodNamesByStudent || {};
      const periodMap = {};
      timeUnits.forEach((u) => {
        periodMap[u.startTime] = u.name;
      });
      this.periodNamesByStudent[title] = periodMap;
      this.timetableByStudent[title] = Array.isArray(payload.timetableRange) ? payload.timetableRange : [];

      // Pre-group raw timetable by date string for efficient day filtering in renderers
      this.preprocessedByStudent = this.preprocessedByStudent || {};
      const groupedRaw = {};
      (this.timetableByStudent[title] || []).forEach((el) => {
        // best-effort: skip malformed entries
        const key = el && el.date != null ? String(el.date) : null;
        if (!key) return;
        if (!groupedRaw[key]) groupedRaw[key] = [];
        groupedRaw[key].push(el);
      });
      // sort each day's entries by startTime ascending
      Object.keys(groupedRaw).forEach((k) => {
        groupedRaw[k].sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
      });
      this.preprocessedByStudent[title] = {
        ...(this.preprocessedByStudent[title] || {}),
        rawGroupedByDate: groupedRaw,
      };

      // Store raw exams; list view will compute date/time inline
      this.examsByStudent[title] = Array.isArray(payload.exams) ? payload.exams : [];

      if (!this.homeworksByStudent) this.homeworksByStudent = {};
      const hw = payload.homeworks;
      const hwNorm = Array.isArray(hw) ? hw : Array.isArray(hw?.homeworks) ? hw.homeworks : Array.isArray(hw?.homework) ? hw.homework : [];
      this.homeworksByStudent[title] = hwNorm;

      // counts for arrays after processing
      const cTimetable = this._countArray(this.timetableByStudent[title]);
      const cExams = this._countArray(this.examsByStudent[title]);
      const cTimeUnits = this._countArray(timeUnits);
      const cHomeworks = this._countArray(this.homeworksByStudent[title]);
      this._log(
        'debug',
        `data processed for ${title}: timetableEntries=${cTimetable}, exams=${cExams}, timeUnits=${cTimeUnits}, homeworks=${cHomeworks}`
      );
      this.updateDom();
    }
  },
});
