/**
 * Grid/Calendar Widget
 * Renders a visual timetable grid with:
 * - Time-based vertical layout (time axis on left, days as columns)
 * - Overlapping lesson detection and ticker animations
 * - Split-view for cancelled + replacement lessons (cancelled left, replacement right)
 * - Holiday and absence overlays
 * - Now-line indicator for current time
 * - Configurable week view (Mon-Fri) or custom date ranges
 * - Break supervision support
 * - Flexible field display configuration (subject/teacher/room/class/etc.)
 */

/**
 * Uses flexible field configuration (grid.fields.primary, grid.fields.secondary, grid.fields.additional).
 */
const nowLineStates = new WeakMap();

/**
 * Get or initialize now-line updater state for a module instance
 *
 * @param {Object} ctx - Main module context
 * @returns {Object} State object with timer and initialTimeout properties
 */
function getNowLineState(ctx) {
  if (!nowLineStates.has(ctx)) {
    nowLineStates.set(ctx, { timer: null, initialTimeout: null });
  }
  return nowLineStates.get(ctx);
}

function getModuleRootElement(ctx) {
  if (!ctx || typeof document === 'undefined') return null;
  const id = typeof ctx.identifier === 'string' ? ctx.identifier : null;
  if (!id) return null;
  return document.getElementById(id);
}

