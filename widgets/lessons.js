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
  const LESSON_ACTIVITY_TYPE = Object.freeze({
    EXAM: 'EXAM',
  });
  const {
    log,
    escapeHtml,
    addRow,
    initializeWidgetContextAndHeader,
    formatDisplayDate,
    currentTimeAsHHMM,
    createWidgetContext,
    isIrregularStatus,
    getChangedFieldSet,
    getFirstFieldName,
  } = root.util?.resolveWidgetHelpers?.(root) || {};

  function hasEffectiveFieldChange(entry, fieldKey) {
    const changed = getChangedFieldSet(entry);
    if (!changed.has(fieldKey)) return false;

    const currentMap = {
      su: entry?.su,
      te: entry?.te,
      ro: entry?.ro,
    };

    const oldMap = {
      su: entry?.suOld,
      te: entry?.teOld,
      ro: entry?.roOld,
    };

    const currentName = getFirstFieldName(currentMap[fieldKey]);
    const oldName = getFirstFieldName(oldMap[fieldKey]);

    if (currentName === '' && oldName === '') return true;
    if (currentName === '' || oldName === '') return true;

    return currentName !== oldName;
  }

  function hasVisibleLessonChange(entry, teacherMode, showRoom) {
    const subjectChanged = hasEffectiveFieldChange(entry, 'su');
    const teacherChanged = hasEffectiveFieldChange(entry, 'te');
    const roomChanged = hasEffectiveFieldChange(entry, 'ro');

    if (subjectChanged) return true;
    if (teacherChanged && (teacherMode === 'initial' || teacherMode === 'full')) return true;
    if (roomChanged && showRoom) return true;
    if (getLessonDisplayFallback(entry, 'long') !== '') return true;

    return false;
  }

  function getLessonDisplayFallback(entry, format = 'long') {
    const infoEntry = Array.isArray(entry?.info) && entry.info.length > 0 ? entry.info[0] || {} : null;
    const infoLabel = infoEntry
      ? String(format === 'short' ? infoEntry.name || infoEntry.longname || '' : infoEntry.longname || infoEntry.name || '').trim()
      : '';

    if (infoLabel !== '') return infoLabel;

    return String(entry?.lstext || '').trim();
  }

  function normalizeComparableLessonText(value) {
    return String(value || '')
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }
  /**
   * Render lessons widget for a single student
   * Displays lessons grouped by date, sorted by time, with visual indicators for:
   * - Cancelled lessons (code='cancelled' or status='CANCELLED')
   * - Substitutions (code='irregular' or status='SUBSTITUTION')
   * - Exam lessons (`displayIcons` contains `EXAM`)
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
    const effectiveStudentTitle = String(studentTitle || studentConfig?.title || studentCellTitle || '');
    log('debug', `[LESSONS-DEBUG] renderLessonsForStudent called for ${effectiveStudentTitle}`);
    let addedRows = 0;

    const widgetCtx = createWidgetContext('lessons', studentConfig, root.util || {}, ctx);

    const getLessonsConfig = (key, optionsOrFallback) => widgetCtx.getConfig(key, optionsOrFallback);

    const configuredNext = getLessonsConfig('nextDays');
    log('debug', `[LESSONS-DEBUG] ${effectiveStudentTitle}: configuredNext=${configuredNext}`);
    if (!configuredNext || Number(configuredNext) <= 0) {
      log('debug', `[LESSONS-DEBUG] ${effectiveStudentTitle}: skipped - nextDays not configured`);
      log('debug', `[lessons] skipped: nextDays not configured for "${effectiveStudentTitle}"`);
      return 0;
    }

    const timetableLength = Array.isArray(timetable) ? timetable.length : 0;
    const holidaysLength = Array.isArray(holidays) ? holidays.length : 0;
    const holidayMapLength = ctx.holidayMapByStudent?.[effectiveStudentTitle]
      ? Object.keys(ctx.holidayMapByStudent[effectiveStudentTitle]).length
      : 0;
    log(
      'debug',
      `[LESSONS-DEBUG] ${effectiveStudentTitle}: timetable=${timetableLength}, holidays=${holidaysLength}, holidayMap=${holidayMapLength}`
    );
    log(
      ctx,
      'debug',
      `[lessons] render start | student: "${effectiveStudentTitle}" | entries: ${timetableLength} | holidays: ${holidaysLength} | holidayMap: ${holidayMapLength}`
    );

    // Use module's computed today value when available (supports debugDate), else local now
    const nowYmd = ctx._currentTodayYmd || (typeof ctx._computeTodayYmdValue === 'function' ? ctx._computeTodayYmdValue() : null);
    const nowLocal = new Date();
    const nowHm = currentTimeAsHHMM(nowLocal);
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

    // Add header after validation passes, reusing the already-created widgetCtx
    const { studentLabelText } = initializeWidgetContextAndHeader('lessons', ctx, container, studentCellTitle, studentConfig, {
      widgetCtx,
    });

    const lessonsDateFormat = getLessonsConfig('dateFormat');
    const useShortSubject = Boolean(getLessonsConfig('useShortSubject'));
    const teacherMode = getLessonsConfig('showTeacherMode');
    const showSubstitution = Boolean(getLessonsConfig('showSubstitution'));
    const showRoom = Boolean(getLessonsConfig('showRoom'));
    const showRegular = Boolean(getLessonsConfig('showRegular'));
    const showStartTime = Boolean(getLessonsConfig('showStartTime'));
    const naText = String(getLessonsConfig('naText', 'N/A'));

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
        const holiday = (ctx.holidayMapByStudent?.[effectiveStudentTitle] || {})[dateYmd] || null;
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday "${holiday.name}"`);
          const holidayDateStr = formatDisplayDate(dayDate, lessonsDateFormat);
          addRow(
            container,
            'lessonRow holiday-notice',
            studentLabelText,
            holidayDateStr,
            `<span class='lesson-inline-icon lesson-inline-icon-holiday' aria-hidden='true'></span>${escapeHtml(holiday.longName || holiday.name)}`
          );
          addedRows++;
        }
        continue;
      }

      log('debug', `[lessons] ${dateYmd}: ${entries.length} entries`);

      let renderedForDate = 0;
      for (const entry of entries) {
        const entryYmdStr = String(entry.date);
        const year = parseInt(entryYmdStr.substring(0, 4), 10);
        const month = parseInt(entryYmdStr.substring(4, 6), 10);
        const day = parseInt(entryYmdStr.substring(6, 8), 10);
        const stNum = Number(entry.startTime) || 0;
        const stHour = Math.floor(stNum / 100);
        const stMin = stNum % 100;
        const entryDate = new Date(year, month - 1, day);

        const isPast = Number(entry.date) < nowYmd || (Number(entry.date) === nowYmd && stNum < nowHm);
        const isRegularLesson = !isIrregularStatus(entry) && entry.status !== 'CANCELLED';
        const changedFields = getChangedFieldSet(entry);
        const subjectChanged = hasEffectiveFieldChange(entry, 'su');
        const teacherChanged = hasEffectiveFieldChange(entry, 'te');
        const roomChanged = hasEffectiveFieldChange(entry, 'ro');
        const visibleChangedInLessons = entry.status === 'CHANGED' ? hasVisibleLessonChange(entry, teacherMode, showRoom) : false;

        const isChangedButNotVisible = entry.status === 'CHANGED' && !showRegular && !visibleChangedInLessons;
        if ((!showRegular && isRegularLesson) || (isPast && entry.status !== 'CANCELLED' && (ctx.config.logLevel ?? 'info') !== 'debug')) {
          log('debug', `[lessons] filter: ${entry.su?.[0]?.name || 'N/A'} ${stNum} (past=${isPast}, status=${entry.status || 'none'})`);
          continue;
        }

        if (isChangedButNotVisible) {
          log('debug', `[lessons] filter: hidden non-visible CHANGED lesson at ${stNum}`);
          continue;
        }

        addedRows++;
        renderedForDate++;

        const dateLabel = formatDisplayDate(entryDate, lessonsDateFormat);
        let timeStr = `<span class="wu-lesson__date">${escapeHtml(dateLabel)}</span>&nbsp;`;
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
          timeStr += `<span class="wu-lesson__time">${formattedStart}</span>`;
        } else if (startLabel !== undefined) {
          if (endPeriodLabel !== undefined && endPeriodLabel !== startLabel) {
            timeStr += `<span class="wu-lesson__period">${startLabel}.-${endPeriodLabel}.</span>`;
          } else {
            timeStr += `<span class="wu-lesson__period">${startLabel}.</span>`;
          }
        } else {
          timeStr += `<span class="wu-lesson__time">${formattedStart}</span>`;
        }

        const fallbackLong = getLessonDisplayFallback(entry, 'long');
        const fallbackShort = getLessonDisplayFallback(entry, 'short');
        const hasSubject = Boolean(entry.su?.[0]);
        const subjLong = entry.su?.[0]?.longname || entry.su?.[0]?.name || fallbackLong || 'N/A';
        const subjShort = entry.su?.[0]?.name || entry.su?.[0]?.longname || fallbackShort || fallbackLong || 'N/A';
        const subjectLabel = useShortSubject ? subjShort : subjLong;
        log('debug', `[lessons] Adding lesson: ${subjLong} at ${stNum}`);
        let subjectStr = `<span class="wu-lesson__subject">${escapeHtml(subjectLabel)}</span>`;
        if (subjectChanged && !hasSubject) {
          subjectStr = `<span class='lesson-changed-new'>${escapeHtml(subjectLabel || naText)}</span>`;
        } else if (subjectChanged) {
          subjectStr = `<span class='lesson-changed-new'>${subjectStr}</span>`;
        }

        if (teacherMode === 'initial') {
          const teacherInitial = entry.te?.[0]?.name || entry.te?.[0]?.longname || '';
          if (teacherInitial !== '') {
            const teacherText = `(${escapeHtml(teacherInitial)})`;
            if (teacherChanged) {
              subjectStr += '&nbsp;' + `<span class="lesson-changed-new">${teacherText}</span>`;
            } else {
              subjectStr += '&nbsp;' + `<span class="teacher-name">${teacherText}</span>`;
            }
          } else if (teacherChanged) {
            subjectStr += '&nbsp;' + `<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
          }
        } else if (teacherMode === 'full') {
          const teacherFull = entry.te?.[0]?.longname || entry.te?.[0]?.name || '';
          if (teacherFull !== '') {
            const teacherText = `(${escapeHtml(teacherFull)})`;
            if (teacherChanged) {
              subjectStr += '&nbsp;' + `<span class="lesson-changed-new">${teacherText}</span>`;
            } else {
              subjectStr += '&nbsp;' + `<span class="teacher-name">${teacherText}</span>`;
            }
          } else if (teacherChanged) {
            subjectStr += '&nbsp;' + `<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
          }
        }

        if (showRoom) {
          const roomName = entry.ro?.[0]?.name || entry.ro?.[0]?.longname || '';
          if (roomName !== '') {
            const roomText = `(${escapeHtml(roomName)})`;
            if (roomChanged) {
              subjectStr += '&nbsp;' + `<span class="lesson-changed-new">${roomText}</span>`;
            } else {
              subjectStr += '&nbsp;' + `<span class="lesson-room-name">${roomText}</span>`;
            }
          } else if (roomChanged) {
            subjectStr += '&nbsp;' + `<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
          }
        }

        if (entry.status === 'CHANGED' && changedFields.size === 0 && fallbackLong === '') {
          subjectStr += '&nbsp;' + `<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
        }

        if (showSubstitution && (entry.substText || '') !== '') {
          subjectStr += `<br/><span class='lesson-substitution-text'>${escapeHtml(entry.substText)}</span>`;
        }

        const lessonText = String(entry.lstext || '').trim();
        const normalizedLessonText = normalizeComparableLessonText(lessonText);
        const shouldShowLessonText =
          normalizedLessonText !== '' &&
          normalizedLessonText !== normalizeComparableLessonText(subjectLabel) &&
          normalizedLessonText !== normalizeComparableLessonText(subjLong) &&
          normalizedLessonText !== normalizeComparableLessonText(subjShort);

        if (shouldShowLessonText) {
          if (subjectStr.trim() !== '') subjectStr += '<br/>';
          subjectStr += `<span class='lesson-info-text'>${escapeHtml(lessonText)}</span>`;
        }

        let addClass = '';
        if (
          Array.isArray(entry.displayIcons) &&
          entry.displayIcons.some((icon) => String(icon || '').toUpperCase() === LESSON_ACTIVITY_TYPE.EXAM)
        ) {
          addClass = 'exam';
        } else if (entry.status === 'CANCELLED') {
          addClass = 'cancelled';
        }

        addRow(container, 'lessonRow', studentLabelText, timeStr, subjectStr, addClass);
      }

      if (renderedForDate === 0) {
        const holiday = (ctx.holidayMapByStudent?.[effectiveStudentTitle] || {})[dateYmd] || null;
        if (holiday) {
          log('debug', `[lessons] ${dateYmd}: holiday (after filters) "${holiday.name}"`);
          const holidayDateStr = formatDisplayDate(dayDate, lessonsDateFormat);
          addRow(
            container,
            'lessonRow holiday-notice',
            studentLabelText,
            holidayDateStr,
            `<span class='lesson-inline-icon lesson-inline-icon-holiday' aria-hidden='true'></span>${escapeHtml(holiday.longName || holiday.name)}`
          );
          addedRows++;
        }
      }
    }

    if (addedRows === 0) {
      log('debug', `[lessons] no entries to display`);
      addRow(container, 'lessonRowEmpty', studentLabelText, ctx.translate('nothing'));
      return 1;
    }

    log('debug', `[lessons] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  root.lessons = {
    renderLessonsForStudent,
  };
})();
