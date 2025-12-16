(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const dom = root.dom || {};
  const addTableRow = typeof dom.addTableRow === 'function' ? dom.addTableRow : () => { };

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

    // Group lessons by date to detect holidays
    const lessonsByDate = {};
    const allDates = new Set();

    const lessonsSorted = (Array.isArray(timetable) ? timetable : []).slice().sort((a, b) => {
      const da = Number(a.date) || 0;
      const db = Number(b.date) || 0;
      return da - db || (Number(a.startTime) || 0) - (Number(b.startTime) || 0);
    });

    // Collect all dates and group lessons
    for (const entry of lessonsSorted) {
      const dateYmd = Number(entry.date);
      allDates.add(dateYmd);
      if (!lessonsByDate[dateYmd]) lessonsByDate[dateYmd] = [];
      lessonsByDate[dateYmd].push(entry);
    }

    // Check for holidays on days without lessons
    const sortedDates = Array.from(allDates).sort((a, b) => a - b);
    let lastProcessedDate = null;

    for (let i = 0; i < lessonsSorted.length; i++) {
      const entry = lessonsSorted[i];
      const dateStr = String(entry.date);
      const dateYmd = Number(entry.date);
      const year = parseInt(dateStr.substring(0, 4), 10);
      const month = parseInt(dateStr.substring(4, 6), 10);
      const day = parseInt(dateStr.substring(6, 8), 10);
      const stNum = Number(entry.startTime) || 0;
      const stHour = Math.floor(stNum / 100);
      const stMin = stNum % 100;
      const timeForDay = new Date(year, month - 1, day);

      // Check if we need to show a holiday notice before this lesson
      if (lastProcessedDate !== dateYmd) {
        const holiday = isDateInHoliday(dateYmd, holidays);
        if (holiday && (lessonsByDate[dateYmd] || []).length === 0) {
          // No lessons on this day, but it's a holiday - show it
          const holidayDateStr = timeForDay.toLocaleDateString(ctx.config.language, { weekday: 'short', day: '2-digit', month: '2-digit' }).toUpperCase();
          addTableRow(
            table,
            'lessonRow holiday-notice',
            studentCellTitle,
            holidayDateStr,
            `🏖️ ${holiday.longName || holiday.name}`
          );
          addedRows++;
        }
        lastProcessedDate = dateYmd;
      }

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
