(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => { };
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { };
  const addTableHeader = typeof dom.addTableHeader === 'function' ? dom.addTableHeader : () => { };

  function renderLessonsForStudent(ctx, table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap, holidays) {
    let addedRows = 0;

    // Read widget-specific config (defaults already applied by MMM-Webuntis.js)
    const configuredNext = util.getWidgetConfig(studentConfig, 'lessons', 'nextDays');
    if (!configuredNext || Number(configuredNext) <= 0) {
      log('debug', `[lessons] skipped: nextDays not configured for "${studentTitle}"`);
      return 0;
    }

    const timetableLength = Array.isArray(timetable) ? timetable.length : 0;
    const holidaysLength = Array.isArray(holidays) ? holidays.length : 0;
    log(
      ctx,
      'debug',
      `[lessons] render start | student: "${studentTitle}" | entries: ${timetableLength} | holidays: ${holidaysLength} | days: ${studentConfig.daysToShow}`
    );

    // Use module's computed today value when available (supports debugDate), else local now
    const nowYmd = ctx._currentTodayYmd || (typeof ctx._computeTodayYmdValue === 'function' ? ctx._computeTodayYmdValue() : null);
    const nowLocal = new Date();
    const nowHm = nowLocal.getHours() * 100 + nowLocal.getMinutes();

    log('debug', `[lessons] Now: ${nowYmd} ${nowHm}, holidays: ${Array.isArray(holidays) ? holidays.length : 0}`);

    // Group lessons by date
    const lessonsByDate = {};
    const lessonsList = Array.isArray(timetable) ? timetable.slice() : [];
    for (const entry of lessonsList) {
      const dateYmd = Number(entry.date);
      if (!lessonsByDate[dateYmd]) lessonsByDate[dateYmd] = [];
      lessonsByDate[dateYmd].push(entry);
    }

    const dateCount = Object.keys(lessonsByDate).length;
    log('debug', `[lessons] grouped ${lessonsList.length} entries into ${dateCount} unique dates`);

    // Determine display window (align with grid behavior)
    const daysToShow = Number(configuredNext) > 0 ? Math.max(1, parseInt(configuredNext, 10)) : 1;
    const pastDays = Math.max(0, parseInt(util.getWidgetConfig(studentConfig, 'lessons', 'pastDays') ?? 0, 10));
    const startOffset = -pastDays;
    // totalDisplayDays = past + today + future
    // Example: pastDays=1, daysToShow=7 → 1 + 1 + 7 = 9 days
    const totalDisplayDays = pastDays + 1 + daysToShow;

    log('debug', `[lessons] window: ${totalDisplayDays} total days (${pastDays} past + today + ${daysToShow} future)`);

    // Determine mode (student-config has priority)
    const mode = studentConfig?.mode ?? 'compact';
    const studentCell = mode === 'verbose' ? '' : studentCellTitle;
    if (mode === 'verbose') addTableHeader(table, studentCellTitle);

    // Determine lessons date format
    const lessonsDateFormat = util.getWidgetConfig(studentConfig, 'lessons', 'dateFormat') ?? 'EEE';

    // Determine base date (supports debugDate via ctx._currentTodayYmd)
    let baseDate;
    if (ctx._currentTodayYmd) {
      const s = String(ctx._currentTodayYmd);
      const by = parseInt(s.substring(0, 4), 10);
      const bm = parseInt(s.substring(4, 6), 10) - 1;
      const bd = parseInt(s.substring(6, 8), 10);
      baseDate = new Date(by, bm, bd);
    } else {
      baseDate = new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate());
    }

    // Iterate display days in order and render either lessons or holiday notices
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const y = dayDate.getFullYear();
      const m = ('0' + (dayDate.getMonth() + 1)).slice(-2);
      const dd = ('0' + dayDate.getDate()).slice(-2);
      const dateYmd = Number(`${y}${m}${dd}`);

      const entries = (lessonsByDate[dateYmd] || []).slice().sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

      if (!entries || entries.length === 0) {
        // No lessons that day — check for holiday
        const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[dateYmd] || null;
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday "${holiday.name}"`);
          const holidayDateStr = util.formatDate(dayDate, lessonsDateFormat);
          addTableRow(table, 'lessonRow holiday-notice', studentCell, holidayDateStr, `🏖️ ${escapeHtml(holiday.longName || holiday.name)}`);
          addedRows++;
        }
        continue;
      }

      log('debug', `[lessons] ${dateYmd}: ${entries.length} entries`);

      let renderedForDate = 0;

      // Render lessons for this date
      for (const entry of entries) {
        const dateStr = String(entry.date);
        const year = parseInt(dateStr.substring(0, 4), 10);
        const month = parseInt(dateStr.substring(4, 6), 10);
        const day = parseInt(dateStr.substring(6, 8), 10);
        const stNum = Number(entry.startTime) || 0;
        const stHour = Math.floor(stNum / 100);
        const stMin = stNum % 100;
        const timeForDay = new Date(year, month - 1, day);

        const isPast = Number(entry.date) < nowYmd || (Number(entry.date) === nowYmd && stNum < nowHm);
        if (
          (!(util.getWidgetConfig(studentConfig, 'lessons', 'showRegular') ?? true) && (entry.code || '') === '') ||
          (isPast && (entry.code || '') !== 'error' && (studentConfig.logLevel ?? 'info') !== 'debug')
        ) {
          log('debug', `[lessons] filter: ${entry.su?.[0]?.name || 'N/A'} ${stNum} (past=${isPast}, code=${entry.code || 'none'})`);
          continue;
        }

        addedRows++;
        renderedForDate++;

        // Use only the lessons-specific date format as requested by configuration
        const dateLabel = util.formatDate(timeForDay, lessonsDateFormat);
        let timeStr = `${dateLabel}&nbsp;`;
        const hh = String(stHour).padStart(2, '0');
        const mm = String(stMin).padStart(2, '0');
        const formattedStart = `${hh}:${mm}`;
        const startKey = entry.startTime !== undefined && entry.startTime !== null ? String(entry.startTime) : '';
        const startLabel = startTimesMap?.[entry.startTime] ?? startTimesMap?.[startKey];
        if (util.getWidgetConfig(studentConfig, 'lessons', 'showStartTime')) {
          timeStr += formattedStart;
        } else if (startLabel !== undefined) {
          timeStr += `${startLabel}.`;
        } else {
          timeStr += formattedStart;
        }

        const subjLong = entry.su?.[0]?.longname || entry.su?.[0]?.name || 'N/A';
        const subjShort = entry.su?.[0]?.name || entry.su?.[0]?.longname || 'N/A';
        log('debug', `[lessons] Adding lesson: ${subjLong} at ${stNum}`);
        let subjectStr = escapeHtml((studentConfig.useShortSubject ?? ctx.config.useShortSubject) ? subjShort : subjLong);

        const teacherMode = studentConfig.showTeacherMode ?? ctx.config.showTeacherMode;
        if (teacherMode === 'initial') {
          const teacherInitial = entry.te?.[0]?.name || entry.te?.[0]?.longname || '';
          if (teacherInitial !== '') subjectStr += '&nbsp;' + `(${escapeHtml(teacherInitial)})`;
        } else if (teacherMode === 'full') {
          const teacherFull = entry.te?.[0]?.longname || entry.te?.[0]?.name || '';
          if (teacherFull !== '') subjectStr += '&nbsp;' + `(${escapeHtml(teacherFull)})`;
        }

        if ((studentConfig.lessons?.showSubstitution ?? studentConfig?.showSubstitution ?? false) && (entry.substText || '') !== '') {
          subjectStr += `<br/><span class='xsmall dimmed'>${escapeHtml(entry.substText)}</span>`;
        }

        if ((entry.lstext || '') !== '') {
          if (subjectStr.trim() !== '') subjectStr += '<br/>';
          subjectStr += `<span class='xsmall dimmed'>${escapeHtml(entry.lstext)}</span>`;
        }

        let addClass = '';
        // Check for exam type: REST API type field ("EXAM" uppercase) or text-based fallback (lstext keywords)
        if (entry.type && String(entry.type).toUpperCase() === 'EXAM') {
          addClass = 'exam';
        } else {
          const entryText = String(entry.lstext || '').toLowerCase();
          if (entryText.includes('klassenarbeit') || entryText.includes('klausur') || entryText.includes('arbeit')) {
            addClass = 'exam';
          } else if (entry.code === 'cancelled') {
            addClass = 'cancelled';
          } else if (entry.code === 'irregular') {
            addClass = 'substitution';
          } else if (entry.code === 'error' || entry.code === 'info') {
            addClass = entry.code;
          } else if (entry.status === 'CANCELLED') {
            addClass = 'cancelled';
          } else if (entry.status === 'SUBSTITUTION' || (entry.substText && entry.substText.trim() !== '')) {
            addClass = 'substitution';
          }
        }

        addTableRow(table, 'lessonRow', studentCell, timeStr, subjectStr, addClass);
      }

      // If no rows rendered for this date (all filtered), still show holiday notice if applicable
      if (renderedForDate === 0) {
        const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[dateYmd] || null;
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday (after filters) "${holiday.name}"`);
          const holidayDateStr = util.formatDate(dayDate, lessonsDateFormat);
          addTableRow(table, 'lessonRow holiday-notice', studentCell, holidayDateStr, `🏖️ ${escapeHtml(holiday.longName || holiday.name)}`);
          addedRows++;
        }
      }
    }

    if (addedRows === 0) {
      log('debug', `[lessons] no entries to display`);
      addTableRow(table, 'lessonRowEmpty', studentCell, ctx.translate('nothing'));
      return 1;
    }

    log('debug', `[lessons] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.lessons = {
    renderLessonsForStudent,
  };
})();