(function registerGridPlugin(globalRoot) {
  const host = globalRoot.MMMWebuntisPluginHost;
  if (!host || typeof host.registerFrontendPlugin !== 'function') {
    return;
  }

  const root = globalRoot.MMMWebuntisFrontendShared || {};
  const {
    log,
    escapeHtml,
    addHeader,
    getWidgetConfigResolved,
    formatDisplayDate,
    formatDisplayTime,
    toMinutesSinceMidnight,
    createWidgetContext,
    getTeachers,
    getSubject,
    getRoom,
    getClass,
    getStudentGroup,
    getInfo,
    buildWidgetHeaderTitle,
    getEmptyDayState,
    isIrregularStatus,
    getChangedFieldSet,
    getFirstFieldName,
    normalizeComparableText,
  } = root.util?.resolveWidgetHelpers?.(root) || {};

  let sharedLessonPopover = null;

  function getSharedLessonPopoverController() {
    if (sharedLessonPopover) return sharedLessonPopover;
    const createPopoverController = root?.util?.createPopoverController;
    if (typeof createPopoverController !== 'function') return null;
    sharedLessonPopover = createPopoverController({
      baseClassName: 'wu-shared-popover wu-shared-popover--grid',
      presentation: 'modal',
    });
    return sharedLessonPopover;
  }

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

  function resolveStudentConfig(studentSlice) {
    const config = studentSlice?.context?.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
    return config;
  }

  function resolveGridConfig(studentConfig) {
    const pluginConfig =
      studentConfig?.plugins?.grid?.config && typeof studentConfig.plugins.grid.config === 'object'
        ? studentConfig.plugins.grid.config
        : {};

    const pluginFields =
      pluginConfig?.fields && typeof pluginConfig.fields === 'object' && !Array.isArray(pluginConfig.fields) ? pluginConfig.fields : {};

    const pluginFormat =
      pluginFields?.format && typeof pluginFields.format === 'object' && !Array.isArray(pluginFields.format) ? pluginFields.format : {};

    return {
      ...pluginConfig,
      fields: {
        ...pluginFields,
        format: {
          ...pluginFormat,
        },
      },
    };
  }

  function buildEffectiveGridStudentConfig(studentConfig, gridConfig) {
    const plugins =
      studentConfig?.plugins && typeof studentConfig.plugins === 'object' && !Array.isArray(studentConfig.plugins)
        ? studentConfig.plugins
        : {};
    const gridPlugin = plugins?.grid && typeof plugins.grid === 'object' && !Array.isArray(plugins.grid) ? plugins.grid : {};

    return {
      ...studentConfig,
      grid: gridConfig,
      plugins: {
        ...plugins,
        grid: {
          ...gridPlugin,
          config: gridConfig,
        },
      },
    };
  }

  function buildGroupedRawLessons(lessons) {
    const grouped = {};
    (Array.isArray(lessons) ? lessons : []).forEach((lesson) => {
      const key = lesson?.date != null ? String(lesson.date) : '';
      if (!key) return;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(lesson);
    });
    Object.keys(grouped).forEach((key) => {
      grouped[key].sort((left, right) => (left?.startTime || 0) - (right?.startTime || 0));
    });
    return grouped;
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

  function createGridPluginRuntimeContext(pluginContext, renderContext, studentSlice, studentConfig) {
    const effectiveConfig = {
      ...studentConfig,
      language:
        studentConfig?.language ||
        (typeof globalThis.config !== 'undefined' && globalThis.config?.language ? globalThis.config.language : undefined),
      logLevel: renderContext?.runtime?.logLevel || globalRoot.MMMWebuntisLogLevel || studentConfig?.logLevel || 'info',
    };
    const dateContext = getCurrentDateContext(effectiveConfig);
    const studentTitle = String(studentSlice?.student?.title || '').trim();
    const holidays = Array.isArray(studentSlice?.data?.holidays?.ranges) ? studentSlice.data.holidays.ranges : [];
    const dayNotices = Array.isArray(studentSlice?.data?.dayNotices) ? studentSlice.data.dayNotices : [];

    return {
      identifier: `${renderContext?.moduleId || 'mmm-webuntis'}-grid-plugin`,
      config: effectiveConfig,
      studentConfig: effectiveConfig,
      holidayMapByStudent: {
        [studentTitle]: buildHolidayMapFromRanges(holidays),
      },
      dayNoticeMapByStudent: {
        [studentTitle]: buildDayNoticeMap(dayNotices),
      },
      preprocessedByStudent: {
        [studentTitle]: {
          rawGroupedByDate: buildGroupedRawLessons(studentSlice?.data?.lessons),
        },
      },
      _currentTodayYmd: dateContext.ymd,
      _paused: false,
      _hasWidget(name) {
        return (
          String(name || '')
            .trim()
            .toLowerCase() === 'grid'
        );
      },
      _getWidgetApi() {
        return root || null;
      },
      _usesLiveClock(nowContext = this.getCurrentDateContext()) {
        return nowContext?.isDebug !== true;
      },
      _handleClockDrivenDayRollover(nowContext = this.getCurrentDateContext()) {
        const nextTodayYmd = Number(nowContext?.ymd);
        if (!Number.isFinite(nextTodayYmd) || nextTodayYmd <= 0) return false;
        if (nextTodayYmd === this._currentTodayYmd) return false;
        this._currentTodayYmd = nextTodayYmd;
        return true;
      },
      _toMinutes(value) {
        return toMinutesSinceMidnight(value);
      },
      getCurrentDateContext(configOverride = null) {
        return getCurrentDateContext(configOverride || effectiveConfig);
      },
      translate(key, replacements) {
        return translate(pluginContext, key, key, replacements);
      },
    };
  }

  function getModuleDateContext(ctx, configOverride = null) {
    return ctx.getCurrentDateContext(configOverride || ctx.config || {});
  }

  function getCurrentDayDate(ctx) {
    const nowContext = getModuleDateContext(ctx);
    return new Date(nowContext.date.getFullYear(), nowContext.date.getMonth(), nowContext.date.getDate());
  }

  /**
   * Determine lesson display mode based on available fields
   * Detects whether lesson is from teacher view (has class) or student view (has studentGroup)
   *
   * @param {Object} lesson - Lesson object from backend
   * @returns {Object} Display mode object with flags:
   *   - isTeacherView: boolean - Lesson has class info (teacher perspective)
   *   - isStudentView: boolean - Lesson has studentGroup info (student perspective)
   *   - hasTeacher/hasSubject/hasRoom/hasClass/hasStudentGroup: field availability flags
   *   - primaryInfo/secondaryInfo: suggested field types for display
   *   - showStudentGroup: boolean - Whether to show student group
   */
  function getLessonDisplayMode(lesson) {
    const hasTeacher = Array.isArray(lesson?.teachers) && lesson.teachers.length > 0;
    const hasSubject = Array.isArray(lesson?.subjects) && lesson.subjects.length > 0;
    const hasRoom = Array.isArray(lesson?.rooms) && lesson.rooms.length > 0;
    const hasClass = Array.isArray(lesson?.classes) && lesson.classes.length > 0;
    const hasStudentGroup = Array.isArray(lesson?.studentGroups) && lesson.studentGroups.length > 0;

    const isTeacherView = hasClass && !hasStudentGroup;
    const isStudentView = hasStudentGroup && !hasClass;

    return {
      isTeacherView,
      isStudentView,
      hasTeacher,
      hasSubject,
      hasRoom,
      hasClass,
      hasStudentGroup,
      primaryInfo: isTeacherView ? 'class' : 'subject',
      secondaryInfo: isTeacherView ? 'room' : 'teacher',
      showStudentGroup: hasStudentGroup && !isTeacherView,
    };
  }

  /**
   * Resolve field configuration from config
   * Extracts grid.fields.{primary, secondary, additional, format} from student config
   *
   * Single source of truth: defaults are merged centrally in MMM-Webuntis.js / node_helper.js.
   * This widget only validates values and applies minimal safety fallbacks for invalid/missing data.
   *
   * @param {Object} config - Student configuration object
   * @returns {Object} Resolved field configuration
   */
  function resolveFieldConfig(config, _ctx) {
    const gridConfig = config?.grid?.fields || {};
    const defaultFields = {
      primary: 'subject',
      secondary: 'teacher',
      additional: ['room'],
      format: {
        subject: 'long',
        teacher: 'long',
        class: 'short',
        room: 'short',
        studentGroup: 'short',
      },
    };
    const validFieldTypes = ['subject', 'teacher', 'room', 'class', 'studentGroup', 'info', 'none'];
    const validFormats = ['short', 'long'];

    const normalizeFieldType = (value, fallback) => {
      const normalized = typeof value === 'string' ? value.trim() : '';
      return validFieldTypes.includes(normalized) ? normalized : fallback;
    };

    const fallbackAdditional = Array.isArray(defaultFields.additional) ? defaultFields.additional : ['room'];
    const inputAdditional = Array.isArray(gridConfig.additional) ? gridConfig.additional : fallbackAdditional;
    const additional = inputAdditional.map((field) => normalizeFieldType(field, null)).filter((field) => typeof field === 'string');

    const defaultFormat = defaultFields.format && typeof defaultFields.format === 'object' ? defaultFields.format : {};
    const localFormat = gridConfig.format && typeof gridConfig.format === 'object' ? gridConfig.format : {};
    const rawFormat = { ...defaultFormat, ...localFormat };
    const format = {};
    Object.keys(rawFormat).forEach((key) => {
      if (!validFieldTypes.includes(key)) return;
      const value = String(rawFormat[key] || '').trim();
      if (validFormats.includes(value)) {
        format[key] = value;
      }
    });

    return {
      primary: normalizeFieldType(gridConfig.primary, normalizeFieldType(defaultFields.primary, 'subject')),
      secondary: normalizeFieldType(gridConfig.secondary, normalizeFieldType(defaultFields.secondary, 'teacher')),
      additional: additional.length > 0 ? additional : fallbackAdditional,
      format,
    };
  }

  /**
   * Get field value based on flexible configuration
   * Generic wrapper around field extractors (getSubject, getTeachers, getRoom, etc.)
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {string} fieldType - Field type to extract ('subject', 'teacher', 'room', 'class', 'studentGroup', 'info')
   * @param {Object} fieldConfig - Field configuration with format specifications
   * @returns {string} Extracted field value or empty string if not found/invalid type
   */
  function getConfiguredFieldValue(lesson, fieldType, fieldConfig) {
    if (!lesson || !fieldType || fieldType === 'none') return '';

    const format = fieldConfig?.format?.[fieldType] || 'short';

    switch (fieldType) {
      case 'subject':
        return getSubject(lesson, format);
      case 'teacher': {
        const teachers = getTeachers(lesson, format);
        return teachers.length > 0 ? teachers[0] : '';
      }
      case 'room':
        return getRoom(lesson, format);
      case 'class':
        return getClass(lesson, format);
      case 'studentGroup':
        return getStudentGroup(lesson, format);
      case 'info':
        return getInfo(lesson, format);
      default:
        return '';
    }
  }

  /**
   * Build lesson display using flexible field configuration
   * Extracts primary, secondary, and additional fields based on grid.fields config
   * Automatically deduplicates additional fields if they match primary/secondary
   *
   * @param {Object} lesson - Lesson object from backend
   * @param {Object} config - Student configuration object
   * @param {Object} options - Display options (includeAdditional: boolean)
   * @returns {Object} Display parts object:
   *   - primary: string - Primary field value
   *   - secondary: string - Secondary field value
   *   - additional: string[] - Additional field values (deduplicated)
   */
  function buildFlexibleLessonDisplay(lesson, config, options = {}) {
    const { includeAdditional = true, ctx = null } = options;
    const fieldConfig = resolveFieldConfig(config, ctx);

    const primary = getConfiguredFieldValue(lesson, fieldConfig.primary, fieldConfig);
    const secondary = getConfiguredFieldValue(lesson, fieldConfig.secondary, fieldConfig);

    const parts = { primary, secondary, additional: [] };

    if (includeAdditional && Array.isArray(fieldConfig.additional)) {
      for (const additionalField of fieldConfig.additional) {
        const value = getConfiguredFieldValue(lesson, additionalField, fieldConfig);
        if (value && value !== primary && value !== secondary) {
          parts.additional.push(value);
        }
      }
    }

    return parts;
  }

  /**
   * Start the now-line updater (runs every minute)
   * Updates now-line position and refreshes past lesson masks
   * Automatically triggers data fetch on date change (if not in debug mode)
   *
   * @param {Object} ctx - Main module context
   */
  function startNowLineUpdater(ctx) {
    if (!ctx || ctx._paused) return;
    if (!ctx._hasWidget('grid')) return;
    const state = getNowLineState(ctx);
    if (state.timer || state.initialTimeout) return;

    const tick = () => {
      try {
        const nowContext = getModuleDateContext(ctx);
        // Skip clock-driven updates when debugDate is active (time is frozen)
        if (nowContext?.isDebug) return;

        ctx._handleClockDrivenDayRollover(nowContext);

        const gridWidget = ctx._getWidgetApi()?.grid;
        const moduleRoot = getModuleRootElement(ctx);
        if (gridWidget) {
          if (typeof gridWidget.updateNowLinesAll === 'function') gridWidget.updateNowLinesAll(ctx, moduleRoot);
          if (typeof gridWidget.refreshPastMasks === 'function') gridWidget.refreshPastMasks(ctx, moduleRoot);
        }
      } catch (err) {
        log('debug', 'minute tick update failed', err);
      }
    };

    const now = getModuleDateContext(ctx).date;
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    state.initialTimeout = setTimeout(
      () => {
        tick();
        state.timer = setInterval(tick, 60 * 1000);
        state.initialTimeout = null;
      },
      Math.max(0, msToNextMinute)
    );

    tick();
  }

  /**
   * Stop the now-line updater
   * Clears both minute timer and initial timeout
   *
   * @param {Object} ctx - Main module context
   */
  function stopNowLineUpdater(ctx) {
    if (!ctx) return;
    const state = getNowLineState(ctx);
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
    if (state.initialTimeout) {
      clearTimeout(state.initialTimeout);
      state.initialTimeout = null;
    }
  }

  /**
   * Validate and extract grid configuration
   * Supports two modes:
   *   - weekView: true → Always show Mon-Fri of current/next week (auto-advance on Fri 16:00+ / Sat/Sun)
   *   - weekView: false → Show configurable past/future days (pastDays + today + nextDays)
   *
   * @param {Object} ctx - Main module context (provides debugDate support)
   * @param {Object} studentConfig - Student-specific configuration
   * @returns {Object} Grid configuration with calculated offsets:
   *   - daysToShow: number - Number of future days to show (not including today)
   *   - pastDays: number - Number of past days to show
   *   - startOffset: number - Day offset from base date (negative = past)
   *   - totalDisplayDays: number - Total days to display
   *   - gridDateFormat: string - Date format for day labels
   *   - maxGridLessons: number - Maximum lessons per day (0 = no limit)
   *   - weekView: boolean - Whether week view mode is active
   */
  function validateAndExtractGridConfig(ctx, studentConfig) {
    const getGridConfig = (key) => {
      return getWidgetConfigResolved(studentConfig, ctx, 'grid', key);
    };

    const weekView = Boolean(getGridConfig('weekView'));
    const configuredNext = getGridConfig('nextDays');
    const configuredPast = getGridConfig('pastDays');
    const gridDateFormat = getGridConfig('dateFormat');
    const hideWeekends = Boolean(getGridConfig('hideWeekends'));
    const maxGridLessons = Math.max(0, Math.floor(Number(getGridConfig('maxLessons') ?? 0)));
    const rawPxPerMinute = getGridConfig('pxPerMinute');
    const pxPerMinute =
      rawPxPerMinute !== undefined && rawPxPerMinute !== null && Number.isFinite(Number(rawPxPerMinute)) && Number(rawPxPerMinute) > 0
        ? Number(rawPxPerMinute)
        : 0.8;

    let daysToShow, pastDays, startOffset, totalDisplayDays;

    if (weekView) {
      let baseDate;
      if (ctx._currentTodayYmd && typeof ctx._currentTodayYmd === 'number') {
        const s = String(ctx._currentTodayYmd);
        const by = parseInt(s.substring(0, 4), 10);
        const bm = parseInt(s.substring(4, 6), 10) - 1;
        const bd = parseInt(s.substring(6, 8), 10);
        baseDate = new Date(by, bm, bd);
      } else {
        baseDate = getCurrentDayDate(ctx);
      }

      const dayOfWeek = baseDate.getDay();
      const nowContext = getModuleDateContext(ctx);
      const currentHour = nowContext.date.getHours();
      const currentMinute = nowContext.date.getMinutes();

      let weekOffset = 0;
      if (dayOfWeek === 5) {
        if (ctx._usesLiveClock(nowContext) && (currentHour >= 16 || (currentHour === 15 && currentMinute >= 45))) {
          weekOffset = 1;
        }
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        weekOffset = 1;
      }

      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      startOffset = daysToMonday + weekOffset * 7;
      totalDisplayDays = 5;
      daysToShow = totalDisplayDays - 1;
      pastDays = 0;
    } else {
      daysToShow = configuredNext && Number(configuredNext) > 0 ? parseInt(configuredNext, 10) : 0;
      pastDays = Math.max(0, parseInt(configuredPast, 10));
      startOffset = -pastDays;
      totalDisplayDays = pastDays + 1 + daysToShow;
    }

    return {
      daysToShow,
      pastDays,
      startOffset,
      totalDisplayDays,
      gridDateFormat,
      maxGridLessons,
      pxPerMinute,
      hideWeekends,
      weekView,
    };
  }

  /**
   * Calculate time range for grid (vertical axis)
   * Uses time units if available, otherwise infers from lesson data
   * Filters out lessons longer than 12 hours (likely data errors)
   * Also checks for lessons outside timeUnits range (e.g., early supervision, late activities)
   *
   * @param {Array} timetable - Array of lesson objects
   * @param {Array} timeUnits - Array of time unit objects (startMin, endMin, name, startTime)
   * @param {Object} ctx - Main module context (provides _toMinutes helper)
   * @returns {Object} Time range object:
   *   - allStart: number - Earliest minute of day (default: 7*60 = 7:00 AM)
   *   - allEnd: number - Latest minute of day (default: 17*60 = 5:00 PM)
   */
  function calculateTimeRange(timetable, timeUnits, ctx) {
    let allStart = Infinity;
    let allEnd = -Infinity;

    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      timeUnits.forEach((u) => {
        if (u.startMin !== undefined && u.startMin !== null) allStart = Math.min(allStart, u.startMin);
        if (u.endMin !== undefined && u.endMin !== null) allEnd = Math.max(allEnd, u.endMin);
      });

      (Array.isArray(timetable) ? timetable : []).forEach((el) => {
        const s = ctx._toMinutes(el.startTime);
        const e = el.endTime ? ctx._toMinutes(el.endTime) : null;
        if (s !== null && s !== undefined && e !== null && e !== undefined) {
          if (s < allStart || e > allEnd) {
            if (e - s < 12 * 60) {
              allStart = Math.min(allStart, s);
              allEnd = Math.max(allEnd, e);
            }
          }
        }
      });
    } else {
      (Array.isArray(timetable) ? timetable : []).forEach((el) => {
        const s = ctx._toMinutes(el.startTime);
        const e = el.endTime ? ctx._toMinutes(el.endTime) : null;
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

    if (!Number.isFinite(allStart) || allEnd <= allStart) {
      allStart = 7 * 60;
      allEnd = 17 * 60;
    }

    return { allStart, allEnd };
  }

  /**
   * Apply max lessons limit to time range cutoff
   * Limits visible time range to first N periods (respects time unit boundaries)
   *
   * @param {number} allStart - Start time in minutes
   * @param {number} allEnd - End time in minutes (before limit)
   * @param {number} maxGridLessons - Maximum number of periods to show (0 = no limit)
   * @param {Array} timeUnits - Array of time unit objects
   * @returns {number} New end time in minutes (clamped to period boundary)
   */
  function applyMaxLessonsLimit(allStart, allEnd, maxGridLessons, timeUnits) {
    if (maxGridLessons >= 1 && Array.isArray(timeUnits) && timeUnits.length > 0) {
      const targetIndex = Math.min(timeUnits.length - 1, maxGridLessons - 1);
      let cutoff = timeUnits[targetIndex].endMin;

      if (cutoff === undefined || cutoff === null) {
        if (targetIndex + 1 < timeUnits.length && timeUnits[targetIndex + 1]?.startMin !== undefined) {
          cutoff = timeUnits[targetIndex + 1].startMin;
        } else if (timeUnits[targetIndex].startMin !== undefined) {
          cutoff = timeUnits[targetIndex].startMin + 60;
        }
      }

      if (
        cutoff !== undefined &&
        cutoff !== null &&
        targetIndex + 1 < timeUnits.length &&
        timeUnits[targetIndex + 1]?.startMin !== undefined
      ) {
        cutoff = timeUnits[targetIndex + 1].startMin;
      }

      if (cutoff !== undefined && cutoff !== null && cutoff > allStart && cutoff < allEnd) {
        return cutoff;
      }
    }
    return allEnd;
  }

  function getTimeUnitBounds(timeUnits, ui) {
    if (!Array.isArray(timeUnits) || ui < 0 || ui >= timeUnits.length) {
      return { startMin: null, lineMin: null };
    }

    const u = timeUnits[ui];
    const startMin = u?.startMin ?? null;
    let lineMin = null;

    if (ui + 1 < timeUnits.length && timeUnits[ui + 1]?.startMin !== undefined) {
      lineMin = timeUnits[ui + 1].startMin;
    } else if (u?.endMin !== undefined) {
      lineMin = u.endMin;
    } else if (startMin !== null) {
      lineMin = startMin + 60;
    }

    return { startMin, lineMin };
  }

  /**
   * Create grid header with day labels
   * Creates a grid row with empty corner cell + day column labels
   *
   * @param {number} totalDisplayDays - Number of days to display
   * @param {Date} baseDate - Base date for calculations
   * @param {number} startOffset - Day offset from base date
   * @param {string} gridDateFormat - Date format for day labels
   * @param {Object} ctx - Main module context
   * @param {Object} util - Utility object with formatDisplayDate function
   * @returns {Object} Object with header element and gridTemplateColumns string
   */
  function createGridHeader(displayDates, gridDateFormat, ctx, { formatDisplayDate }) {
    const header = document.createElement('div');
    header.className = 'grid-days-header';

    const cols = ['minmax(80px,auto)'];
    for (let d = 0; d < displayDates.length; d++) {
      cols.push('1fr');
    }
    header.style.gridTemplateColumns = cols.join(' ');

    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'grid-days-header-empty';
    header.appendChild(emptyHeader);

    for (let d = 0; d < displayDates.length; d++) {
      const dayDate = displayDates[d];
      const dayLabel = document.createElement('div');
      dayLabel.className = 'grid-daylabel';

      const dayLabelText = formatDisplayDate
        ? formatDisplayDate(dayDate, gridDateFormat)
        : dayDate.toLocaleDateString(ctx.config.language, { weekday: 'short', day: 'numeric', month: 'numeric' });

      dayLabel.innerText = dayLabelText;
      const col = 2 + d;
      dayLabel.style.gridColumn = `${col}`;
      header.appendChild(dayLabel);
    }

    return { header, gridTemplateColumns: cols.join(' ') };
  }

  function formatAxisTime(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';

    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';

    const padded = digits.padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`;
  }

  function resolveAxisLabelMode(unitHeightPx) {
    if (!Number.isFinite(unitHeightPx) || unitHeightPx <= 0) return 'compact';
    if (unitHeightPx < 18) return 'tight';
    if (unitHeightPx < 34) return 'compact';
    return 'roomy';
  }

  /**
   * Create time axis (left column with hour labels and grid lines)
   * Renders either time units (periods) or hourly grid lines
   *
   * @param {Array} timeUnits - Array of time unit objects (name, startTime, startMin, endMin)
   * @param {number} allStart - Start time in minutes
   * @param {number} allEnd - End time in minutes
   * @param {number} totalHeight - Total height in pixels
   * @param {number} totalMinutes - Total minutes span (allEnd - allStart)
   * @param {Object} ctx - Main module context (provides translate)
   * @returns {HTMLElement} Time axis div element
   */
  function createTimeAxis(timeUnits, allStart, allEnd, totalHeight, totalMinutes, ctx) {
    const timeAxis = document.createElement('div');
    timeAxis.className = 'grid-timecell';
    const timeInner = document.createElement('div');
    timeInner.style.position = 'relative';
    timeInner.style.height = `${totalHeight}px`;
    timeInner.style.width = '100%';

    if (Array.isArray(timeUnits) && timeUnits.length > 0) {
      for (let ui = 0; ui < timeUnits.length; ui++) {
        const u = timeUnits[ui];
        const { startMin, lineMin } = getTimeUnitBounds(timeUnits, ui);
        if (startMin === null) continue;

        const top = Math.round(((startMin - allStart) / totalMinutes) * totalHeight);
        const lab = document.createElement('div');
        lab.style.position = 'absolute';
        lab.style.top = `${top}px`;
        lab.style.left = '4px';
        lab.style.zIndex = 2;
        lab.className = 'grid-timeunit-label';

        const unitHeightPx =
          Number.isFinite(startMin) && Number.isFinite(lineMin) && lineMin > startMin
            ? Math.round(((lineMin - startMin) / totalMinutes) * totalHeight)
            : null;
        const labelMode = resolveAxisLabelMode(unitHeightPx);
        lab.classList.add(`is-${labelMode}`);

        const unitName = String(u?.name ?? '').trim();
        const startText = formatAxisTime(u?.startTime);
        const endText = formatAxisTime(u?.endTime);

        if (unitName) {
          const periodText = formatTimeUnitPeriodText(unitName, ctx);
          if (labelMode === 'tight') {
            lab.innerHTML = `<span class='grid-timeunit-time'>${startText || periodText}</span>`;
          } else if (labelMode === 'compact') {
            const compactTime = startText || endText;
            lab.innerHTML = compactTime
              ? `<span class='grid-timeunit-period'>${periodText}</span><span class='grid-timeunit-time'>${compactTime}</span>`
              : `<span class='grid-timeunit-period'>${periodText}</span>`;
          } else {
            const fullTime = startText && endText ? `${startText}-${endText}` : startText || endText;
            lab.innerHTML = fullTime
              ? `<span class='grid-timeunit-period'>${periodText}</span><span class='grid-timeunit-time'>${fullTime}</span>`
              : `<span class='grid-timeunit-period'>${periodText}</span>`;
          }

          if (startText || endText) {
            lab.title = startText && endText ? `${startText}-${endText}` : startText || endText;
          }
        } else {
          const fallbackTime = startText || endText || '';
          lab.innerHTML = `<span class='grid-timeunit-time'>${fallbackTime}</span>`;
          if (fallbackTime) lab.title = fallbackTime;
        }
        timeInner.appendChild(lab);

        if (lineMin !== undefined && lineMin !== null && lineMin >= allStart && lineMin <= allEnd) {
          const lineTop = Math.round(((lineMin - allStart) / totalMinutes) * totalHeight);
          const tline = document.createElement('div');
          tline.className = 'grid-hourline';
          tline.style.top = `${lineTop}px`;
          timeInner.appendChild(tline);
        }
      }
    } else {
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

        const tline = document.createElement('div');
        tline.className = 'grid-hourline';
        tline.style.top = `${top}px`;
        timeInner.appendChild(tline);
      }
    }

    timeAxis.appendChild(timeInner);
    timeAxis.style.gridColumn = '1';

    return timeAxis;
  }

  function formatEnglishOrdinal(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number <= 0) return String(value || '');
    const mod100 = number % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
    const mod10 = number % 10;
    if (mod10 === 1) return `${number}st`;
    if (mod10 === 2) return `${number}nd`;
    if (mod10 === 3) return `${number}rd`;
    return `${number}th`;
  }

  function formatTimeUnitPeriodText(unitName, ctx) {
    const normalizedUnitName = String(unitName || '').trim();
    if (!normalizedUnitName) return '';

    const language = String(ctx?.config?.language || '')
      .trim()
      .toLowerCase();
    const isEnglish = language === 'en' || language.startsWith('en-');

    if (isEnglish) {
      const periodUnit = translate(ctx, 'period_unit', 'period');
      return `${formatEnglishOrdinal(normalizedUnitName)} ${periodUnit}`.trim();
    }

    const periodSuffix = translate(ctx, 'period_suffix', ctx?.translate?.('period') || '').trim();
    return periodSuffix ? `${normalizedUnitName}.${periodSuffix}` : normalizedUnitName;
  }

  /**
   * Extract and normalize lessons for a single day
   * Converts backend lesson objects to grid-specific format with:
   * - Time values (startMin/endMin in minutes)
   * - Flexible field extraction (subject/teacher/room/class/etc.)
   * - Display mode detection (teacher view vs student view)
   * - Legacy field support
   *
   * @param {Array} sourceForDay - Array of lesson objects for one day
   * @param {Object} ctx - Main module context (provides _toMinutes helper)
   * @returns {Array} Normalized lesson objects
   */
  function extractDayLessons(sourceForDay, ctx) {
    return sourceForDay.map((el) => {
      const displayMode = getLessonDisplayMode ? getLessonDisplayMode(el) : {};

      // IMPORTANT: Spread `el` first so ALL payload fields are forwarded automatically.
      // Explicit keys below override where the grid needs computed/normalized values.
      // Without the spread, any new field added to
      // lib/mmm-adapter/mmmPayloadMapper.js/schemas.lesson would silently vanish
      // here and never reach makeLessonInnerHTML().
      return {
        ...el,
        dateStr: String(el.date),
        startMin: ctx._toMinutes(el.startTime),
        endMin: el.endTime ? ctx._toMinutes(el.endTime) : null,
        startTime: el.startTime ? String(el.startTime).padStart(4, '0') : '',
        endTime: el.endTime ? String(el.endTime).padStart(4, '0') : null,
        subjectShort: getSubject(el, 'short') || 'N/A',
        subject: getSubject(el, 'long') || 'N/A',
        teacherInitial: getTeachers(el, 'short')[0] || 'N/A',
        teacher: getTeachers(el, 'long')[0] || 'N/A',
        room: getRoom(el, 'short') || '',
        roomLong: getRoom(el, 'long') || '',
        class: getClass(el, 'short') || '',
        classLong: getClass(el, 'long') || '',
        studentGroup: getStudentGroup(el, 'short') || '',
        studentGroupLong: getStudentGroup(el, 'long') || '',
        infoShort: getInfo(el, 'short') || '',
        infoLong: getInfo(el, 'long') || '',
        isTeacherView: displayMode.isTeacherView,
        isStudentView: displayMode.isStudentView,
        code: el.code || '',
        substitutionText: el.substitutionText || '',
        text: el.lessonText || '',
        lessonId: el.id ?? null,
      };
    });
  }

  /**
   * Validate and normalize lessons
   * Ensures all lessons have startMin/endMin values
   * Fills missing endMin with startMin + 45 minutes (default lesson duration)
   *
   * @param {Array} dayLessons - Array of extracted lesson objects
   * @param {Function} log - Logging function
   * @returns {Array} Validated lesson objects (mutated in-place)
   */
  function validateAndNormalizeLessons(dayLessons, log) {
    for (const curr of dayLessons) {
      curr.lessonIds = curr.lessonIds || (curr.lessonId ? [String(curr.lessonId)] : []);

      if (curr.startMin === undefined || curr.startMin === null) {
        log(
          'debug',
          'Lesson missing startMin; backend should provide numeric startMin/endMin',
          curr.lessonId ? { lessonId: curr.lessonId } : curr
        );
      }

      if (curr.endMin === undefined || curr.endMin === null) {
        if (curr.startMin !== undefined && curr.startMin !== null) {
          curr.endMin = curr.startMin + 45;
        }
      }
    }
    return dayLessons;
  }

  /**
   * Filter lessons by maximum periods limit
   * When maxGridLessons is set:
   * - Filters ALL lessons (including cancelled/irregular) by period index
   * - Only shows lessons in the first N periods
   * When maxGridLessons is not set:
   * - Filters by allEnd cutoff time
   * - Keeps cancelled/irregular lessons regardless of time
   *
   * @param {Array} dayLessons - Array of normalized lesson objects
   * @param {number} maxGridLessons - Maximum number of periods (0 = no limit)
   * @param {Array} timeUnits - Array of time unit objects
   * @param {string} studentTitle - Student name (for logging)
   * @param {string} dateStr - Date string (YYYYMMDD)
   * @param {Object} ctx - Main module context
   * @param {number} allEnd - End time cutoff in minutes
   * @returns {Array} Filtered lesson objects
   */
  function filterLessonsByMaxPeriods(dayLessons, maxGridLessons, timeUnits, studentTitle, dateStr, ctx, allEnd) {
    if (allEnd === undefined || allEnd === null) {
      allEnd = Infinity;
    }
    if (maxGridLessons < 1 || !Array.isArray(timeUnits) || timeUnits.length === 0) {
      return dayLessons.filter((lesson) => {
        if (lesson.status === 'CANCELLED' || isIrregularStatus(lesson.status)) {
          return true;
        }
        const s = lesson.startMin;
        return s === undefined || s === null || Number.isNaN(s) || s < allEnd;
      });
    }

    const filtered = dayLessons.filter((lesson) => {
      const s = lesson.startMin;
      if (s === undefined || s === null || Number.isNaN(s)) {
        return true;
      }

      // Always show break supervisions (they can occur outside regular periods, e.g., early morning supervision)
      if (lessonIsBreakSupervision(lesson)) {
        return true;
      }

      if (maxGridLessons >= 1) {
        let matchedIndex = -1;
        for (let ui = 0; ui < timeUnits.length; ui++) {
          const u = timeUnits[ui];
          const uStart = u.startMin;
          let uEnd = u.endMin;

          if (uEnd === undefined || uEnd === null) {
            if (ui + 1 < timeUnits.length && timeUnits[ui + 1]?.startMin !== undefined) {
              uEnd = timeUnits[ui + 1].startMin;
            } else {
              uEnd = uStart + 60;
            }
          }

          if (s >= uStart && s < uEnd) {
            matchedIndex = ui;
            break;
          }
        }

        if (matchedIndex === -1 && timeUnits.length > 0 && s >= (timeUnits[timeUnits.length - 1].startMin ?? Number.NEGATIVE_INFINITY)) {
          matchedIndex = timeUnits.length - 1;
        }

        return matchedIndex !== -1 && matchedIndex < maxGridLessons;
      }

      if (s >= allEnd) {
        return false;
      }

      return true;
    });

    if (filtered.length < dayLessons.length) {
      const hidden = dayLessons.length - filtered.length;
      log(
        ctx,
        'debug',
        `Grid: hiding ${hidden} lesson(s) for ${studentTitle} on ${dateStr} due to grid.maxLessons=${maxGridLessons}. ` +
          `Showing first ${maxGridLessons} period(s) plus all cancelled/irregular.`
      );
    }

    return filtered;
  }

  function lessonHasDisplayIcon(lesson, iconName) {
    if (!lesson || !Array.isArray(lesson.displayIcons) || lesson.displayIcons.length === 0 || !iconName) {
      return false;
    }

    const normalizedIcon = String(iconName).trim().toUpperCase();
    return lesson.displayIcons.some((icon) => String(icon).trim().toUpperCase() === normalizedIcon);
  }

  /**
   * Check if lesson is an exam.
   *
   * @param {Object} lesson - Lesson object
   * @returns {boolean} True if lesson is an exam
   */
  function lessonHasExam(lesson) {
    return lessonHasDisplayIcon(lesson, 'EXAM');
  }

  function lessonIsBreakSupervision(lesson) {
    return lessonHasDisplayIcon(lesson, 'BREAK_SUPERVISION');
  }

  function lessonIsEvent(lesson) {
    return lessonHasDisplayIcon(lesson, 'EVENT');
  }

  function lessonIsMoved(lesson) {
    return lessonHasDisplayIcon(lesson, 'MOVED');
  }

  function getPopoverFieldDisplayName(entry, format = 'short') {
    if (entry === null || entry === undefined) return '';
    if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
    if (typeof entry !== 'object') return '';
    const shortName = String(entry.name ?? '').trim();
    const longName = String(entry.longname ?? '').trim();
    return format === 'long' ? longName || shortName : shortName || longName;
  }

  function joinNamedEntries(entries, format = 'long') {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    return entries
      .map((entry) => getPopoverFieldDisplayName(entry, format))
      .filter(Boolean)
      .join(', ');
  }

  function joinStringList(values) {
    if (!Array.isArray(values) || values.length === 0) return '';
    return values
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  function describeLessonStatus(lesson, ctx) {
    const status = String(lesson?.status || '')
      .trim()
      .toUpperCase();
    if (!status) return '';

    const key = `lesson_status_${status.toLowerCase()}`;
    const translated = ctx?.translate?.(key);
    if (translated && translated !== key) return translated;

    return status
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function buildLessonPopoverSections(lesson, ctx) {
    const timeLabel = [formatDisplayTime(lesson?.startTime), formatDisplayTime(lesson?.endTime)].filter(Boolean).join(' - ');

    const displayIcons = joinStringList(lesson?.displayIcons);
    const changedFields = joinStringList(lesson?.changedFields);

    return [
      {
        title: translate(ctx, 'popover_section_general', 'General'),
        entries: [
          { label: translate(ctx, 'popover_date', 'Date'), value: formatDisplayDate(lesson?.date, 'EEEE, dd.MM.yyyy') },
          { label: translate(ctx, 'popover_time', 'Time'), value: timeLabel },
          { label: translate(ctx, 'popover_period', 'Period'), value: lesson?.periodText || '' },
          { label: translate(ctx, 'popover_status', 'Status'), value: describeLessonStatus(lesson, ctx) },
          { label: translate(ctx, 'popover_activity', 'Activity'), value: lesson?.activityType || '' },
          { label: translate(ctx, 'popover_icons', 'Icons'), value: displayIcons },
        ],
      },
      {
        title: translate(ctx, 'popover_section_people', 'People & Context'),
        entries: [
          { label: translate(ctx, 'popover_subject', 'Subject'), value: joinNamedEntries(lesson?.subjects, 'long') },
          { label: translate(ctx, 'popover_teacher', 'Teacher'), value: joinNamedEntries(lesson?.teachers, 'long') },
          { label: translate(ctx, 'popover_room', 'Room'), value: joinNamedEntries(lesson?.rooms, 'long') },
          { label: translate(ctx, 'popover_class', 'Class'), value: joinNamedEntries(lesson?.classes, 'long') },
          { label: translate(ctx, 'popover_student_group', 'Student Group'), value: joinNamedEntries(lesson?.studentGroups, 'long') },
          { label: translate(ctx, 'popover_info', 'Info'), value: joinNamedEntries(lesson?.info, 'long') },
        ],
      },
      {
        title: translate(ctx, 'popover_section_changes', 'Changes'),
        entries: [
          { label: translate(ctx, 'popover_changed_fields', 'Changed Fields'), value: changedFields },
          {
            label: translate(ctx, 'popover_previous_subject', 'Previous Subject'),
            value: joinNamedEntries(lesson?.previousSubjects, 'long'),
          },
          {
            label: translate(ctx, 'popover_previous_teacher', 'Previous Teacher'),
            value: joinNamedEntries(lesson?.previousTeachers, 'long'),
          },
          { label: translate(ctx, 'popover_previous_room', 'Previous Room'), value: joinNamedEntries(lesson?.previousRooms, 'long') },
          { label: translate(ctx, 'popover_substitution_text', 'Substitution Text'), value: lesson?.substitutionText || '' },
          { label: translate(ctx, 'popover_lesson_text', 'Lesson Text'), value: lesson?.lessonText || lesson?.text || '' },
        ],
      },
    ];
  }

  function openLessonPopover(anchorEl, lesson, ctx) {
    const popover = getSharedLessonPopoverController();
    if (!popover || !lesson || !anchorEl) return;

    const primaryTitle =
      getSubject(lesson, 'long') ||
      getClass(lesson, 'long') ||
      getStudentGroup(lesson, 'long') ||
      describeLessonStatus(lesson, ctx) ||
      translate(ctx, 'popover_lesson_fallback_title', 'Lesson');

    const dateLabel = formatDisplayDate(lesson?.date, 'EEE dd.MM.yyyy');
    const timeLabel = [formatDisplayTime(lesson?.startTime), formatDisplayTime(lesson?.endTime)].filter(Boolean).join(' - ');
    const subtitle = [dateLabel, timeLabel].filter(Boolean).join(' • ');

    popover.toggle({
      anchorEl,
      toggleKey: `${lesson?.id ?? lesson?.lessonId ?? 'noid'}_${lesson?.date ?? ''}_${lesson?.startTime ?? ''}_${lesson?.endTime ?? ''}`,
      title: primaryTitle,
      subtitle,
      sections: buildLessonPopoverSections(lesson, ctx),
      rawData: lesson,
      rawLabel: translate(ctx, 'popover_raw_payload', 'Raw lesson payload'),
      emptyLabel: translate(ctx, 'popover_empty', 'No details available.'),
      closeLabel: translate(ctx, 'popover_close', 'Close details'),
      className: 'wu-shared-popover--grid',
    });
  }

  /**
   * Add horizontal grid lines to day column
   * Renders either time unit boundaries or hourly lines
   *
   * @param {HTMLElement} inner - Day column inner container
   * @param {Array} timeUnits - Array of time unit objects
   * @param {number} allStart - Start time in minutes
   * @param {number} allEnd - End time in minutes
   * @param {number} totalMinutes - Total minutes span
   * @param {number} totalHeight - Total height in pixels
   */
  function addHourLinesToColumn(inner, timeUnits, allStart, allEnd, totalMinutes, totalHeight) {
    try {
      if (Array.isArray(timeUnits) && timeUnits.length > 0) {
        for (let ui = 0; ui < timeUnits.length; ui++) {
          const { lineMin } = getTimeUnitBounds(timeUnits, ui);
          if (lineMin === undefined || lineMin === null) continue;
          if (lineMin < allStart || lineMin > allEnd) continue;

          const top = Math.round(((lineMin - allStart) / totalMinutes) * totalHeight);
          const line = document.createElement('div');
          line.className = 'grid-hourline';
          line.style.top = `${top}px`;
          inner.appendChild(line);
        }
      } else {
        for (let m = Math.ceil(allStart / 60) * 60; m <= allEnd; m += 60) {
          const top = Math.round(((m - allStart) / totalMinutes) * totalHeight);
          const line = document.createElement('div');
          line.className = 'grid-hourline';
          line.style.top = `${top}px`;
          inner.appendChild(line);
        }
      }
    } catch (e) {
      log('debug', 'failed to draw hour lines', e);
    }
  }

  /**
   * Add now-line placeholder to day column
   * Creates hidden now-line element (visibility controlled by updateNowLinesAll)
   * Stores time range and height for dynamic positioning
   *
   * @param {HTMLElement} inner - Day column inner container
   * @param {number} allStart - Start time in minutes
   * @param {number} allEnd - End time in minutes
   * @param {number} totalHeight - Total height in pixels
   */
  function addNowLineToColumn(inner, allStart, allEnd, totalHeight) {
    const nowLine = document.createElement('div');
    nowLine.className = 'grid-nowline';
    nowLine.style.display = 'none';
    inner.appendChild(nowLine);

    inner._nowLine = nowLine;
    inner._allStart = allStart;
    inner._allEnd = allEnd;
    inner._totalHeight = totalHeight;
  }

  /**
   * Add a day-wide notice (holiday or "no lessons")
   * Creates a full-height notice with icon and text
   *
   * @param {HTMLElement} inner - Day column inner container
   * @param {number} totalHeight - Total height in pixels
   * @param {string} noticeType - Notice type ('holiday' or 'no-lessons')
   * @param {string} text - Notice text (HTML allowed)
   * @param {string} iconSize - Icon font size (default: '1.5em')
   */
  function addDayNotice(inner, totalHeight, noticeType, text, iconSize = '1.5em') {
    const notice = document.createElement('div');
    notice.className = 'grid-lesson lesson lesson-content no-lesson';
    notice.style.height = `${totalHeight}px`;
    const icon = document.createElement('span');
    icon.className = `day-notice-icon day-notice-icon-${noticeType}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.style.fontSize = iconSize;

    const label = document.createElement('div');
    label.style.fontWeight = 'bold';
    label.innerHTML = text;

    notice.appendChild(icon);
    notice.appendChild(label);
    inner.appendChild(notice);
  }

  /**
   * Add "more" badge to indicate hidden lessons
   * Displayed when maxGridLessons limit is active
   *
   * @param {HTMLElement} inner - Day column inner container
   * @param {number} hiddenCount - Number of hidden lessons
   * @param {Object} ctx - Main module context (provides translate)
   */
  function addMoreBadge(inner, hiddenCount, ctx) {
    const moreBadge = document.createElement('div');
    moreBadge.className = 'grid-more-badge';
    moreBadge.innerText = ctx.translate('more');
    const hiddenLessonsKey = hiddenCount > 1 ? 'hidden_lessons_plural' : 'hidden_lessons';
    const hiddenLessonsLabel = ctx.translate ? ctx.translate(hiddenLessonsKey) : hiddenCount > 1 ? 'more lessons' : 'more lesson';
    moreBadge.title = `${hiddenCount} ${hiddenLessonsLabel}`;
    inner.appendChild(moreBadge);
  }

  /**
   * Apply CSS classes to lesson element
   * Centralized function for consistent class assignment across all lesson rendering modes
   *
   * @param {HTMLElement} element - Lesson cell element
   * @param {Object} lesson - Lesson object
   * @param {Object} options - Options for class assignment
   * @param {boolean} options.hasExam - True if lesson has exam
   * @param {boolean} options.isPast - True if lesson is in the past (used when nowYmd/nowMin not provided)
   * @param {Array<string>} options.additionalClasses - Additional classes (e.g., 'split-left', 'split-right')
   * @param {number|null} options.nowYmd - Current date as YYYYMMDD integer (for individual isPast calculation)
   * @param {number|null} options.nowMin - Current time in minutes (for individual isPast calculation)
   */
  function applyLessonClasses(element, lesson, options = {}) {
    const { hasExam = false, isPast = false, additionalClasses = [], nowYmd = null, nowMin = null } = options;

    if (lessonIsBreakSupervision(lesson)) {
      element.classList.add('lesson-break-supervision');
    } else if (lesson.status === 'CANCELLED') {
      element.classList.add('lesson-cancelled');
    } else if (isIrregularStatus(lesson.status)) {
      // CHANGED lessons where only teacher and/or room differ are kept in the
      // regular colour — the inline change markers still highlight the diff.
      // Any other irregular status (ADDITIONAL, SUBSTITUTION, …) or CHANGED
      // with a more significant field (subject, class, …) keeps the blue tint.
      const changedFields = getChangedFieldSet(lesson);
      const isMinorChange =
        lesson.status === 'CHANGED' && changedFields.size > 0 && [...changedFields].every((f) => f === 'teacher' || f === 'room');
      element.classList.add(isMinorChange ? 'lesson-regular' : 'lesson-substitution');
    } else {
      element.classList.add('lesson-regular');
    }

    if (additionalClasses.length > 0) {
      element.classList.add(...additionalClasses);
    }

    let lessonIsPast = isPast;
    if (nowYmd !== null && nowMin !== null) {
      const lessonYmd = Number(lesson.dateStr) || 0;
      lessonIsPast = false;
      if (lessonYmd < nowYmd) {
        lessonIsPast = true;
      } else if (lessonYmd === nowYmd) {
        if (lesson.endMin <= nowMin) lessonIsPast = true;
      }
    }

    if (lessonIsPast) element.classList.add('past');
    if (hasExam) element.classList.add('has-exam');
  }

  /**
   * Create a lesson cell container
   * Base element for all lesson types(regular, cancelled, substitution, exam)
   *
   * @param { number } topPx - Top position in pixels
   * @param { number } heightPx - Height in pixels
   * @param { string } dateStr - Date string(YYYYMMDD)
   * @param { number } eMin - End time in minutes
   * @returns { HTMLElement } Lesson cell div
   */
  function createLessonCell(topPx, heightPx, dateStr, eMin) {
    const cell = document.createElement('div');
    cell.className = 'grid-lesson lesson';
    cell.style.top = `${topPx}px`;
    cell.style.height = `${heightPx}px`;
    cell.setAttribute('data-date', dateStr);
    cell.setAttribute('data-end-min', String(eMin));
    return cell;
  }

  /**
   * Generate HTML content for lesson cell
   * Uses flexible field configuration (grid.fields.primary, grid.fields.secondary, grid.fields.additional).
   *
   * Special handling for BREAK_SUPERVISION activity type
   *
   * @param {Object} lesson - Lesson object with display fields
   * @param {Function} escapeHtml - HTML escape function
   * @param {Object} ctx - Main module context (provides config)
   * @returns {string} HTML content for lesson cell
   */
  function makeLessonInnerHTML(lesson, escapeHtml, ctx, lessonConfig) {
    if (lessonIsBreakSupervision(lesson)) {
      const breakSupervisionLabel = ctx.translate ? ctx.translate('break_supervision') : 'Break Supervision';
      const shortLabel = breakSupervisionLabel === 'Pausenaufsicht' ? 'PA' : 'BS';
      const supervisedArea = lesson.room || lesson.roomLong || '';
      const displayText = supervisedArea ? `${shortLabel} (${supervisedArea})` : shortLabel;
      return `<div class='lesson-content break-supervision'><span class='lesson-primary'><span class='wu-inline-icon wu-inline-icon--lesson lesson-break-supervision-icon' aria-hidden='true'></span>${escapeHtml(displayText)}</span></div>`;
    }

    // Build change-diff indicators for CHANGED lessons.
    // These are injected INLINE into the existing primary/secondary/additional lines
    // (not appended as a new row) to avoid overflow in compact grid cells.
    const changedFields = getChangedFieldSet(lesson);
    const hasUnknownChangedDetails = lesson.status === 'CHANGED' && changedFields.size === 0;

    const hasMovedBadge = lessonIsMoved(lesson);
    const movedBadge = hasMovedBadge ? `<span class='lesson-moved-badge' aria-hidden='true'></span>` : '';
    const changedBadge = hasUnknownChangedDetails ? `<span class='lesson-changed-generic-badge' aria-hidden='true'></span>` : '';
    const iconsHtml = movedBadge || changedBadge ? `<span class='lesson-icons'>${movedBadge}${changedBadge}</span>` : '';
    const lessonContentClass = movedBadge || changedBadge ? 'lesson-content has-icons' : 'lesson-content';

    const naText = String(lessonConfig?.grid?.naText ?? 'N/A');

    try {
      const displayParts = buildFlexibleLessonDisplay(lesson, lessonConfig || ctx?.config, { ctx });

      let primaryHtml;
      if (changedFields.has('subject')) {
        const newSubject = lesson.subjects?.[0]?.name || '';
        const oldSubject = getFirstFieldName(lesson.previousSubjects);
        if (newSubject) {
          primaryHtml = `<span class='lesson-changed-new'>${escapeHtml(newSubject)}</span>`;
        } else if (oldSubject) {
          primaryHtml = `<span class='lesson-changed-removed'>${escapeHtml(oldSubject)}</span>`;
        } else {
          primaryHtml = `<span class='lesson-changed-new'>${escapeHtml(naText)}</span>`;
        }
      } else {
        primaryHtml = displayParts.primary ? escapeHtml(displayParts.primary) : '';
      }

      let secondaryHtml;
      if (changedFields.has('teacher')) {
        const newTeacher = lesson.teachers?.[0]?.name || '';
        const oldTeacher = getFirstFieldName(lesson.previousTeachers);
        if (newTeacher) {
          secondaryHtml = `<span class='lesson-changed-new'>${escapeHtml(newTeacher)}</span>`;
        } else if (oldTeacher) {
          secondaryHtml = `<span class='lesson-changed-removed'>${escapeHtml(oldTeacher)}</span>`;
        } else {
          secondaryHtml = `<span class='lesson-changed-new'>${escapeHtml(naText)}</span>`;
        }
      } else {
        secondaryHtml = displayParts.secondary ? escapeHtml(displayParts.secondary) : '';
      }

      let additionalHtml = '';
      if (changedFields.has('room')) {
        const newRoom = lesson.rooms?.[0]?.name || '';
        const oldRoom = getFirstFieldName(lesson.previousRooms);
        if (newRoom) {
          additionalHtml = ` <span class='lesson-additional'>(<span class='lesson-changed-new'>${escapeHtml(newRoom)}</span>)</span>`;
        } else if (oldRoom) {
          additionalHtml = ` <span class='lesson-additional'>(<span class='lesson-changed-removed'>${escapeHtml(oldRoom)}</span>)</span>`;
        } else {
          additionalHtml = ` <span class='lesson-additional'>(<span class='lesson-changed-new'>${escapeHtml(naText)}</span>)</span>`;
        }
      } else if (displayParts.additional && displayParts.additional.length > 0) {
        const additionalParts = displayParts.additional
          .filter(Boolean)
          .map((item) => `<span class='lesson-additional'>(${escapeHtml(item)})</span>`)
          .join(' ');
        if (additionalParts) {
          additionalHtml = ` ${additionalParts}`;
        }
      }

      if (hasUnknownChangedDetails && !additionalHtml) {
        additionalHtml = ` <span class='lesson-additional'>(<span class='lesson-changed-new'>${escapeHtml(naText)}</span>)</span>`;
      }

      const normalizedLessonText = normalizeComparableText(lesson.text);
      const shouldShowLessonText =
        normalizedLessonText !== '' &&
        normalizedLessonText !== normalizeComparableText(displayParts.primary) &&
        normalizedLessonText !== normalizeComparableText(displayParts.secondary) &&
        !(
          Array.isArray(displayParts.additional) &&
          displayParts.additional.some((item) => normalizedLessonText === normalizeComparableText(item))
        );

      const subst = lesson.substitutionText
        ? `<span class='lesson-substitution-text'>${escapeHtml(lesson.substitutionText).replace(/\n/g, '<br>')}</span>`
        : '';
      const txt = shouldShowLessonText ? `<span class='lesson-info-text'>${escapeHtml(lesson.text).replace(/\n/g, '<br>')}</span>` : '';

      const secondaryLine =
        secondaryHtml || additionalHtml ? `<span class='lesson-secondary'>${secondaryHtml}${additionalHtml}</span>` : '';

      return `<div class='${lessonContentClass}'>${iconsHtml}<span class='lesson-primary'>${primaryHtml}</span>${secondaryLine}${subst}${txt}</div>`;
    } catch (err) {
      log('error', `[grid] makeLessonInnerHTML failed for lesson ${lesson?.id ?? lesson?.lessonId ?? 'unknown'}: ${err?.message || err}`);
      return `<div class='${lessonContentClass}'>${iconsHtml}<span class='lesson-primary'><span class='lesson-changed-new'>${escapeHtml(
        naText
      )}</span></span></div>`;
    }
  }

  /**
   * Check whether a lesson carries the timetable homework icon.
   *
   * @param {Object} lesson - Lesson object
   * @returns {boolean} True if the timetable marked this lesson with HOMEWORK
   */
  function checkHomeworkMatch(lesson) {
    return lessonHasDisplayIcon(lesson, 'HOMEWORK');
  }

  /**
   * Add homework icon to lesson cell
   * Displays configured homework icon when homework is due
   *
   * @param {HTMLElement} cell - Lesson cell element
   */
  function addHomeworkIcon(cell) {
    const icon = document.createElement('span');
    icon.className = 'homework-icon';
    icon.setAttribute('aria-hidden', 'true');
    if (cell?.innerHTML) {
      const iconContainer = cell.querySelector('.lesson-content') || cell;
      let icons = iconContainer.querySelector('.lesson-icons');
      if (!icons) {
        icons = document.createElement('span');
        icons.className = 'lesson-icons';
        iconContainer.appendChild(icons);
      }
      iconContainer.classList.add('has-homework', 'has-icons');
      icons.appendChild(icon.cloneNode(true));
    }
  }

  function getVisibleTimeBlockPlacement(startMin, endMin, allStart, allEnd, totalMinutes, totalHeight, options = {}) {
    const { minHeightPx = 0 } = options;
    const normalizedStart = Number(startMin);
    const normalizedEnd = Number(endMin);

    if (!Number.isFinite(normalizedStart) || !Number.isFinite(normalizedEnd)) {
      return null;
    }

    if (normalizedStart >= allEnd || normalizedEnd <= allStart) {
      return null;
    }

    const visibleStart = Math.max(normalizedStart, allStart);
    const visibleEnd = Math.min(normalizedEnd, allEnd);
    if (visibleEnd <= visibleStart) {
      return null;
    }

    const safeTotalMinutes = Math.max(1, totalMinutes);
    const topPx = Math.round(((visibleStart - allStart) / safeTotalMinutes) * totalHeight);
    const rawHeightPx = Math.round(((visibleEnd - visibleStart) / safeTotalMinutes) * totalHeight);
    const heightPx = Math.max(minHeightPx, rawHeightPx);

    return {
      visibleStart,
      visibleEnd,
      topPx,
      heightPx,
    };
  }

  /**
   * Append a lesson cell to the grid container
   *
   * @param {HTMLElement} container - Container element to append the cell to
   * @param {Object} lesson - Normalized lesson object
   * @param {Object} timeConstraints - Time constraint parameters
   * @param {number} timeConstraints.allStart - Grid start time in minutes since midnight
   * @param {number} timeConstraints.allEnd - Grid end time in minutes since midnight
   * @param {number} timeConstraints.totalMinutes - Total minutes in grid range
   * @param {number} timeConstraints.totalHeight - Total height of grid in pixels
   * @param {Object} rendering - Rendering context and configuration
   * @param {Object} rendering.ctx - Module context
   * @param {Function} rendering.escapeHtml - HTML escape function
   * @param {Object} rendering.lessonConfig - Lesson-specific configuration
   * @param {Object} [options={}] - Optional rendering parameters
   * @param {boolean} [options.isPast] - Whether the lesson is in the past
   * @param {number} [options.nowYmd] - Current date as YYYYMMDD integer
   * @param {number} [options.nowMin] - Current time in minutes since midnight
   * @param {string[]} [options.additionalClasses] - Additional CSS classes to apply
   * @returns {HTMLElement|null} Created lesson cell or null if not visible
   */
  function appendLessonCell(container, lesson, timeConstraints, rendering, options = {}) {
    const { allStart, allEnd, totalMinutes, totalHeight } = timeConstraints;
    const { ctx, escapeHtml, lessonConfig } = rendering;
    const { isPast = null, nowYmd = 0, nowMin = 0, additionalClasses = [] } = options;
    const placement = getVisibleTimeBlockPlacement(lesson.startMin, lesson.endMin, allStart, allEnd, totalMinutes, totalHeight, {
      minHeightPx: 12,
    });
    if (!placement) return null;

    const { visibleEnd, topPx, heightPx } = placement;
    const lessonYmd = Number(lesson.dateStr) || 0;
    const resolvedIsPast = typeof isPast === 'boolean' ? isPast : calcIsPast(lessonYmd, visibleEnd, nowYmd, nowMin);

    const cell = createLessonCell(topPx, heightPx, lesson.dateStr, visibleEnd);
    applyLessonClasses(cell, lesson, {
      hasExam: lessonHasExam(lesson),
      isPast: resolvedIsPast,
      additionalClasses,
    });
    cell.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx, lessonConfig);
    cell.tabIndex = 0;
    cell.setAttribute('role', 'button');
    cell.setAttribute('aria-label', `${getSubject(lesson, 'long') || 'Lesson'} details`);
    cell.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLessonPopover(cell, lesson, ctx);
    });
    cell.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openLessonPopover(cell, lesson, ctx);
    });
    if (checkHomeworkMatch(lesson)) addHomeworkIcon(cell);
    container.appendChild(cell);
    return cell;
  }

  /**
   * Group lessons by overlapping time slots
   * Groups are used to determine rendering strategy:
   * - 1 lesson → full-width cell
   * - 2+ overlapping lessons → ticker animation
   * - Break supervisions → always separate (no overlap checking)
   *
   * @param {Array} lessonsToRender - Array of normalized lesson objects
   * @returns {Map} Map of group key → lesson array
   */
  function groupLessonsByTimeSlot(lessonsToRender) {
    const byDate = new Map();
    for (const lesson of lessonsToRender) {
      if (!byDate.has(lesson.dateStr)) {
        byDate.set(lesson.dateStr, []);
      }
      byDate.get(lesson.dateStr).push(lesson);
    }

    const groups = new Map();
    let groupId = 0;

    for (const [dateStr, lessons] of byDate.entries()) {
      const regularLessons = [];
      const breakSupervisions = [];

      for (const lesson of lessons) {
        if (lessonIsBreakSupervision(lesson)) {
          breakSupervisions.push(lesson);
        } else {
          regularLessons.push(lesson);
        }
      }

      const sorted = regularLessons.slice().sort((a, b) => a.startMin - b.startMin);

      const assigned = new Set();

      for (let i = 0; i < sorted.length; i++) {
        if (assigned.has(i)) continue;

        const lesson = sorted[i];
        const overlappingGroup = [lesson];
        assigned.add(i);

        let foundNew = true;
        while (foundNew) {
          foundNew = false;
          for (let j = i + 1; j < sorted.length; j++) {
            if (assigned.has(j)) continue;

            const candidate = sorted[j];
            const hasOverlap = overlappingGroup.some(
              (groupLesson) => candidate.startMin < groupLesson.endMin && candidate.endMin > groupLesson.startMin
            );

            if (hasOverlap) {
              overlappingGroup.push(candidate);
              assigned.add(j);
              foundNew = true;
            }
          }
        }

        const key = `${dateStr}_group_${groupId++}`;
        groups.set(key, overlappingGroup);
      }

      for (const supervision of breakSupervisions) {
        const key = `${dateStr}_supervision_${groupId++}`;
        groups.set(key, [supervision]);
      }
    }

    return groups;
  }

  /**
   * Create ticker animation for overlapping lessons
   * Groups lessons by subject and creates seamless scrolling ticker
   * Each subject group is displayed stacked (lessons within group positioned relatively)
   *
   * @param {Array} lessons - Array of overlapping lesson objects
   * @param {number} topPx - Top position in pixels
   * @param {number} heightPx - Height in pixels
   * @param {HTMLElement} container - Day column container
   * @param {Object} ctx - Main module context
   * @param {Function} escapeHtml - HTML escape function
   * @param {boolean} isPast - True if lesson group is in the past (used for ticker wrapper)
   * @param {number} nowYmd - Current date as YYYYMMDD integer
   * @param {number} nowMin - Current time in minutes since midnight
   */
  function createTickerAnimation(lessons, topPx, heightPx, container, ctx, escapeHtml, _isPast, nowYmd, nowMin, tickerData, lessonConfig) {
    const subjectGroups = new Map();
    for (let index = 0; index < lessons.length; index++) {
      const lesson = lessons[index];
      const subject = getSubject(lesson, 'short') || null;
      const studentGroup = getStudentGroup(lesson, 'short') || null;
      const className = getClass(lesson, 'short') || null;

      const groupKey = `${subject || 'unknown'}_${studentGroup || className || 'noGroup'}`;

      if (!subjectGroups.has(groupKey)) {
        subjectGroups.set(groupKey, []);
      }
      subjectGroups.get(groupKey).push(lesson);
    }

    for (const [, groupLessons] of subjectGroups.entries()) {
      groupLessons.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
    }

    const splitViewPairs = [];
    if (tickerData?.hasSplitView && tickerData.cancelledLessons.length > 0) {
      const pairMap = new Map();
      for (const cancelled of tickerData.cancelledLessons) {
        const matchingReplacements = tickerData.replacements.filter((r) => r.startMin < cancelled.endMin && r.endMin > cancelled.startMin);

        if (matchingReplacements.length > 0) {
          const replacementKey = matchingReplacements
            .map((r) => `${r.id ?? r.lessonId ?? 'noId'}_${r.startMin}_${r.endMin}_${r.status || ''}`)
            .sort()
            .join('|');

          if (!pairMap.has(replacementKey)) {
            pairMap.set(replacementKey, {
              cancelledLessons: [],
              replacements: matchingReplacements,
            });
          }

          pairMap.get(replacementKey).cancelledLessons.push(cancelled);
        }
      }

      for (const [, pair] of pairMap.entries()) {
        pair.cancelledLessons.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
        splitViewPairs.push(pair);
      }

      const pairedLessons = new Set();
      for (const pair of splitViewPairs) {
        for (const cancelled of pair.cancelledLessons) pairedLessons.add(cancelled);
        for (const replacement of pair.replacements) pairedLessons.add(replacement);
      }

      for (const [key, groupLessons] of subjectGroups.entries()) {
        const filtered = groupLessons.filter((l) => !pairedLessons.has(l));
        if (filtered.length === 0) {
          subjectGroups.delete(key);
        } else {
          subjectGroups.set(key, filtered);
        }
      }
    }

    const tickerWrapper = document.createElement('div');
    tickerWrapper.className = 'lesson-ticker-wrapper';
    tickerWrapper.style.top = `${topPx}px`;
    tickerWrapper.style.height = `${heightPx}px`;
    tickerWrapper.style.position = 'absolute';
    tickerWrapper.style.left = '0.15rem';
    tickerWrapper.style.right = '0.15rem';
    tickerWrapper.style.zIndex = '10';
    tickerWrapper.setAttribute('data-date', lessons[0].dateStr);
    tickerWrapper.setAttribute('data-end-min', String(Math.max(...lessons.map((l) => l.endMin))));

    const tickerTrack = document.createElement('div');
    tickerTrack.className = 'ticker-track';

    const itemCount = subjectGroups.size + splitViewPairs.length;
    const itemWidthPercent = 100;

    const trackWidth = itemCount * 2 * itemWidthPercent;
    tickerTrack.style.width = `${trackWidth}%`;

    for (let copy = 0; copy < 2; copy++) {
      for (const [, subjectLessons] of subjectGroups.entries()) {
        const tickerItem = document.createElement('div');
        tickerItem.className = 'ticker-item';
        const groupHasExam = subjectLessons.some((lesson) => lessonHasExam(lesson));
        if (groupHasExam) tickerItem.classList.add('has-exam');

        tickerItem.style.width = `${itemWidthPercent / (itemCount * 2)}%`;
        tickerItem.style.position = 'relative';
        tickerItem.style.height = '100%';

        const groupStartMin = Math.min(...subjectLessons.map((l) => l.startMin));
        const groupEndMin = Math.max(...subjectLessons.map((l) => l.endMin));
        const totalGroupMinutes = groupEndMin - groupStartMin;

        for (const lesson of subjectLessons) {
          const lessonDiv = document.createElement('div');
          lessonDiv.className = 'lesson-content';

          const lessonStartOffset = lesson.startMin - groupStartMin;
          const lessonDuration = lesson.endMin - lesson.startMin;

          let topPercent;
          let heightPercent;

          if (totalGroupMinutes === 0) {
            topPercent = 0;
            heightPercent = 100;
          } else {
            topPercent = (lessonStartOffset / totalGroupMinutes) * 100;
            heightPercent = (lessonDuration / totalGroupMinutes) * 100;
          }

          lessonDiv.style.position = 'absolute';
          lessonDiv.style.top = `${topPercent}%`;
          lessonDiv.style.height = `${heightPercent}%`;
          lessonDiv.style.left = '0';
          lessonDiv.style.right = '0';

          applyLessonClasses(lessonDiv, lesson, {
            hasExam: lessonHasExam(lesson),
            nowYmd,
            nowMin,
          });

          lessonDiv.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx, lessonConfig);

          if (checkHomeworkMatch(lesson)) {
            addHomeworkIcon(lessonDiv);
          }

          tickerItem.appendChild(lessonDiv);
        }

        tickerTrack.appendChild(tickerItem);
      }

      for (const pair of splitViewPairs) {
        const tickerItem = document.createElement('div');
        tickerItem.className = 'ticker-item ticker-item-split';
        const pairHasExam = [...pair.replacements, ...pair.cancelledLessons].some((lesson) => lessonHasExam(lesson));
        if (pairHasExam) tickerItem.classList.add('has-exam');

        tickerItem.style.width = `${itemWidthPercent / (itemCount * 2)}%`;
        tickerItem.style.position = 'relative';
        tickerItem.style.height = '100%';

        const splitContainer = document.createElement('div');
        splitContainer.className = 'lesson-both-inner';
        splitContainer.style.position = 'absolute';
        splitContainer.style.top = '0';
        splitContainer.style.left = '0';
        splitContainer.style.right = '0';
        splitContainer.style.height = '100%';

        const pairStartMin = Math.min(...pair.cancelledLessons.map((c) => c.startMin), ...pair.replacements.map((r) => r.startMin));
        const pairEndMin = Math.max(...pair.cancelledLessons.map((c) => c.endMin), ...pair.replacements.map((r) => r.endMin));
        const pairTotalMinutes = Math.max(1, pairEndMin - pairStartMin);

        const toPairPercent = (lesson) => {
          const lessonStartOffset = lesson.startMin - pairStartMin;
          const lessonDuration = lesson.endMin - lesson.startMin;
          return {
            top: (lessonStartOffset / pairTotalMinutes) * 100,
            height: (lessonDuration / pairTotalMinutes) * 100,
          };
        };

        for (const replacement of pair.replacements) {
          const replacementDiv = document.createElement('div');
          replacementDiv.className = 'lesson-content split-left';
          const replacementPos = toPairPercent(replacement);
          replacementDiv.style.position = 'absolute';
          replacementDiv.style.top = `${replacementPos.top}%`;
          replacementDiv.style.height = `${replacementPos.height}%`;
          replacementDiv.style.left = '0';
          replacementDiv.style.width = '50%';

          applyLessonClasses(replacementDiv, replacement, {
            hasExam: lessonHasExam(replacement),
            nowYmd,
            nowMin,
            additionalClasses: ['split-left'],
          });

          replacementDiv.innerHTML = makeLessonInnerHTML(replacement, escapeHtml, ctx, lessonConfig);
          if (checkHomeworkMatch(replacement)) {
            addHomeworkIcon(replacementDiv);
          }

          splitContainer.appendChild(replacementDiv);
        }

        for (const cancelled of pair.cancelledLessons) {
          const cancelledDiv = document.createElement('div');
          cancelledDiv.className = 'lesson-content split-right';
          const cancelledPos = toPairPercent(cancelled);
          cancelledDiv.style.position = 'absolute';
          cancelledDiv.style.top = `${cancelledPos.top}%`;
          cancelledDiv.style.height = `${cancelledPos.height}%`;
          cancelledDiv.style.right = '0';
          cancelledDiv.style.width = '50%';

          applyLessonClasses(cancelledDiv, cancelled, {
            hasExam: lessonHasExam(cancelled),
            nowYmd,
            nowMin,
            additionalClasses: ['split-right'],
          });

          cancelledDiv.innerHTML = makeLessonInnerHTML(cancelled, escapeHtml, ctx, lessonConfig);
          if (checkHomeworkMatch(cancelled)) {
            addHomeworkIcon(cancelledDiv);
          }

          splitContainer.appendChild(cancelledDiv);
        }

        tickerItem.appendChild(splitContainer);
        tickerTrack.appendChild(tickerItem);
      }
    }

    tickerWrapper.appendChild(tickerTrack);

    const duration = Math.max(10, itemCount * 3);
    tickerTrack.style.animation = `ticker-scroll ${duration}s linear infinite`;

    container.appendChild(tickerWrapper);
  }

  /**
   * Check whether a rendered lesson block has already ended.
   *
   * @param {number} ymd - Lesson date as YYYYMMDD.
   * @param {number} endMin - Lesson end time in minutes since midnight.
   * @param {number} nowYmd - Current date as YYYYMMDD.
   * @param {number} nowMin - Current time in minutes since midnight.
   * @returns {boolean} True when the lesson is in the past.
   */
  function calcIsPast(ymd, endMin, nowYmd, nowMin) {
    if (ymd < nowYmd) return true;
    if (ymd === nowYmd && typeof endMin === 'number' && !Number.isNaN(endMin) && endMin <= nowMin) return true;
    return false;
  }

  /**
   * Detect whether a lesson carries class or student-group hints.
   *
   * @param {Object} lesson - Normalized lesson object.
   * @returns {boolean} True when class/student-group metadata is present.
   */
  function lessonHasStudentGroupOrClassHint(lesson) {
    const studentGroups = Array.isArray(lesson?.studentGroups) ? lesson.studentGroups : [];
    const classes = Array.isArray(lesson?.classes) ? lesson.classes : [];
    const hasStudentGroup = studentGroups.some((group) => (group?.name || group?.longname || '').trim().length > 0);
    const hasClass = classes.some((group) => (group?.name || group?.longname || '').trim().length > 0);
    return hasStudentGroup || hasClass;
  }

  function hasParallelOverlap(plannedParallelCandidates) {
    if (plannedParallelCandidates.length < 2) return false;

    for (let i = 0; i < plannedParallelCandidates.length; i++) {
      for (let j = i + 1; j < plannedParallelCandidates.length; j++) {
        const first = plannedParallelCandidates[i];
        const second = plannedParallelCandidates[j];
        if (first.startMin < second.endMin && first.endMin > second.startMin) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Classify an overlap group into the rendering mode used by the grid.
   *
   * @param {Array} lessons - Overlapping normalized lessons.
   * @returns {Object} Rendering classification metadata.
   */
  function classifyLessonRenderGroup(lessons) {
    const cancelledLessons = lessons.filter((lesson) => lesson.status === 'CANCELLED');
    const addedLessons = lessons.filter((lesson) => lesson.status === 'ADDITIONAL');
    const substLessons = lessons.filter((lesson) => lesson.status === 'SUBSTITUTION');
    const eventLessons = lessons.filter((lesson) => lessonIsEvent(lesson));
    const tickerCandidates = lessons.filter((lesson) => !lessonIsEvent(lesson));
    const plannedParallelCandidates = tickerCandidates.filter((lesson) => {
      const status = String(lesson.status || '').toUpperCase();
      return status === 'REGULAR' || status === 'CHANGED' || status === 'CANCELLED';
    });

    const substitutionTriggersSplit = substLessons.some((lesson) => !lessonHasStudentGroupOrClassHint(lesson));
    const isSplitView = cancelledLessons.length >= 1 && (addedLessons.length >= 1 || substitutionTriggersSplit || eventLessons.length >= 1);

    const tcGroupStart = tickerCandidates.length > 0 ? Math.min(...tickerCandidates.map((lesson) => lesson.startMin)) : Infinity;
    const tcGroupEnd = tickerCandidates.length > 0 ? Math.max(...tickerCandidates.map((lesson) => lesson.endMin)) : -Infinity;
    const spanningLessons = tickerCandidates.filter((lesson) => lesson.startMin <= tcGroupStart && lesson.endMin >= tcGroupEnd);
    const subPeriodLessons = tickerCandidates.filter((lesson) => !spanningLessons.includes(lesson));
    const isSpanSplitLayout =
      !isSplitView &&
      cancelledLessons.length === 0 &&
      addedLessons.length === 0 &&
      spanningLessons.length >= 1 &&
      subPeriodLessons.length >= 1;

    const isTickerGroup = hasParallelOverlap(plannedParallelCandidates);

    return {
      cancelledLessons,
      addedLessons,
      substLessons,
      eventLessons,
      tickerCandidates,
      tcGroupEnd,
      spanningLessons,
      subPeriodLessons,
      isSplitView,
      isTickerGroup,
      shouldUseSplitView: isSplitView && !isTickerGroup,
      isSpanSplitLayout,
    };
  }

  /**
   * Convert the current YYYYMMDD marker into a Date instance.
   *
   * @param {number|string} currentTodayYmd - Current date marker.
   * @returns {Date} Base date for grid rendering.
   */
  function getBaseDateFromYmd(currentTodayYmd, ctx = null) {
    if (!currentTodayYmd) {
      return getCurrentDayDate(ctx);
    }

    const raw = String(currentTodayYmd);
    const year = parseInt(raw.substring(0, 4), 10);
    const month = parseInt(raw.substring(4, 6), 10) - 1;
    const day = parseInt(raw.substring(6, 8), 10);
    return new Date(year, month, day);
  }

  /**
   * Format a Date into the YYYYMMDD key used throughout the grid.
   *
   * @param {Date} date - Date to format.
   * @returns {string} YYYYMMDD key.
   */
  function formatDateKey(date) {
    return `${date.getFullYear()}${(`0${date.getMonth() + 1}`).slice(-2)}${(`0${date.getDate()}`).slice(-2)}`;
  }

  function cloneDayDate(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function isWeekendDay(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
  }

  function buildRollingDisplayDates(baseDate, config, hasLessonsForDate) {
    const shouldIncludeDate = (date) => {
      if (!config.hideWeekends) return true;
      if (!isWeekendDay(date)) return true;
      return hasLessonsForDate(formatDateKey(date));
    };

    const displayDates = [];
    const visiblePastDates = [];
    let pastOffset = 1;
    while (visiblePastDates.length < config.pastDays && pastOffset <= 366) {
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

    const futureDaysNeeded = config.daysToShow + extraFutureDays;
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

  function getSourceLessonsForDay(ctx, studentTitle, timetable, dayYmdStr) {
    const groupedRaw = ctx.preprocessedByStudent?.[studentTitle]?.rawGroupedByDate;
    if (groupedRaw?.[dayYmdStr]) {
      return groupedRaw[dayYmdStr];
    }

    return (Array.isArray(timetable) ? timetable : [])
      .filter((entry) => String(entry.date) === dayYmdStr)
      .sort((left, right) => (left.startTime || 0) - (right.startTime || 0));
  }

  /**
   * Create the DOM shell for a single grid day column.
   *
   * @param {number} col - CSS grid column number.
   * @param {number} totalHeight - Column height in pixels.
   * @param {boolean} isToday - Whether the column represents today.
   * @returns {{bothWrap: HTMLElement, bothInner: HTMLElement}} Day column elements.
   */
  function createDayColumnWrapper(col, totalHeight, isToday) {
    const bothWrap = document.createElement('div');
    bothWrap.style.gridColumn = `${col}`;
    bothWrap.style.gridRow = '1';

    const bothInner = document.createElement('div');
    bothInner.className = 'day-column-inner';
    bothInner.style.height = `${totalHeight}px`;
    bothInner.style.position = 'relative';
    if (isToday) bothInner.classList.add('is-today');

    bothWrap.appendChild(bothInner);
    return { bothWrap, bothInner };
  }

  /**
   * Render either lesson cells or the empty-day fallback notice.
   *
   * @param {Object} options - Render context.
   */
  function renderDayLessonsOrNotice({
    lessonsToRender,
    emptyDayState,
    bothInner,
    totalHeight,
    allStart,
    allEnd,
    totalMinutes,
    ctx,
    studentConfig,
  }) {
    if (!Array.isArray(lessonsToRender) || lessonsToRender.length === 0) {
      const resolvedState = emptyDayState || { noticeType: 'no-lessons', label: ctx.translate('no-lessons') };
      const noticeType = resolvedState?.noticeType || 'no-lessons';
      const noticeText = `<b>${escapeHtml(resolvedState?.label || ctx.translate('no-lessons'))}</b>`;
      const iconSize = resolvedState?.type === 'holiday' ? '2em' : '1.5em';
      addDayNotice(bothInner, totalHeight, noticeType, noticeText, iconSize);
      return;
    }

    renderLessonCells(lessonsToRender, { bothInner }, allStart, allEnd, totalMinutes, totalHeight, ctx, escapeHtml, studentConfig);
  }

  /**
   * Render absence overlays for one rendered day column.
   *
   * @param {Array} absences - All absences for the current student.
   * @param {string} dateStr - YYYYMMDD key for the column.
   * @param {HTMLElement} bothInner - Day column inner element.
   * @param {number} allStart - Visible start minute.
   * @param {number} allEnd - Visible end minute.
   * @param {number} totalHeight - Column height in pixels.
   * @param {Object} ctx - Module context.
   */
  function addDayAbsenceOverlays(absences, dateStr, bothInner, allStart, allEnd, totalHeight, ctx) {
    if (!Array.isArray(absences) || absences.length === 0) {
      return;
    }

    const dayAbsences = absences.filter((absence) => String(absence?.date) === dateStr);
    if (dayAbsences.length === 0) {
      return;
    }

    addAbsenceOverlays(bothInner, dayAbsences, allStart, allEnd, totalHeight, ctx);
  }

  /**
   * Render one complete day column including notices, lessons, and absences.
   *
   * @param {Object} options - Day render context.
   */
  function renderGridDayColumn({
    grid,
    ctx,
    studentTitle,
    studentConfig,
    timetable,
    timeUnits,
    absences,
    targetDate,
    todayDateStr,
    allStart,
    allEnd,
    totalMinutes,
    totalHeight,
    dayIndex,
    maxGridLessons,
  }) {
    const dayYmdStr = formatDateKey(targetDate);
    const sourceForDay = getSourceLessonsForDay(ctx, studentTitle, timetable, dayYmdStr);

    let dayLessons = extractDayLessons(sourceForDay, ctx);
    dayLessons = validateAndNormalizeLessons(dayLessons, log);

    const lessonsToRender = filterLessonsByMaxPeriods(dayLessons, maxGridLessons, timeUnits, studentTitle, dayYmdStr, ctx, allEnd);
    const emptyDayState = getEmptyDayState(ctx, studentTitle, targetDate);
    const hiddenCount = dayLessons.length - lessonsToRender.length;
    const col = 2 + dayIndex;
    const { bothWrap, bothInner } = createDayColumnWrapper(col, totalHeight, dayYmdStr === todayDateStr);

    grid.appendChild(bothWrap);
    addHourLinesToColumn(bothInner, timeUnits, allStart, allEnd, totalMinutes, totalHeight);
    addNowLineToColumn(bothInner, allStart, allEnd, totalHeight);

    if (hiddenCount > 0) {
      addMoreBadge(bothInner, hiddenCount, ctx);
    }

    renderDayLessonsOrNotice({
      lessonsToRender,
      emptyDayState,
      bothInner,
      totalHeight,
      allStart,
      allEnd,
      totalMinutes,
      ctx,
      studentConfig,
    });

    addDayAbsenceOverlays(absences, dayYmdStr, bothInner, allStart, allEnd, totalHeight, ctx);
  }

  /**
   * Schedule post-render now-line and past-mask updates for the rendered grid.
   *
   * @param {Object} ctx - Module context.
   * @param {HTMLElement} wrapper - Rendered grid wrapper.
   */
  function scheduleGridPostRenderUpdates(ctx, wrapper) {
    setTimeout(() => {
      try {
        const gridWidget = ctx?._getWidgetApi?.()?.grid;
        if (gridWidget && typeof gridWidget.updateNowLinesAll === 'function') {
          gridWidget.updateNowLinesAll(ctx, wrapper);
        }
        if (gridWidget && typeof gridWidget.refreshPastMasks === 'function') {
          gridWidget.refreshPastMasks(ctx, wrapper);
        }
      } catch (e) {
        log('warn', 'initial now-line/past-mask update failed', e);
      }
    }, 0);
  }

  /**
   * Render all lesson cells for a day column.
   *
   * The overlap classifier selects split-view, span-split, ticker, or plain
   * individual cells depending on overlap structure and substitution metadata.
   *
   * @param {Array} lessonsToRender - Normalized lessons for one day.
   * @param {Object} containers - Day column containers.
   * @param {number} allStart - Grid start in minutes since midnight.
   * @param {number} allEnd - Grid end in minutes since midnight.
   * @param {number} totalMinutes - Total visible duration in minutes.
   * @param {number} totalHeight - Total column height in pixels.
   * @param {Object} ctx - Module context.
   * @param {Function} escapeHtml - HTML escaping helper.
   * @param {Object} lessonConfig - Grid rendering configuration.
   */
  function renderLessonCells(lessonsToRender, containers, allStart, allEnd, totalMinutes, totalHeight, ctx, escapeHtml, lessonConfig) {
    const { bothInner } = containers;

    const timeSlotGroups = groupLessonsByTimeSlot(lessonsToRender);

    const nowContext = getModuleDateContext(ctx);
    const nowYmd = ctx._currentTodayYmd ?? nowContext.ymd;
    const now = nowContext.date;
    const nowMin = now.getHours() * 60 + now.getMinutes();

    /** Render a single lesson as a standalone full-width cell at its own time position. */
    const renderSingleLesson = (lesson) => {
      appendLessonCell(
        bothInner,
        lesson,
        { allStart, allEnd, totalMinutes, totalHeight },
        { ctx, escapeHtml, lessonConfig },
        { nowYmd, nowMin }
      );
    };

    const renderTickerGroup = (lessons, group) => {
      const { cancelledLessons, addedLessons, substLessons, eventLessons, tickerCandidates, isSplitView } = group;
      const tYmd = Number(tickerCandidates[0].dateStr) || 0;
      const tEMin = Math.min(Math.max(...tickerCandidates.map((l) => l.endMin)), allEnd);
      const isPast = calcIsPast(tYmd, tEMin, nowYmd, nowMin);

      const tickerData = {
        cancelledLessons,
        replacements: [...addedLessons, ...substLessons, ...eventLessons],
        hasSplitView: isSplitView,
      };

      const tickerStart = Math.max(Math.min(...tickerCandidates.map((l) => l.startMin)), allStart);
      const tickerEnd = Math.min(Math.max(...tickerCandidates.map((l) => l.endMin)), allEnd);

      const placement = getVisibleTimeBlockPlacement(tickerStart, tickerEnd, allStart, allEnd, totalMinutes, totalHeight, {
        minHeightPx: 12,
      });
      if (placement) {
        createTickerAnimation(
          tickerCandidates,
          placement.topPx,
          placement.heightPx,
          bothInner,
          ctx,
          escapeHtml,
          isPast,
          nowYmd,
          nowMin,
          tickerData,
          lessonConfig
        );
      }

      for (const lesson of lessons) {
        if (tickerCandidates.includes(lesson)) continue;
        if (cancelledLessons.includes(lesson)) continue;
        const isReplacement = tickerData.replacements.includes(lesson);
        const overlapsCancelled = cancelledLessons.some((c) => lesson.startMin < c.endMin && lesson.endMin > c.startMin);
        if (isReplacement && overlapsCancelled) continue;
        renderSingleLesson(lesson);
      }
    };

    const renderSplitGroup = (lessons, group) => {
      const { cancelledLessons, addedLessons, substLessons, eventLessons } = group;
      const replacements = [...addedLessons, ...substLessons, ...eventLessons];
      const allLessonsYmd = Number((cancelledLessons[0] ?? replacements[0]).dateStr) || 0;
      const groupEMin = Math.min(Math.max(...lessons.map((l) => l.endMin)), allEnd);
      const isPast = calcIsPast(allLessonsYmd, groupEMin, nowYmd, nowMin);

      for (const repl of replacements) {
        appendLessonCell(
          bothInner,
          repl,
          { allStart, allEnd, totalMinutes, totalHeight },
          { ctx, escapeHtml, lessonConfig },
          { isPast, additionalClasses: ['split-left'] }
        );
      }

      for (const cancelled of cancelledLessons) {
        appendLessonCell(
          bothInner,
          cancelled,
          { allStart, allEnd, totalMinutes, totalHeight },
          { ctx, escapeHtml, lessonConfig },
          { isPast, additionalClasses: ['split-right'] }
        );
      }

      for (const lesson of lessons) {
        if (cancelledLessons.includes(lesson) || replacements.includes(lesson)) continue;
        renderSingleLesson(lesson);
      }
    };

    const renderSpanSplitGroup = (lessons, group) => {
      const { spanningLessons, subPeriodLessons, tcGroupEnd, tickerCandidates } = group;
      const tYmd = Number(spanningLessons[0].dateStr) || 0;
      const tEMin = Math.min(tcGroupEnd, allEnd);
      const isPast = calcIsPast(tYmd, tEMin, nowYmd, nowMin);

      for (const spanning of spanningLessons) {
        appendLessonCell(
          bothInner,
          spanning,
          { allStart, allEnd, totalMinutes, totalHeight },
          { ctx, escapeHtml, lessonConfig },
          { isPast, additionalClasses: ['split-left'] }
        );
      }

      for (const sub of subPeriodLessons) {
        appendLessonCell(
          bothInner,
          sub,
          { allStart, allEnd, totalMinutes, totalHeight },
          { ctx, escapeHtml, lessonConfig },
          { isPast, additionalClasses: ['split-right'] }
        );
      }

      for (const lesson of lessons) {
        if (tickerCandidates.includes(lesson)) continue;
        renderSingleLesson(lesson);
      }
    };

    for (const [, lessons] of timeSlotGroups.entries()) {
      if (!lessons || lessons.length === 0) continue;
      const group = classifyLessonRenderGroup(lessons);

      if (group.isTickerGroup) {
        renderTickerGroup(lessons, group);
        continue;
      }

      if (group.shouldUseSplitView) {
        renderSplitGroup(lessons, group);
        continue;
      }

      if (group.isSpanSplitLayout) {
        renderSpanSplitGroup(lessons, group);
        continue;
      }

      for (const lesson of lessons) {
        renderSingleLesson(lesson);
      }
    }
  }

  /**
   * Create absence overlay element
   * Visual indicator for absence periods (excused/unexcused)
   *
   * @param {Object} ctx - Main module context (provides translate)
   * @param {number} topPx - Top position in pixels
   * @param {number} heightPx - Height in pixels
   * @param {string} dateStr - Date string (YYYYMMDD)
   * @param {Object} absence - Absence object (reason, excused)
   * @returns {HTMLElement} Absence overlay div
   */
  function createAbsenceOverlay(ctx, topPx, heightPx, dateStr, absence) {
    const overlay = document.createElement('div');
    overlay.className = 'grid-absence-overlay';
    overlay.style.top = `${topPx}px`;
    overlay.style.height = `${heightPx}px`;
    overlay.setAttribute('data-date', dateStr);

    const excusedLabel = absence.excused ? ctx.translate('excused') : ctx.translate('unexcused');
    const reasonText = absence.reason || ctx.translate('no_reason');
    const absenceLabel = ctx.translate('absence_label');

    overlay.setAttribute('title', `${absenceLabel}: ${reasonText} (${excusedLabel})`);

    const icon = document.createElement('span');
    icon.className = 'absence-icon';
    icon.setAttribute('aria-hidden', 'true');
    overlay.appendChild(icon);

    if (absence.reason) {
      const reasonText = document.createElement('span');
      reasonText.className = 'absence-reason';
      reasonText.textContent = absence.reason;
      overlay.appendChild(reasonText);
    }

    return overlay;
  }

  /**
   * Renders semi-transparent overlays for each absence period
   * Clamps overlays to visible time range
   *
   * @param { HTMLElement } bothInner - Day column inner container
   * @param { Array } dayAbsences - Array of absence objects for this day
   * @param { number } allStart - Start time in minutes
   * @param { number } allEnd - End time in minutes
   * @param { number } totalHeight - Total height in pixels
   * @param { Object } ctx - Main module context
   */
  function addAbsenceOverlays(bothInner, dayAbsences, allStart, allEnd, totalHeight, ctx) {
    if (!Array.isArray(dayAbsences) || dayAbsences.length === 0) {
      return;
    }

    const totalMinutes = Math.max(1, allEnd - allStart);

    try {
      for (const absence of dayAbsences) {
        const placement = getVisibleTimeBlockPlacement(
          ctx._toMinutes(absence?.startTime),
          ctx._toMinutes(absence?.endTime),
          allStart,
          allEnd,
          totalMinutes,
          totalHeight
        );

        if (!placement) {
          continue;
        }

        const dateStr = String(absence?.date || '');

        const overlay = createAbsenceOverlay(ctx, placement.topPx, placement.heightPx, dateStr, absence);
        bothInner.appendChild(overlay);
      }
    } catch (e) {
      log('debug', 'failed to render absence overlays', e);
    }
  }

  /**
   * Render grid/calendar widget for a single student
   * Main entry point for grid rendering
   *
   * Workflow:
   * 1. Validate and extract configuration (week view / custom range)
   * 2. Calculate time range (vertical axis)
   * 3. Create header with day labels
   * 4. Create time axis with period/hour labels
   * 5. For each day:
   *    - Extract and normalize lessons
   *    - Filter by max periods / time cutoff
   *    - Render lesson cells (full-width / ticker / split view)
   *    - Add absence overlays
   *    - Add holiday / no-lessons notices
   * 6. Initialize now-line updater
   *
   * @param {Object} ctx - Main module context
   * @param {string} studentTitle - Student name
   * @param {Object} studentConfig - Student-specific configuration
   * @param {Array} timetable - Array of lesson objects
   * @param {Array} timeUnits - Array of time unit objects (periods)
   * @param {Array} absences - Array of absence objects
   * @returns {HTMLElement} Grid widget wrapper element
   */
  function renderGridForStudent(ctx, studentTitle, studentConfig, timetable, timeUnits, absences) {
    const config = validateAndExtractGridConfig(ctx, studentConfig);
    const timeRange = calculateTimeRange(timetable, timeUnits, ctx);
    let { allStart, allEnd } = timeRange;
    allEnd = applyMaxLessonsLimit(allStart, allEnd, config.maxGridLessons, timeUnits);

    const totalMinutes = allEnd - allStart;
    const totalHeight = Math.max(120, Math.round(totalMinutes * config.pxPerMinute));
    const baseDate = getBaseDateFromYmd(ctx._currentTodayYmd, ctx);
    const todayDateStr = formatDateKey(baseDate);
    const hasLessonsForDate = (dateKey) => getSourceLessonsForDay(ctx, studentTitle, timetable, dateKey).length > 0;
    const displayDates = config.weekView
      ? Array.from({ length: config.totalDisplayDays }, (_, index) => {
          const dayOffset = config.startOffset + index;
          return new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayOffset);
        })
      : buildRollingDisplayDates(baseDate, config, hasLessonsForDate);
    const wrapper = document.createElement('div');

    const widgetCtx = createWidgetContext('grid', studentConfig, root.util || {}, ctx);
    if (widgetCtx.isVerbose && studentTitle && typeof addHeader === 'function') {
      const headerContainer = document.createElement('div');
      headerContainer.className = 'wu-widget-container bright small light';
      addHeader(headerContainer, buildWidgetHeaderTitle(ctx, 'grid', widgetCtx, studentTitle));
      wrapper.appendChild(headerContainer);
    }

    const { header, gridTemplateColumns } = createGridHeader(displayDates, config.gridDateFormat, ctx, {
      formatDisplayDate,
      formatDisplayTime,
      toMinutesSinceMidnight,
    });

    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-combined';
    grid.style.gridTemplateColumns = gridTemplateColumns;
    const timeAxis = createTimeAxis(timeUnits, allStart, allEnd, totalHeight, totalMinutes, ctx);
    grid.appendChild(timeAxis);

    displayDates.forEach((targetDate, dayIndex) => {
      renderGridDayColumn({
        grid,
        ctx,
        studentTitle,
        studentConfig,
        timetable,
        timeUnits,
        absences,
        targetDate,
        todayDateStr,
        allStart,
        allEnd,
        totalMinutes,
        totalHeight,
        dayIndex,
        maxGridLessons: config.maxGridLessons,
      });
    });

    wrapper.appendChild(grid);

    scheduleGridPostRenderUpdates(ctx, wrapper);

    return wrapper;
  }

  /**
   * Refresh past lesson masks
   * Updates "past" CSS class on lesson cells based on current time
   * Handles both regular lesson cells and ticker animations
   * Called by now-line updater every minute and initially after rendering
   *
   * @param {Object} ctx - Main module context (provides _currentTodayYmd)
   * @param {HTMLElement} rootEl - Root element to search (defaults to document)
   */
  function refreshPastMasks(ctx, rootEl = null) {
    try {
      if (!ctx) return;
      const nowContext = getModuleDateContext(ctx);
      const nowLocal = nowContext.date;
      const todayYmd = typeof ctx._currentTodayYmd === 'number' && ctx._currentTodayYmd ? ctx._currentTodayYmd : nowContext.ymd;
      const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;

      const getElementPastState = (element) => {
        const dateValue = element?.getAttribute?.('data-date');
        if (!dateValue) return null;
        const rawEndMin = element.getAttribute('data-end-min');
        const endMin = rawEndMin !== null && rawEndMin !== undefined ? Number(rawEndMin) : NaN;
        return calcIsPast(Number(dateValue) || 0, endMin, todayYmd, nowMin);
      };

      const togglePastClass = (element, isPast) => {
        if (!element?.classList || typeof isPast !== 'boolean') return;
        if (isPast) element.classList.add('past');
        else element.classList.remove('past');
      };

      const lessons = scope.querySelectorAll('.grid-combined .grid-lesson');
      lessons.forEach((ln) => {
        togglePastClass(ln, getElementPastState(ln));
      });

      const tickers = scope.querySelectorAll('.grid-combined .lesson-ticker-wrapper');
      tickers.forEach((ticker) => {
        const isPast = getElementPastState(ticker);

        // Update only top-level lesson cells within ticker.
        // Nested `.lesson-content` nodes from makeLessonInnerHTML() must not receive
        // `past`, otherwise a second pseudo-overlay is rendered in the inner content area.
        const lessonDivs = Array.from(ticker.querySelectorAll('.lesson-content')).filter((div) => div.style.position === 'absolute');
        lessonDivs.forEach((div) => {
          togglePastClass(div, isPast);
        });
      });
    } catch (e) {
      log('warn', 'failed to refresh past masks', e);
    }
  }

  /**
   * Update now-line position for all day columns
   * Shows now-line only for today's column
   * Hides now-line if showNowLine config is false
   * Called by now-line updater every minute
   *
   * @param {Object} ctx - Main module context (provides studentConfig + defaults)
   * @param {HTMLElement} rootEl - Root element to search (defaults to document)
   * @returns {number} Number of now-lines updated
   */
  function updateNowLinesAll(ctx, rootEl = null) {
    try {
      if (!ctx) return;
      const showNowLine = getWidgetConfigResolved(ctx.studentConfig, ctx, 'grid', 'showNowLine');
      if (showNowLine === false) {
        const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
        const inners = scope.querySelectorAll('.day-column-inner');
        inners.forEach((inner) => {
          const nl = inner._nowLine;
          if (nl) nl.style.display = 'none';
        });
        return 0;
      }
      const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;
      const inners = scope.querySelectorAll('.day-column-inner');
      const nowLocal = getModuleDateContext(ctx).date;
      const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      let updated = 0;
      inners.forEach((inner) => {
        if (!inner.classList?.contains('is-today')) {
          const nl = inner._nowLine;
          if (nl) nl.style.display = 'none';
          return;
        }
        const nl = inner._nowLine;
        const allS = inner._allStart;
        const allE = inner._allEnd;
        const h = inner._totalHeight;
        if (!nl || allS === undefined || allE === undefined || h === undefined) return;
        if (nowMin < allS || nowMin >= allE) {
          nl.style.display = 'none';
          return;
        }
        nl.style.display = 'block';
        const top = Math.round(((nowMin - allS) / (allE - allS)) * h);
        nl.style.top = `${top}px`;
        updated++;
      });
      return updated;
    } catch (e) {
      log('warn', 'updateNowLinesAll failed', e);
      return 0;
    }
  }

  root.grid = {
    refreshPastMasks,
    updateNowLinesAll,
    startNowLineUpdater,
    stopNowLineUpdater,
  };

  host.registerFrontendPlugin({
    id: 'grid',
    hostApiVersion: 1,

    create(pluginContext) {
      return {
        render(renderContext) {
          const section = document.createElement('section');
          section.className = 'wu-plugin wu-plugin-grid';
          const students = Array.isArray(renderContext?.students) ? renderContext.students : [];
          let renderedContainers = 0;

          for (const studentSlice of students) {
            const studentConfig = resolveStudentConfig(studentSlice);
            const gridConfig = resolveGridConfig(studentConfig);
            const effectiveStudentConfig = buildEffectiveGridStudentConfig(studentConfig, gridConfig);
            const lessons = Array.isArray(studentSlice?.data?.lessons) ? studentSlice.data.lessons : [];
            const timeUnits = Array.isArray(studentSlice?.data?.timeUnits) ? studentSlice.data.timeUnits : [];
            const absences = Array.isArray(studentSlice?.data?.absences) ? studentSlice.data.absences : [];
            const holidays = Array.isArray(studentSlice?.data?.holidays?.ranges) ? studentSlice.data.holidays.ranges : [];
            const dayNotices = Array.isArray(studentSlice?.data?.dayNotices) ? studentSlice.data.dayNotices : [];

            if (timeUnits.length === 0 && holidays.length === 0 && dayNotices.length === 0 && lessons.length === 0) {
              continue;
            }

            const pluginRuntimeContext = createGridPluginRuntimeContext(pluginContext, renderContext, studentSlice, effectiveStudentConfig);
            const studentTitle = String(studentSlice?.student?.title || '').trim();
            const gridElement = renderGridForStudent(
              pluginRuntimeContext,
              studentTitle,
              effectiveStudentConfig,
              lessons,
              timeUnits,
              absences
            );

            if (gridElement) {
              section.appendChild(gridElement);
              renderedContainers += 1;
            }
          }

          return renderedContainers > 0 ? section : null;
        },
      };
    },
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
