(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const util = root.util || {};
  const log = typeof util.log === 'function' ? util.log : () => {};
  const escapeHtml = typeof util.escapeHtml === 'function' ? util.escapeHtml : (s) => String(s || '');
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => {};
  const addTableHeader = typeof dom.addTableHeader === 'function' ? dom.addTableHeader : () => {};

  // Helper: Check if a date falls within a holiday period
  function isDateInHoliday(dateYmd, holidays) {
    if (!Array.isArray(holidays) || holidays.length === 0) return null;
    const dateNum = Number(dateYmd);
    for (const holiday of holidays) {
      const start = Number(holiday.startDate);
      const end = Number(holiday.endDate);
      if (dateNum >= start && dateNum <= end) {
        return holiday;
      }
    }
    return null;
  }

  function renderLessonsForStudent(ctx, table, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap, holidays) {
    let addedRows = 0;

    if (!(studentConfig && studentConfig.daysToShow > 0)) {
      log('debug', `[lessons] skipped: daysToShow not configured for "${studentTitle}"`);
      return 0;
    }

    const timetableLength = Array.isArray(timetable) ? timetable.length : 0;
    const holidaysLength = Array.isArray(holidays) ? holidays.length : 0;
    log(
      ctx,
      'debug',
      `[lessons] render start | student: "${studentTitle}" | entries: ${timetableLength} | holidays: ${holidaysLength} | days: ${studentConfig.daysToShow}`
    );

    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const nowHm = now.getHours() * 100 + now.getMinutes();

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

    // Determine display window (align with grid behavior) - studentConfig has priority
    const daysToShow = studentConfig.daysToShow && studentConfig.daysToShow > 0 ? parseInt(studentConfig.daysToShow) : 1;
    const pastDays = Math.max(0, parseInt(studentConfig.pastDaysToShow ?? ctx.config.pastDaysToShow ?? 0));
    const startOffset = -pastDays;
    const totalDisplayDays = daysToShow;

    log('debug', `[lessons] window: ${totalDisplayDays} future days + ${pastDays} past days`);

    // Determine mode (student-config has priority)
    const mode = studentConfig?.mode ?? ctx.config?.mode ?? 'compact';
    const studentCell = mode === 'verbose' ? '' : studentCellTitle;
    if (mode === 'verbose') addTableHeader(table, studentCellTitle);

    // Iterate display days in order and render either lessons or holiday notices
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayIndex);
      const y = dayDate.getFullYear();
      const m = ('0' + (dayDate.getMonth() + 1)).slice(-2);
      const dd = ('0' + dayDate.getDate()).slice(-2);
      const dateYmd = Number(`${y}${m}${dd}`);

      const entries = (lessonsByDate[dateYmd] || []).slice().sort((a, b) => (Number(a.startTime) || 0) - (Number(b.startTime) || 0));

      if (!entries || entries.length === 0) {
        // No lessons that day — check for holiday
        const holiday = isDateInHoliday(dateYmd, holidays);
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday "${holiday.name}"`);
          const holidayDateStr = dayDate
            .toLocaleDateString(ctx.config.language, { weekday: 'short', day: '2-digit', month: '2-digit' })
            .toUpperCase();
          addTableRow(table, 'lessonRow holiday-notice', studentCell, holidayDateStr, `🏖️ ${escapeHtml(holiday.longName || holiday.name)}`);
          addedRows++;
        }
        continue;
      }

      log('debug', `[lessons] ${dateYmd}: ${entries.length} entries`);

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
          (!(studentConfig.showRegularLessons ?? ctx.config.showRegularLessons) && (entry.code || '') === '') ||
          (isPast && (entry.code || '') !== 'error' && (studentConfig.logLevel ?? ctx.config.logLevel) !== 'debug')
        ) {
          log('debug', `[lessons] filter: ${entry.su?.[0]?.name || 'N/A'} ${stNum} (past=${isPast}, code=${entry.code || 'none'})`);
          continue;
        }

        addedRows++;

        let timeStr = `${timeForDay.toLocaleDateString(ctx.config.language, { weekday: 'short' }).toUpperCase()}&nbsp;`;
        const hh = String(stHour).padStart(2, '0');
        const mm = String(stMin).padStart(2, '0');
        const formattedStart = `${hh}:${mm}`;
        const startKey = entry.startTime !== undefined && entry.startTime !== null ? String(entry.startTime) : '';
        const startLabel = startTimesMap?.[entry.startTime] ?? startTimesMap?.[startKey];
        if (studentConfig.showStartTime ?? ctx.config.showStartTime) {
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

        if ((studentConfig.showSubstitutionText ?? ctx.config.showSubstitutionText) && (entry.substText || '') !== '') {
          subjectStr += `<br/><span class='xsmall dimmed'>${escapeHtml(entry.substText)}</span>`;
        }

        if ((entry.lstext || '') !== '') {
          if (subjectStr.trim() !== '') subjectStr += '<br/>';
          subjectStr += `<span class='xsmall dimmed'>${escapeHtml(entry.lstext)}</span>`;
        }

        let addClass = '';
        if (entry.code === 'cancelled') {
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

        addTableRow(table, 'lessonRow', studentCell, timeStr, subjectStr, addClass);
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
