(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => {};

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

    if (!(studentConfig && studentConfig.daysToShow > 0)) return 0;

    const now = new Date();
    const nowYmd = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    const nowHm = now.getHours() * 100 + now.getMinutes();

    // Group lessons by date
    const lessonsByDate = {};
    const lessonsList = Array.isArray(timetable) ? timetable.slice() : [];
    for (const entry of lessonsList) {
      const dateYmd = Number(entry.date);
      if (!lessonsByDate[dateYmd]) lessonsByDate[dateYmd] = [];
      lessonsByDate[dateYmd].push(entry);
    }

    // Determine display window (align with grid behavior)
    const daysToShow = studentConfig.daysToShow && studentConfig.daysToShow > 0 ? parseInt(studentConfig.daysToShow) : 1;
    const pastDays = Math.max(0, parseInt(studentConfig.pastDaysToShow ?? ctx.config.pastDaysToShow ?? 0));
    const startOffset = -pastDays;
    const totalDisplayDays = daysToShow;

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
          const holidayDateStr = dayDate
            .toLocaleDateString(ctx.config.language, { weekday: 'short', day: '2-digit', month: '2-digit' })
            .toUpperCase();
          addTableRow(table, 'lessonRow holiday-notice', studentCellTitle, holidayDateStr, `🏖️ ${holiday.longName || holiday.name}`);
          addedRows++;
        }
        continue;
      }

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
          (!studentConfig.showRegularLessons && (entry.code || '') === '') ||
          (isPast && (entry.code || '') !== 'error' && ctx.config.logLevel !== 'debug')
        ) {
          continue;
        }

        addedRows++;

        let timeStr = `${timeForDay.toLocaleDateString(ctx.config.language, { weekday: 'short' }).toUpperCase()}&nbsp;`;
        if (studentConfig.showStartTime || startTimesMap[entry.startTime] === undefined) {
          const hh = String(stHour).padStart(2, '0');
          const mm = String(stMin).padStart(2, '0');
          timeStr += `${hh}:${mm}`;
        } else {
          timeStr += `${startTimesMap[entry.startTime]}.`;
        }

        const subjLong = entry.su?.[0]?.longname || entry.su?.[0]?.name || 'N/A';
        const subjShort = entry.su?.[0]?.name || entry.su?.[0]?.longname || 'N/A';
        let subjectStr = studentConfig.useShortSubject ? subjShort : subjLong;

        if (studentConfig.showTeacherMode === 'initial') {
          const teacherInitial = entry.te?.[0]?.name || entry.te?.[0]?.longname || '';
          if (teacherInitial !== '') subjectStr += '&nbsp;' + `(${teacherInitial})`;
        } else if (studentConfig.showTeacherMode === 'full') {
          const teacherFull = entry.te?.[0]?.longname || entry.te?.[0]?.name || '';
          if (teacherFull !== '') subjectStr += '&nbsp;' + `(${teacherFull})`;
        }

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

        addTableRow(table, 'lessonRow', studentCellTitle, timeStr, subjectStr, addClass);
      }
    }

    if (addedRows === 0) {
      addTableRow(table, 'lessonRowEmpty', studentCellTitle, ctx.translate('nothing'));
      return 1;
    }

    return addedRows;
  }

  root.lessons = {
    renderLessonsForStudent,
  };
})();
