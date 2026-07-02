/**
 * Lessons Plugin
 * Renders upcoming lessons for students with support for:
 * - Time-based lesson display (past/future days configurable)
 * - Holiday detection and display
 * - Cancelled/substitution/irregular lesson highlighting
 * - Configurable date formats and student group filtering
 * - Exam detection within lesson entries
 */
(function registerLessonsPlugin(globalRoot) {
  const host = globalRoot.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== 'function') {
    return;
  }

  const root = globalRoot.MMMWebuntisFrontendShared || {};
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
    getEmptyDayState,
    isIrregularStatus,
    getChangedFieldSet,
    getPrimaryFieldEntry,
    getFieldDisplayName,
    getFirstFieldName,
    normalizeComparableText,
  } = root.util?.resolveWidgetHelpers?.(root) || {};

  function getCurrentDateContext(config) {
    const runtimeUtils = globalRoot.MMModuleRuntimeUtils;
    if (runtimeUtils && typeof runtimeUtils.getCurrentDateContext === 'function') {
      return runtimeUtils.getCurrentDateContext(config || {}, {
        defaultTimezone: 'Europe/Berlin',
      });
    }

    const date = new Date();
    return {
      date,
      ymd: date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate(),
      isoDate: '',
      isDebug: false,
      timezone: 'Europe/Berlin',
    };
  }

  function translate(pluginContext, key, fallback, replacements) {
    if (typeof pluginContext?.translate !== 'function') return fallback;
    const translated = pluginContext.translate(key, fallback, replacements);
    return translated && translated !== key ? translated : fallback;
  }

  function buildHolidayMapFromRanges(holidays) {
    if (!Array.isArray(holidays) || holidays.length === 0) return {};

    const map = {};
    holidays.forEach((holiday) => {
      const startNum = Number(holiday?.startDate);
      const endNum = Number(holiday?.endDate);
      if (!Number.isFinite(startNum) || !Number.isFinite(endNum)) return;

      const startY = Math.floor(startNum / 10000);
      const startM = Math.floor((startNum % 10000) / 100) - 1;
      const startD = startNum % 100;
      const endY = Math.floor(endNum / 10000);
      const endM = Math.floor((endNum % 10000) / 100) - 1;
      const endD = endNum % 100;
      const cursor = new Date(startY, startM, startD);
      const endDate = new Date(endY, endM, endD);

      if (Number.isNaN(cursor.getTime()) || Number.isNaN(endDate.getTime())) return;

      while (cursor <= endDate) {
        const ymd = cursor.getFullYear() * 10000 + (cursor.getMonth() + 1) * 100 + cursor.getDate();
        map[ymd] = holiday;
        cursor.setDate(cursor.getDate() + 1);
      }
    });

    return map;
  }

  function buildDayNoticeMap(dayNotices) {
    if (!Array.isArray(dayNotices) || dayNotices.length === 0) return {};

    return dayNotices.reduce((map, notice) => {
      const ymd = Number(notice?.date);
      if (!Number.isFinite(ymd) || ymd <= 0) return map;
      map[ymd] = notice;
      return map;
    }, {});
  }

  function normalizeHHMMValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;

    const raw = String(value).trim();
    if (!raw) return null;

    if (/^\d{1,4}$/.test(raw)) {
      const numeric = Number.parseInt(raw, 10);
      return Number.isFinite(numeric) ? numeric : null;
    }

    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return hours * 100 + minutes;
  }

  function buildStartTimesMap(timeUnits) {
    const map = {};
    const units = Array.isArray(timeUnits) ? timeUnits : [];
    units.forEach((unit) => {
      const start = normalizeHHMMValue(unit?.startTime ?? unit?.start);
      if (start === null) return;
      const label = unit.name ?? unit.label;
      map[start] = label;
      map[String(start)] = label;
    });
    return map;
  }

  function cloneDayDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function getDayYmd(date) {
    return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  }

  function isWeekendDay(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function buildDisplayDates(baseDate, { pastDays, daysToShow, hideWeekends, lessonsByDate }) {
    const shouldIncludeDate = (date) => {
      if (!hideWeekends) return true;
      if (!isWeekendDay(date)) return true;
      const dateYmd = getDayYmd(date);
      return Array.isArray(lessonsByDate?.[dateYmd]) && lessonsByDate[dateYmd].length > 0;
    };

    const displayDates = [];
    const visiblePastDates = [];
    let pastOffset = 1;
    while (visiblePastDates.length < pastDays && pastOffset <= 366) {
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() - pastOffset);
      if (shouldIncludeDate(dayDate)) {
        visiblePastDates.push(dayDate);
      }
      pastOffset += 1;
    }

    for (const date of visiblePastDates.reverse()) {
      displayDates.push(date);
    }

    let extraFutureDays = 0;
    if (shouldIncludeDate(baseDate)) {
      displayDates.push(cloneDayDate(baseDate));
    } else {
      extraFutureDays = 1;
    }

    const futureDaysNeeded = daysToShow + extraFutureDays;
    let futureDaysAdded = 0;
    let futureOffset = 1;
    while (futureDaysAdded < futureDaysNeeded && futureOffset <= 366) {
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + futureOffset);
      if (shouldIncludeDate(dayDate)) {
        displayDates.push(dayDate);
        futureDaysAdded += 1;
      }
      futureOffset += 1;
    }

    return displayDates;
  }

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    return config;
  }

  function resolveLessonsConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.lessons?.config && typeof studentConfig.plugins.lessons.config === 'object'
        ? studentConfig.plugins.lessons.config
        : {};

    return { ...pluginConfig };
  }

  function buildEffectiveLessonsStudentConfig(studentConfig, lessonsConfig) {
    const plugins =
      studentConfig?.plugins && typeof studentConfig.plugins === 'object' && !Array.isArray(studentConfig.plugins)
        ? studentConfig.plugins
        : {};
    const lessonsPlugin = plugins?.lessons && typeof plugins.lessons === 'object' && !Array.isArray(plugins.lessons) ? plugins.lessons : {};

    return {
      ...studentConfig,
      lessons: lessonsConfig,
      plugins: {
        ...plugins,
        lessons: {
          ...lessonsPlugin,
          config: lessonsConfig,
        },
      },
    };
  }

  function buildPluginRuntimeContext(pluginContext, renderContext, studentSlice, studentConfig) {
    const studentTitle = String(studentSlice?.student?.title || '').trim();
    const holidays = Array.isArray(studentSlice?.data?.holidays?.ranges) ? studentSlice.data.holidays.ranges : [];
    const dayNotices = Array.isArray(studentSlice?.data?.dayNotices) ? studentSlice.data.dayNotices : [];
    const effectiveConfig = {
      ...studentConfig,
      logLevel: renderContext?.runtime?.logLevel || globalRoot.MMMWebuntisLogLevel || studentConfig?.logLevel || 'info',
    };
    const dateContext = getCurrentDateContext(effectiveConfig);

    return {
      config: effectiveConfig,
      holidayMapByStudent: {
        [studentTitle]: buildHolidayMapFromRanges(holidays),
      },
      dayNoticeMapByStudent: {
        [studentTitle]: buildDayNoticeMap(dayNotices),
      },
      _currentTodayYmd: dateContext.ymd,
      getCurrentDateContext(configOverride = null) {
        return getCurrentDateContext(configOverride || effectiveConfig);
      },
      _computeTodayYmdValue() {
        return this._currentTodayYmd || this.getCurrentDateContext().ymd;
      },
      translate(key, replacements) {
        return translate(pluginContext, key, key, replacements);
      },
    };
  }

  const LESSON_FIELD_MAP = Object.freeze({
    subject: 'subjects',
    teacher: 'teachers',
    room: 'rooms',
  });
  const PREVIOUS_LESSON_FIELD_MAP = Object.freeze({
    subject: 'previousSubjects',
    teacher: 'previousTeachers',
    room: 'previousRooms',
  });

  function getLessonField(entry, fieldKey) {
    const canonicalKey = LESSON_FIELD_MAP[fieldKey];
    if (!canonicalKey) return [];
    return Array.isArray(entry?.[canonicalKey]) ? entry[canonicalKey] : [];
  }

  function getPreviousLessonField(entry, fieldKey) {
    const canonicalKey = PREVIOUS_LESSON_FIELD_MAP[fieldKey];
    if (!canonicalKey) return [];
    return Array.isArray(entry?.[canonicalKey]) ? entry[canonicalKey] : [];
  }

  function getLessonText(entry) {
    return String(entry?.lessonText ?? '').trim();
  }

  function getSubstitutionText(entry) {
    return String(entry?.substitutionText ?? '');
  }

  function hasEffectiveFieldChange(entry, fieldKey) {
    const changed = getChangedFieldSet(entry);
    if (!changed.has(fieldKey)) return false;

    const currentName = getFirstFieldName(getLessonField(entry, fieldKey));
    const oldName = getFirstFieldName(getPreviousLessonField(entry, fieldKey));

    if (currentName === '' && oldName === '') return true;
    if (currentName === '' || oldName === '') return true;

    return currentName !== oldName;
  }

  function hasVisibleLessonChange(entry, teacherMode, showRoom) {
    const subjectChanged = hasEffectiveFieldChange(entry, 'subject');
    const teacherChanged = hasEffectiveFieldChange(entry, 'teacher');
    const roomChanged = hasEffectiveFieldChange(entry, 'room');

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

    return getLessonText(entry);
  }

  function renderEmptyDayRow(container, studentLabelText, dayDate, lessonsDateFormat, dayState) {
    if (!dayState) return 0;

    const dayLabel = formatDisplayDate(dayDate, lessonsDateFormat);
    const icon = dayState.inlineIconClass ? `<span class='${dayState.inlineIconClass}' aria-hidden='true'></span>` : '';
    const rowClass = dayState.rowClass ? `lessonRow ${dayState.rowClass}` : 'lessonRow';

    addRow(container, rowClass, studentLabelText, dayLabel, `${icon}${escapeHtml(dayState.label)}`);
    return 1;
  }

  /**
   * Render lessons widget for a single student
   * Displays lessons grouped by date, sorted by time, with visual indicators for:
   * - Cancelled lessons (code='cancelled' or status='CANCELLED')
   * - Substitutions (code='irregular' or status='SUBSTITUTION')
   * - Exam lessons (`displayIcons` contains `EXAM`)
   * - Empty-day notices for holidays, weekends, restrictions, and regular no-lesson days
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
    const nextDays = Math.max(0, Number.parseInt(configuredNext, 10) || 0);
    log('debug', `[LESSONS-DEBUG] ${effectiveStudentTitle}: configuredNext=${configuredNext}`);
    if (configuredNext === undefined || configuredNext === null) {
      log('debug', `[LESSONS-DEBUG] ${effectiveStudentTitle}: skipped - nextDays missing`);
      log('debug', `[lessons] skipped: nextDays missing for "${effectiveStudentTitle}"`);
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
    const nowContext = ctx.getCurrentDateContext(studentConfig || ctx.config || {});
    const nowYmd = ctx._currentTodayYmd || (typeof ctx._computeTodayYmdValue === 'function' ? ctx._computeTodayYmdValue() : nowContext.ymd);
    const nowLocal = nowContext.date;
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
    const daysToShow = nextDays;
    const pastDays = Math.max(0, parseInt(getLessonsConfig('pastDays') ?? 0, 10));
    const totalDisplayDays = pastDays + 1 + daysToShow;
    log('debug', `[lessons] window: ${totalDisplayDays} total days (${pastDays} past + today + ${daysToShow} future)`);

    // Add header after validation passes, reusing the already-created widgetCtx
    const { studentLabelText } = initializeWidgetContextAndHeader('lessons', ctx, container, studentCellTitle, studentConfig, {
      widgetCtx,
    });

    const lessonsDateFormat = getLessonsConfig('dateFormat');
    const useShortSubject = Boolean(getLessonsConfig('useShortSubject'));
    const teacherMode = getLessonsConfig('showTeacherMode');
    const hideWeekends = Boolean(getLessonsConfig('hideWeekends'));
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

    const displayDates = buildDisplayDates(baseDate, {
      pastDays,
      daysToShow,
      hideWeekends,
      lessonsByDate,
    });

    // Iterate display days in order and render lessons or holiday notices
    for (const dayDate of displayDates) {
      const dateYmd = getDayYmd(dayDate);

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
        const dayState = getEmptyDayState(ctx, effectiveStudentTitle, dayDate);
        addedRows += renderEmptyDayRow(container, studentLabelText, dayDate, lessonsDateFormat, dayState);
        continue;
      }

      log('debug', `[lessons] ${dateYmd}: ${entries.length} entries`);

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
        const subjectChanged = hasEffectiveFieldChange(entry, 'subject');
        const teacherChanged = hasEffectiveFieldChange(entry, 'teacher');
        const roomChanged = hasEffectiveFieldChange(entry, 'room');
        const visibleChangedInLessons = entry.status === 'CHANGED' ? hasVisibleLessonChange(entry, teacherMode, showRoom) : false;
        const subjects = getLessonField(entry, 'subject');
        const teachers = getLessonField(entry, 'teacher');
        const rooms = getLessonField(entry, 'room');
        const subjectEntry = getPrimaryFieldEntry(subjects);
        const teacherEntry = getPrimaryFieldEntry(teachers);
        const roomEntry = getPrimaryFieldEntry(rooms);

        const isChangedButNotVisible = entry.status === 'CHANGED' && !showRegular && !visibleChangedInLessons;
        if ((!showRegular && isRegularLesson) || (isPast && (ctx.config.logLevel ?? 'info') !== 'debug')) {
          log(
            'debug',
            `[lessons] filter: ${getFieldDisplayName(subjectEntry, 'short') || 'N/A'} ${stNum} (past=${isPast}, status=${entry.status || 'none'})`
          );
          continue;
        }

        if (isChangedButNotVisible) {
          log('debug', `[lessons] filter: hidden non-visible CHANGED lesson at ${stNum}`);
          continue;
        }

        addedRows++;
        const dateLabel = formatDisplayDate(entryDate, lessonsDateFormat);
        let timeStr = `<span class="wu-lesson__date">${escapeHtml(dateLabel)}</span>&nbsp;`;
        const hh = String(stHour).padStart(2, '0');
        const mm = String(stMin).padStart(2, '0');
        const formattedStart = `${hh}:${mm}`;
        const startNumeric = normalizeHHMMValue(entry.startTime);
        const endNumeric = normalizeHHMMValue(entry.endTime);
        const startKey = startNumeric !== null ? String(startNumeric) : '';
        const startLabel = startNumeric !== null ? (startTimesMap?.[startNumeric] ?? startTimesMap?.[startKey]) : undefined;

        let endPeriodLabel = startLabel;
        if (startLabel && startNumeric !== null && endNumeric !== null) {
          const sortedStarts = Object.keys(startTimesMap)
            .map(Number)
            .filter(Number.isFinite)
            .filter((t) => t > startNumeric && t < endNumeric)
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
        const hasSubject = Boolean(subjectEntry);
        const subjLong = getFieldDisplayName(subjectEntry, 'long') || fallbackLong || 'N/A';
        const subjShort = getFieldDisplayName(subjectEntry, 'short') || fallbackShort || fallbackLong || 'N/A';
        const subjectLabel = useShortSubject ? subjShort : subjLong;
        log('debug', `[lessons] Adding lesson: ${subjLong} at ${stNum}`);
        let subjectStr = `<span class="wu-lesson__subject">${escapeHtml(subjectLabel)}</span>`;
        if (subjectChanged && !hasSubject) {
          subjectStr = `<span class='lesson-changed-new'>${escapeHtml(subjectLabel || naText)}</span>`;
        } else if (subjectChanged) {
          subjectStr = `<span class='lesson-changed-new'>${subjectStr}</span>`;
        }

        if (teacherMode === 'initial') {
          const teacherInitial = getFieldDisplayName(teacherEntry, 'short');
          if (teacherInitial !== '') {
            const teacherText = `(${escapeHtml(teacherInitial)})`;
            if (teacherChanged) {
              subjectStr += `&nbsp;<span class="lesson-changed-new">${teacherText}</span>`;
            } else {
              subjectStr += `&nbsp;<span class="teacher-name">${teacherText}</span>`;
            }
          } else if (teacherChanged) {
            subjectStr += `&nbsp;<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
          }
        } else if (teacherMode === 'full') {
          const teacherFull = getFieldDisplayName(teacherEntry, 'long');
          if (teacherFull !== '') {
            const teacherText = `(${escapeHtml(teacherFull)})`;
            if (teacherChanged) {
              subjectStr += `&nbsp;<span class="lesson-changed-new">${teacherText}</span>`;
            } else {
              subjectStr += `&nbsp;<span class="teacher-name">${teacherText}</span>`;
            }
          } else if (teacherChanged) {
            subjectStr += `&nbsp;<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
          }
        }

        if (showRoom) {
          const roomName = getFieldDisplayName(roomEntry, 'short');
          if (roomName !== '') {
            const roomText = `(${escapeHtml(roomName)})`;
            if (roomChanged) {
              subjectStr += `&nbsp;<span class="lesson-changed-new">${roomText}</span>`;
            } else {
              subjectStr += `&nbsp;<span class="lesson-room-name">${roomText}</span>`;
            }
          } else if (roomChanged) {
            subjectStr += `&nbsp;<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
          }
        }

        if (entry.status === 'CHANGED' && changedFields.size === 0 && fallbackLong === '') {
          subjectStr += `&nbsp;<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
        }

        const substitutionText = getSubstitutionText(entry);
        if (showSubstitution && substitutionText !== '') {
          subjectStr += `<br/><span class='lesson-substitution-text'>${escapeHtml(substitutionText)}</span>`;
        }

        const lessonText = getLessonText(entry);
        const normalizedLessonText = normalizeComparableText(lessonText);
        const shouldShowLessonText =
          normalizedLessonText !== '' &&
          normalizedLessonText !== normalizeComparableText(subjectLabel) &&
          normalizedLessonText !== normalizeComparableText(subjLong) &&
          normalizedLessonText !== normalizeComparableText(subjShort);

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
    }

    if (addedRows === 0) {
      log('debug', `[lessons] no entries to display`);
      addRow(container, 'lessonRowEmpty', studentLabelText, ctx.translate('nothing'));
      return 1;
    }

    log('debug', `[lessons] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  host.registerFrontendPlugin({
    id: 'lessons',
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = document.createElement('section');
          wrapper.className = 'wu-plugin wu-plugin-lessons';
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          let renderedContainers = 0;

          for (const studentSlice of students) {
            const studentConfig = resolveStudentConfig(studentSlice);
            const lessonsConfig = resolveLessonsConfig(studentConfig);
            const effectiveStudentConfig = buildEffectiveLessonsStudentConfig(studentConfig, lessonsConfig);
            const studentTitle = String(studentSlice?.student?.title || '').trim();
            const container = document.createElement('div');
            container.className = 'wu-widget-container bright small light';
            const startTimesMap = buildStartTimesMap(studentSlice?.data?.timeUnits);
            const holidays = Array.isArray(studentSlice?.data?.holidays?.ranges) ? studentSlice.data.holidays.ranges : [];
            const pluginRuntimeContext = buildPluginRuntimeContext(pluginContext, renderContext, studentSlice, effectiveStudentConfig);
            const count = renderLessonsForStudent(
              pluginRuntimeContext,
              container,
              studentTitle,
              studentTitle,
              effectiveStudentConfig,
              Array.isArray(studentSlice?.data?.lessons) ? studentSlice.data.lessons : [],
              startTimesMap,
              holidays
            );

            if (count > 0) {
              wrapper.appendChild(container);
              renderedContainers += 1;
            }
          }

          return renderedContainers > 0 ? wrapper : null;
        },
      };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
