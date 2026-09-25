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
  if (!host || typeof host.registerFrontendPlugin !== "function") {
    return;
  }

  const root = globalRoot.MMMWebuntisFrontendShared || {};
  const LESSON_ACTIVITY_TYPE = Object.freeze({
    EXAM: "EXAM",
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
    return root.time.getCurrentDateContext(config);
  }

  function translate(pluginContext, key, fallback, replacements) {
    if (typeof pluginContext?.translate !== "function") return fallback;
    const translated = pluginContext.translate(key, fallback, replacements);
    return translated || fallback;
  }

  function buildHolidayMapFromRanges(holidays) {
    return root.util.buildHolidayMapFromRanges(holidays);
  }

  function buildDayNoticeMap(dayNotices) {
    return root.util.buildDayNoticeMap(dayNotices);
  }

  function normalizeHHMMValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;

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
    if (!config || typeof config !== "object" || Array.isArray(config)) return {};
    return config;
  }

  function resolveLessonsConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.lessons?.config && typeof studentConfig.plugins.lessons.config === "object"
        ? studentConfig.plugins.lessons.config
        : {};

    return { ...pluginConfig };
  }

  function buildEffectiveLessonsStudentConfig(studentConfig, lessonsConfig) {
    const plugins =
      studentConfig?.plugins && typeof studentConfig.plugins === "object" && !Array.isArray(studentConfig.plugins)
        ? studentConfig.plugins
        : {};
    const lessonsPlugin =
      plugins?.lessons && typeof plugins.lessons === "object" && !Array.isArray(plugins.lessons) ? plugins.lessons : {};

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
    const studentTitle = String(studentSlice?.student?.title || "").trim();
    const holidays = Array.isArray(studentSlice?.data?.holidays?.ranges) ? studentSlice.data.holidays.ranges : [];
    const dayNotices = Array.isArray(studentSlice?.data?.dayNotices) ? studentSlice.data.dayNotices : [];
    const effectiveConfig = {
      ...studentConfig,
      logLevel: renderContext?.runtime?.logLevel || globalRoot.MMMWebuntisLogLevel || studentConfig?.logLevel || "info",
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
      collectionStateByStudent: {
        [studentTitle]: studentSlice?.state?.collections || {},
      },
      _currentTodayYmd: dateContext.ymd,
      getCurrentDateContext(configOverride = null) {
        return getCurrentDateContext(configOverride || effectiveConfig);
      },
      _computeTodayYmdValue() {
        return this._currentTodayYmd || this.getCurrentDateContext().ymd;
      },
      translate(key, replacements, fallback = key) {
        return translate(pluginContext, key, fallback, replacements);
      },
    };
  }

  const LESSON_FIELD_MAP = Object.freeze({
    subject: "subjects",
    teacher: "teachers",
    room: "rooms",
  });
  const PREVIOUS_LESSON_FIELD_MAP = Object.freeze({
    subject: "previousSubjects",
    teacher: "previousTeachers",
    room: "previousRooms",
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
    return String(entry?.lessonText ?? "").trim();
  }

  function getSubstitutionText(entry) {
    return String(entry?.substitutionText ?? "");
  }

  function hasEffectiveFieldChange(entry, fieldKey) {
    const changed = getChangedFieldSet(entry);
    if (!changed.has(fieldKey)) return false;

    const currentName = getFirstFieldName(getLessonField(entry, fieldKey));
    const oldName = getFirstFieldName(getPreviousLessonField(entry, fieldKey));

    if (currentName === "" && oldName === "") return true;
    if (currentName === "" || oldName === "") return true;

    return currentName !== oldName;
  }

  function hasVisibleLessonChange(entry, teacherMode, showRoom) {
    const subjectChanged = hasEffectiveFieldChange(entry, "subject");
    const teacherChanged = hasEffectiveFieldChange(entry, "teacher");
    const roomChanged = hasEffectiveFieldChange(entry, "room");

    if (subjectChanged) return true;
    if (teacherChanged && (teacherMode === "initial" || teacherMode === "full")) return true;
    if (roomChanged && showRoom) return true;
    if (getLessonDisplayFallback(entry, "long") !== "") return true;

    return false;
  }

  function getLessonDisplayFallback(entry, format = "long") {
    const infoEntry = Array.isArray(entry?.info) && entry.info.length > 0 ? entry.info[0] || {} : null;
    const infoLabel = infoEntry
      ? String(
          format === "short" ? infoEntry.name || infoEntry.longname || "" : infoEntry.longname || infoEntry.name || "",
        ).trim()
      : "";

    if (infoLabel !== "") return infoLabel;

    return getLessonText(entry);
  }

  function renderEmptyDayRow(container, studentLabelText, dayDate, lessonsDateFormat, dayState) {
    if (!dayState) return 0;

    const dayLabel = formatDisplayDate(dayDate, lessonsDateFormat);
    const icon = dayState.inlineIconClass ? `<span class='${dayState.inlineIconClass}' aria-hidden='true'></span>` : "";
    const rowClass = dayState.rowClass ? `lessonRow ${dayState.rowClass}` : "lessonRow";

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
  function renderLessonsForStudent(
    ctx,
    container,
    studentCellTitle,
    studentTitle,
    studentConfig,
    timetable,
    startTimesMap,
    holidays,
  ) {
    const effectiveStudentTitle = String(studentTitle || studentConfig?.title || studentCellTitle || "");
    log("debug", `[LESSONS-DEBUG] renderLessonsForStudent called for ${effectiveStudentTitle}`);

    const widgetCtx = createWidgetContext("lessons", studentConfig, root.util || {}, ctx);
    const getLessonsConfig = (key, optionsOrFallback) => widgetCtx.getConfig(key, optionsOrFallback);

    const configuredNext = getLessonsConfig("nextDays");
    log("debug", `[LESSONS-DEBUG] ${effectiveStudentTitle}: configuredNext=${configuredNext}`);
    if (configuredNext === undefined || configuredNext === null) {
      log("debug", `[LESSONS-DEBUG] ${effectiveStudentTitle}: skipped - nextDays missing`);
      log("debug", `[lessons] skipped: nextDays missing for "${effectiveStudentTitle}"`);
      return 0;
    }
    const nextDays = Math.max(0, Number.parseInt(configuredNext, 10) || 0);

    logRenderStart(ctx, effectiveStudentTitle, timetable, holidays);

    // The module's today (it follows debugDate), else the local clock.
    const nowContext = ctx.getCurrentDateContext(studentConfig || ctx.config || {});
    const nowYmd =
      ctx._currentTodayYmd ||
      (typeof ctx._computeTodayYmdValue === "function" ? ctx._computeTodayYmdValue() : nowContext.ymd);
    const nowHm = currentTimeAsHHMM(nowContext.date);
    log("debug", `[lessons] Now: ${nowYmd} ${nowHm}, holidays: ${Array.isArray(holidays) ? holidays.length : 0}`);

    const lessonsByDate = groupLessonsByDate(timetable);

    // Display window, as in the grid: past days + today + future days.
    const pastDays = Math.max(0, parseInt(getLessonsConfig("pastDays") ?? 0, 10));
    log(
      "debug",
      `[lessons] window: ${pastDays + 1 + nextDays} total days (${pastDays} past + today + ${nextDays} future)`,
    );

    // The header goes in once the config is known to be usable.
    const { studentLabelText } = initializeWidgetContextAndHeader(
      "lessons",
      ctx,
      container,
      studentCellTitle,
      studentConfig,
      { widgetCtx },
    );

    const options = {
      dateFormat: getLessonsConfig("dateFormat"),
      useShortSubject: Boolean(getLessonsConfig("useShortSubject")),
      teacherMode: getLessonsConfig("showTeacherMode"),
      showSubstitution: Boolean(getLessonsConfig("showSubstitution")),
      showRoom: Boolean(getLessonsConfig("showRoom")),
      showRegular: Boolean(getLessonsConfig("showRegular")),
      showStartTime: Boolean(getLessonsConfig("showStartTime")),
      naText: String(getLessonsConfig("naText", "N/A")),
      keepPast: (ctx.config.logLevel ?? "info") === "debug",
      startTimesMap,
    };

    const displayDates = buildDisplayDates(resolveBaseDate(ctx, nowContext.date), {
      pastDays,
      daysToShow: nextDays,
      hideWeekends: Boolean(getLessonsConfig("hideWeekends")),
      lessonsByDate,
    });

    let addedRows = 0;
    for (const dayDate of displayDates) {
      const dateYmd = getDayYmd(dayDate);
      const entries = (lessonsByDate[dateYmd] || []).slice().sort(compareLessonsOfDay);

      if (entries.length === 0) {
        const dayState = getEmptyDayState(ctx, effectiveStudentTitle, dayDate);
        addedRows += renderEmptyDayRow(container, studentLabelText, dayDate, options.dateFormat, dayState);
        continue;
      }

      log("debug", `[lessons] ${dateYmd}: ${entries.length} entries`);
      for (const entry of entries) {
        if (isFilteredOut(entry, options, nowYmd, nowHm)) continue;
        addedRows++;
        const subject = buildSubjectCell(entry, options);
        addRow(container, "lessonRow", studentLabelText, buildTimeCell(entry, options), subject, lessonRowClass(entry));
      }
    }

    if (addedRows === 0) {
      log("debug", `[lessons] no entries to display`);
      addRow(container, "lessonRowEmpty", studentLabelText, ctx.translate("nothing"));
      return 1;
    }

    log("debug", `[lessons] render complete | rows: ${addedRows}`);
    return addedRows;
  }

  function logRenderStart(ctx, studentTitle, timetable, holidays) {
    const timetableLength = Array.isArray(timetable) ? timetable.length : 0;
    const holidaysLength = Array.isArray(holidays) ? holidays.length : 0;
    const holidayMapLength = ctx.holidayMapByStudent?.[studentTitle]
      ? Object.keys(ctx.holidayMapByStudent[studentTitle]).length
      : 0;
    log(
      "debug",
      `[LESSONS-DEBUG] ${studentTitle}: timetable=${timetableLength}, holidays=${holidaysLength}, holidayMap=${holidayMapLength}`,
    );
    log(
      ctx,
      "debug",
      `[lessons] render start | student: "${studentTitle}" | entries: ${timetableLength} | holidays: ${holidaysLength} | holidayMap: ${holidayMapLength}`,
    );
  }

  /** Timetable entries by YYYYMMDD. */
  function groupLessonsByDate(timetable) {
    const lessonsByDate = {};
    const lessonsList = Array.isArray(timetable) ? timetable.slice() : [];
    for (const entry of lessonsList) {
      const dateYmd = Number(entry.date);
      if (!lessonsByDate[dateYmd]) lessonsByDate[dateYmd] = [];
      lessonsByDate[dateYmd].push(entry);
    }
    log(
      "debug",
      `[lessons] grouped ${lessonsList.length} entries into ${Object.keys(lessonsByDate).length} unique dates`,
    );
    return lessonsByDate;
  }

  /** First displayed day: the module's today (debugDate aware), else the local date. */
  function resolveBaseDate(ctx, nowLocal) {
    if (ctx._currentTodayYmd) {
      const ymd = String(ctx._currentTodayYmd);
      return new Date(
        parseInt(ymd.substring(0, 4), 10),
        parseInt(ymd.substring(4, 6), 10) - 1,
        parseInt(ymd.substring(6, 8), 10),
      );
    }
    return new Date(nowLocal.getFullYear(), nowLocal.getMonth(), nowLocal.getDate());
  }

  /** By start time; a cancelled lesson before its replacement in the same slot. */
  function compareLessonsOfDay(a, b) {
    const aTime = Number(a.startTime) || 0;
    const bTime = Number(b.startTime) || 0;
    if (aTime !== bTime) return aTime - bTime;
    const aCancelled = a.status === "CANCELLED";
    const bCancelled = b.status === "CANCELLED";
    if (aCancelled && !bCancelled) return -1;
    if (!aCancelled && bCancelled) return 1;
    return 0;
  }

  /**
   * Lessons the list leaves out: regular ones without showRegular, past ones (except in debug
   * mode), and CHANGED ones whose change is not visible with the configured fields.
   */
  function isFilteredOut(entry, options, nowYmd, nowHm) {
    const startHm = Number(entry.startTime) || 0;
    const isPast = Number(entry.date) < nowYmd || (Number(entry.date) === nowYmd && startHm < nowHm);
    const isRegularLesson = !isIrregularStatus(entry) && entry.status !== "CANCELLED";

    if ((!options.showRegular && isRegularLesson) || (isPast && !options.keepPast)) {
      const subjectEntry = getPrimaryFieldEntry(getLessonField(entry, "subject"));
      log(
        "debug",
        `[lessons] filter: ${getFieldDisplayName(subjectEntry, "short") || "N/A"} ${startHm} (past=${isPast}, status=${entry.status || "none"})`,
      );
      return true;
    }

    const changeVisible =
      entry.status === "CHANGED" ? hasVisibleLessonChange(entry, options.teacherMode, options.showRoom) : false;
    if (entry.status === "CHANGED" && !options.showRegular && !changeVisible) {
      log("debug", `[lessons] filter: hidden non-visible CHANGED lesson at ${startHm}`);
      return true;
    }
    return false;
  }

  /**
   * Period label(s) of a lesson from the timegrid: "3." or "3.-4." for a lesson spanning several
   * periods; undefined when its start is not a period start.
   */
  function periodLabel(entry, startTimesMap) {
    const startNumeric = normalizeHHMMValue(entry.startTime);
    const endNumeric = normalizeHHMMValue(entry.endTime);
    const startLabel =
      startNumeric !== null ? (startTimesMap?.[startNumeric] ?? startTimesMap?.[String(startNumeric)]) : undefined;
    if (startLabel === undefined) return undefined;

    let endLabel = startLabel;
    if (startLabel && startNumeric !== null && endNumeric !== null) {
      // The last period that starts inside the lesson.
      const lastStart = Object.keys(startTimesMap)
        .map(Number)
        .filter(Number.isFinite)
        .filter((t) => t > startNumeric && t < endNumeric)
        .sort((a, b) => b - a)[0];
      if (lastStart !== undefined) endLabel = startTimesMap[lastStart];
    }
    return endLabel !== undefined && endLabel !== startLabel ? `${startLabel}.-${endLabel}.` : `${startLabel}.`;
  }

  /** Date plus start time, or plus the period number(s) when the timegrid knows them. */
  function buildTimeCell(entry, options) {
    const ymd = String(entry.date);
    const entryDate = new Date(
      parseInt(ymd.substring(0, 4), 10),
      parseInt(ymd.substring(4, 6), 10) - 1,
      parseInt(ymd.substring(6, 8), 10),
    );
    const startHm = Number(entry.startTime) || 0;
    const formattedStart = `${String(Math.floor(startHm / 100)).padStart(2, "0")}:${String(startHm % 100).padStart(2, "0")}`;
    const dateCell = `<span class="wu-lesson__date">${escapeHtml(formatDisplayDate(entryDate, options.dateFormat))}</span>&nbsp;`;

    const period = options.showStartTime ? undefined : periodLabel(entry, options.startTimesMap);
    return period === undefined
      ? `${dateCell}<span class="wu-lesson__time">${formattedStart}</span>`
      : `${dateCell}<span class="wu-lesson__period">${period}</span>`;
  }

  /**
   * " (value)" after the subject, highlighted when the field changed; "(N/A)" for a changed field
   * that has no value any more; nothing for an unchanged empty one.
   */
  function attachedField(value, changed, cssClass, naText) {
    if (value !== "") {
      const text = `(${escapeHtml(value)})`;
      return changed
        ? `&nbsp;<span class="lesson-changed-new">${text}</span>`
        : `&nbsp;<span class="${cssClass}">${text}</span>`;
    }
    return changed ? `&nbsp;<span class="lesson-changed-new">(${escapeHtml(naText)})</span>` : "";
  }

  /** Subject with optional teacher and room, substitution text and lesson text. */
  function buildSubjectCell(entry, options) {
    const { naText } = options;
    const subjectEntry = getPrimaryFieldEntry(getLessonField(entry, "subject"));
    const teacherEntry = getPrimaryFieldEntry(getLessonField(entry, "teacher"));
    const roomEntry = getPrimaryFieldEntry(getLessonField(entry, "room"));
    const subjectChanged = hasEffectiveFieldChange(entry, "subject");

    const fallbackLong = getLessonDisplayFallback(entry, "long");
    const fallbackShort = getLessonDisplayFallback(entry, "short");
    const subjLong = getFieldDisplayName(subjectEntry, "long") || fallbackLong || "N/A";
    const subjShort = getFieldDisplayName(subjectEntry, "short") || fallbackShort || fallbackLong || "N/A";
    const subjectLabel = options.useShortSubject ? subjShort : subjLong;
    log("debug", `[lessons] Adding lesson: ${subjLong} at ${Number(entry.startTime) || 0}`);

    let cell = `<span class="wu-lesson__subject">${escapeHtml(subjectLabel)}</span>`;
    if (subjectChanged && !subjectEntry) {
      cell = `<span class='lesson-changed-new'>${escapeHtml(subjectLabel || naText)}</span>`;
    } else if (subjectChanged) {
      cell = `<span class='lesson-changed-new'>${cell}</span>`;
    }

    if (options.teacherMode === "initial" || options.teacherMode === "full") {
      const teacher = getFieldDisplayName(teacherEntry, options.teacherMode === "initial" ? "short" : "long");
      cell += attachedField(teacher, hasEffectiveFieldChange(entry, "teacher"), "teacher-name", naText);
    }
    if (options.showRoom) {
      const room = getFieldDisplayName(roomEntry, "short");
      cell += attachedField(room, hasEffectiveFieldChange(entry, "room"), "lesson-room-name", naText);
    }
    // CHANGED without any field we could show: at least mark it.
    if (entry.status === "CHANGED" && getChangedFieldSet(entry).size === 0 && fallbackLong === "") {
      cell += `&nbsp;<span class="lesson-changed-new">(${escapeHtml(naText)})</span>`;
    }

    const substitutionText = getSubstitutionText(entry);
    if (options.showSubstitution && substitutionText !== "") {
      cell += `<br/><span class='lesson-substitution-text'>${escapeHtml(substitutionText)}</span>`;
    }

    // The lesson text, unless it only repeats the subject.
    const lessonText = getLessonText(entry);
    const normalizedLessonText = normalizeComparableText(lessonText);
    const repeatsSubject = [subjectLabel, subjLong, subjShort].some(
      (label) => normalizedLessonText === normalizeComparableText(label),
    );
    if (normalizedLessonText !== "" && !repeatsSubject) {
      if (cell.trim() !== "") cell += "<br/>";
      cell += `<span class='lesson-info-text'>${escapeHtml(lessonText)}</span>`;
    }
    return cell;
  }

  /** "exam" for an exam lesson, "cancelled" for a cancelled one. */
  function lessonRowClass(entry) {
    const isExam =
      Array.isArray(entry.displayIcons) &&
      entry.displayIcons.some((icon) => String(icon || "").toUpperCase() === LESSON_ACTIVITY_TYPE.EXAM);
    if (isExam) return "exam";
    return entry.status === "CANCELLED" ? "cancelled" : "";
  }

  host.registerFrontendPlugin({
    id: "lessons",
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const wrapper = document.createElement("section");
          wrapper.className = "wu-plugin wu-plugin-lessons";
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          let renderedContainers = 0;

          for (const studentSlice of students) {
            const studentConfig = resolveStudentConfig(studentSlice);
            const lessonsConfig = resolveLessonsConfig(studentConfig);
            const effectiveStudentConfig = buildEffectiveLessonsStudentConfig(studentConfig, lessonsConfig);
            const studentTitle = String(studentSlice?.student?.title || "").trim();
            const container = document.createElement("div");
            container.className = "wu-widget-container bright small light";
            const startTimesMap = buildStartTimesMap(studentSlice?.data?.timeUnits);
            const holidays = Array.isArray(studentSlice?.data?.holidays?.ranges)
              ? studentSlice.data.holidays.ranges
              : [];
            const pluginRuntimeContext = buildPluginRuntimeContext(
              pluginContext,
              renderContext,
              studentSlice,
              effectiveStudentConfig,
            );
            const count = renderLessonsForStudent(
              pluginRuntimeContext,
              container,
              studentTitle,
              studentTitle,
              effectiveStudentConfig,
              Array.isArray(studentSlice?.data?.lessons) ? studentSlice.data.lessons : [],
              startTimesMap,
              holidays,
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
})(typeof globalThis !== "undefined" ? globalThis : this);
