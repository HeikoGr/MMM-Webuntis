/**
 * Lessons Widget
 * Renders upcoming lessons for students with support for:
 * - Time-based lesson display (past/future days configurable)
 * - Holiday detection and display
 * - Cancelled/substitution/irregular lesson highlighting
 * - Configurable date formats and student group filtering
 * - Exam detection within lesson entries
 */
(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const { log, escapeHtml, addRow, addHeader, formatDate, createWidgetContext } = root.util?.initWidget?.(root) || {};

  /**
   * Check if a lesson or status represents an "irregular" lesson (substitution/replacement/additional).
   *
   * @param {Object|string} lessonOrStatus - Lesson object (with status/activityType) or REST API status code string.
   * @returns {boolean} True if the lesson is considered irregular.
   *
   * Irregular indicators:
   * - Status: 'ADDITIONAL', 'CHANGED', 'SUBSTITUTION', 'SUBSTITUTE'
   * - Activity type: 'ADDITIONAL_PERIOD', 'CHANGED_PERIOD', 'SUBSTITUTION_PERIOD'
   */

  function isIrregularStatus(lessonOrStatus) {
    // Accept either a lesson object or just the status string
    if (typeof lessonOrStatus === 'string') {
      const upperStatus = String(lessonOrStatus || '').toUpperCase();
      return ['ADDITIONAL', 'CHANGED', 'SUBSTITUTION', 'SUBSTITUTE'].includes(upperStatus);
    }

    // Lesson object passed instead of status string
    if (lessonOrStatus && typeof lessonOrStatus === 'object') {
      const status = String(lessonOrStatus.status || '').toUpperCase();
      const activityType = String(lessonOrStatus.activityType || '').toUpperCase();

      // Check status field
      if (['ADDITIONAL', 'CHANGED', 'SUBSTITUTION', 'SUBSTITUTE'].includes(status)) {
        return true;
      }

      // Fallback: check if activityType indicates an irregular lesson
      if (['ADDITIONAL_PERIOD', 'CHANGED_PERIOD', 'SUBSTITUTION_PERIOD'].includes(activityType)) {
        return true;
      }

      return false;
    }

    return false;
  }
  /**
   * Render lessons widget for a single student
   * Displays lessons grouped by date, sorted by time, with visual indicators for:
   * - Cancelled lessons (code='cancelled' or status='CANCELLED')
   * - Substitutions (code='irregular' or status='SUBSTITUTION')
   * - Exam lessons (type='EXAM' or lstext contains exam keywords)
   * - Holiday notices when no lessons
   *
   * @param {Object} ctx - Main module context (provides translate, config, debug support)
   * @param {HTMLElement} container - DOM element to append lesson rows
   * @param {string} studentCellTitle - Student name for compact mode student column
   * @param {string} studentTitle - Student name used for logging/debug
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Array} timetable - Array of lesson objects from backend
   * @param {Object} startTimesMap - Map of startTime → lesson number (e.g., 830 → "1")
   * @param {Array} holidays - Array of holiday objects (name, longName, date)
   * @returns {number} Number of rows added to container (0 = widget disabled)
   */
  function renderLessonsForStudent(ctx, container, studentCellTitle, studentTitle, studentConfig, timetable, startTimesMap, holidays) {
    log('debug', `[LESSONS-DEBUG] renderLessonsForStudent called for ${studentTitle}`);
    let addedRows = 0;

    const widgetCtx = createWidgetContext('lessons', studentConfig, root.util || {}, ctx);

    const getLessonsConfig = (key, optionsOrFallback) => widgetCtx.getConfig(key, optionsOrFallback);

    const configuredNext = getLessonsConfig('nextDays');
    log('debug', `[LESSONS-DEBUG] ${studentTitle}: configuredNext=${configuredNext}`);
    if (!configuredNext || Number(configuredNext) <= 0) {
      log('debug', `[LESSONS-DEBUG] ${studentTitle}: skipped - nextDays not configured`);
      log('debug', `[lessons] skipped: nextDays not configured for "${studentTitle}"`);
      return 0;
    }

    const timetableLength = Array.isArray(timetable) ? timetable.length : 0;
    const holidaysLength = Array.isArray(holidays) ? holidays.length : 0;
    const holidayMapLength = ctx.holidayMapByStudent?.[studentTitle] ? Object.keys(ctx.holidayMapByStudent[studentTitle]).length : 0;
    log(
      'debug',
      `[LESSONS-DEBUG] ${studentTitle}: timetable=${timetableLength}, holidays=${holidaysLength}, holidayMap=${holidayMapLength}`
    );
    log(
      ctx,
      'debug',
      `[lessons] render start | student: "${studentTitle}" | entries: ${timetableLength} | holidays: ${holidaysLength} | holidayMap: ${holidayMapLength}`
    );

    // Use module's computed today value when available (supports debugDate), else local now
    const nowYmd = ctx._currentTodayYmd || (typeof ctx._computeTodayYmdValue === 'function' ? ctx._computeTodayYmdValue() : null);
    const nowLocal = new Date();
    const nowHm = nowLocal.getHours() * 100 + nowLocal.getMinutes();
    log('debug', `[lessons] Now: ${nowYmd} ${nowHm}, holidays: ${Array.isArray(holidays) ? holidays.length : 0}`);

    // Group lessons by date for efficient day-by-day rendering
    const lessonsByDate = {};
    const lessonsList = Array.isArray(timetable) ? timetable.slice() : [];
    for (const entry of lessonsList) {
      const dateYmd = Number(entry.date);
      if (!lessonsByDate[dateYmd]) lessonsByDate[dateYmd] = [];
      lessonsByDate[dateYmd].push(entry);
    }
    const dateCount = Object.keys(lessonsByDate).length;
    log('debug', `[lessons] grouped ${lessonsList.length} entries into ${dateCount} unique dates`);

    // Determine display window (aligns with grid behavior: past + today + future)
    const daysToShow = Math.max(1, parseInt(configuredNext, 10));
    const pastDays = Math.max(0, parseInt(getLessonsConfig('pastDays') ?? 0, 10));
    const startOffset = -pastDays;
    const totalDisplayDays = pastDays + 1 + daysToShow;
    log('debug', `[lessons] window: ${totalDisplayDays} total days (${pastDays} past + today + ${daysToShow} future)`);

    const studentCell = widgetCtx.isVerbose ? '' : studentCellTitle;
    if (widgetCtx.isVerbose && studentCellTitle !== '') addHeader(container, studentCellTitle);

    const lessonsDateFormat = getLessonsConfig('dateFormat');
    const useShortSubject = Boolean(getLessonsConfig('useShortSubject'));
    const teacherMode = getLessonsConfig('showTeacherMode');
    const showSubstitution = Boolean(getLessonsConfig('showSubstitution'));
    const showRegular = Boolean(getLessonsConfig('showRegular'));
    const showStartTime = Boolean(getLessonsConfig('showStartTime'));

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

    // Iterate display days in order and render lessons or holiday notices
    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const y = dayDate.getFullYear();
      const m = ('0' + (dayDate.getMonth() + 1)).slice(-2);
      const dd = ('0' + dayDate.getDate()).slice(-2);
      const dateYmd = Number(`${y}${m}${dd}`);

      const entries = (lessonsByDate[dateYmd] || []).slice().sort((a, b) => {
        const aTime = Number(a.startTime) || 0;
        const bTime = Number(b.startTime) || 0;
        if (aTime !== bTime) return aTime - bTime;
        const aCancelled = a.status === 'CANCELLED';
        const bCancelled = b.status === 'CANCELLED';
        if (aCancelled && !bCancelled) return -1;
        if (!aCancelled && bCancelled) return 1;
        return 0;
      });

      if (!entries || entries.length === 0) {
        const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[dateYmd] || null;
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday "${holiday.name}"`);
          const holidayDateStr = formatDate(dayDate, lessonsDateFormat);
          addRow(container, 'lessonRow holiday-notice', studentCell, holidayDateStr, `🏖️ ${escapeHtml(holiday.longName || holiday.name)}`);
          addedRows++;
        }
        continue;
      }

      log('debug', `[lessons] ${dateYmd}: ${entries.length} entries`);

      let renderedForDate = 0;
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
        const isRegularLesson = !isIrregularStatus(entry) && entry.status !== 'CANCELLED';
        if ((!showRegular && isRegularLesson) || (isPast && entry.status !== 'CANCELLED' && (ctx.config.logLevel ?? 'info') !== 'debug')) {
          log('debug', `[lessons] filter: ${entry.su?.[0]?.name || 'N/A'} ${stNum} (past=${isPast}, status=${entry.status || 'none'})`);
          continue;
        }

        addedRows++;
        renderedForDate++;

        const dateLabel = formatDate(timeForDay, lessonsDateFormat);
        let timeStr = `${dateLabel}&nbsp;`;
        const hh = String(stHour).padStart(2, '0');
        const mm = String(stMin).padStart(2, '0');
        const formattedStart = `${hh}:${mm}`;
        const startKey = entry.startTime !== undefined && entry.startTime !== null ? String(entry.startTime) : '';
        const startLabel = startTimesMap?.[entry.startTime] ?? startTimesMap?.[startKey];

        let endPeriodLabel = startLabel;
        if (startLabel && entry.endTime) {
          const sortedStarts = Object.keys(startTimesMap)
            .map(Number)
            .filter((t) => t > entry.startTime && t < entry.endTime)
            .sort((a, b) => b - a);

          if (sortedStarts.length > 0) {
            const lastStart = sortedStarts[0];
            endPeriodLabel = startTimesMap[lastStart];
          }
        }

        if (showStartTime) {
          timeStr += formattedStart;
        } else if (startLabel !== undefined) {
          if (endPeriodLabel !== undefined && endPeriodLabel !== startLabel) {
            timeStr += `${startLabel}.-${endPeriodLabel}.`;
          } else {
            timeStr += `${startLabel}.`;
          }
        } else {
          timeStr += formattedStart;
        }

        const subjLong = entry.su?.[0]?.longname || entry.su?.[0]?.name || 'N/A';
        const subjShort = entry.su?.[0]?.name || entry.su?.[0]?.longname || 'N/A';
        log('debug', `[lessons] Adding lesson: ${subjLong} at ${stNum}`);
        let subjectStr = escapeHtml(useShortSubject ? subjShort : subjLong);

        if (teacherMode === 'initial') {
          const teacherInitial = entry.te?.[0]?.name || entry.te?.[0]?.longname || '';
          if (teacherInitial !== '') subjectStr += '&nbsp;' + `<span class="teacher-name">(${escapeHtml(teacherInitial)})</span>`;
        } else if (teacherMode === 'full') {
          const teacherFull = entry.te?.[0]?.longname || entry.te?.[0]?.name || '';
          if (teacherFull !== '') subjectStr += '&nbsp;' + `<span class="teacher-name">(${escapeHtml(teacherFull)})</span>`;
        }

        if (showSubstitution && (entry.substText || '') !== '') {
          subjectStr += `<br/><span class='lesson-substitution-text'>${escapeHtml(entry.substText)}</span>`;
        }

        if ((entry.lstext || '') !== '') {
          if (subjectStr.trim() !== '') subjectStr += '<br/>';
          subjectStr += `<span class='lesson-info-text'>${escapeHtml(entry.lstext)}</span>`;
        }

        let addClass = '';
        if (entry.activityType && String(entry.activityType).toUpperCase() === 'EXAM') {
          addClass = 'exam';
        } else {
          const entryText = String(entry.lstext || '').toLowerCase();
          if (entryText.includes('klassenarbeit') || entryText.includes('klausur') || entryText.includes('arbeit')) {
            addClass = 'exam';
          } else if (entry.status === 'CANCELLED') {
            addClass = 'cancelled';
          } else if (isIrregularStatus(entry) || (entry.substText && entry.substText.trim() !== '')) {
            addClass = 'substitution';
          }
        }

        addRow(container, 'lessonRow', studentCell, timeStr, subjectStr, addClass);
      }

      if (renderedForDate === 0) {
        const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[dateYmd] || null;
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday (after filters) "${holiday.name}"`);
          const holidayDateStr = formatDate(dayDate, lessonsDateFormat);
          addRow(container, 'lessonRow holiday-notice', studentCell, holidayDateStr, `🏖️ ${escapeHtml(holiday.longName || holiday.name)}`);
          addedRows++;
        }
      }
    }

    if (addedRows === 0) {
      log('debug', `[lessons] no entries to display`);
      addRow(container, 'lessonRowEmpty', studentCell, ctx.translate('nothing'));
      return 1;
    }

    log('debug', `[lessons] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.lessons = {
    renderLessonsForStudent,
  };
})();
