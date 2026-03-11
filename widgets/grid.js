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
 * WeakMap to store now-line updater state per module instance
 * Prevents memory leaks by using WeakMap (automatic cleanup when ctx is GC'd)
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

(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
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
    isIrregularStatus,
    getChangedFieldSet,
    getFirstFieldName,
  } = root.util?.resolveWidgetHelpers?.(root) || {};

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
    const hasTeacher = lesson?.te && lesson.te.length > 0;
    const hasSubject = lesson?.su && lesson.su.length > 0;
    const hasRoom = lesson?.ro && lesson.ro.length > 0;
    const hasClass = lesson?.cl && lesson.cl.length > 0;
    const hasStudentGroup = lesson?.sg && lesson.sg.length > 0;

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
  function resolveFieldConfig(config, ctx) {
    const gridConfig = config?.grid?.fields || {};
    const defaultFields = ctx?.defaults?.grid?.fields || {};
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
        const nowLocal = new Date();
        const realNowYmd = nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
        const isDebugMode = ctx.config && typeof ctx.config.debugDate === 'string' && ctx.config.debugDate;
        if (!isDebugMode) {
          if (ctx._currentTodayYmd === undefined) ctx._currentTodayYmd = realNowYmd;
          if (realNowYmd !== ctx._currentTodayYmd) {
            try {
              if (typeof ctx._sendFetchData === 'function') {
                ctx._sendFetchData('date-change');
              } else {
                ctx.sendSocketNotification('FETCH_DATA', ctx.config);
              }
            } catch {
              return;
            }
            try {
              ctx.updateDom();
            } catch {
              return;
            }
            ctx._currentTodayYmd = realNowYmd;
          }
        }

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

    const now = new Date();
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
        baseDate = new Date();
      }

      const dayOfWeek = baseDate.getDay();
      const currentHour = new Date().getHours();
      const currentMinute = new Date().getMinutes();

      let weekOffset = 0;
      if (dayOfWeek === 5) {
        const isDebugMode = ctx.config && typeof ctx.config.debugDate === 'string' && ctx.config.debugDate;
        if (!isDebugMode && (currentHour >= 16 || (currentHour === 15 && currentMinute >= 45))) {
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

    if (!isFinite(allStart) || allEnd <= allStart) {
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
  function createGridHeader(totalDisplayDays, baseDate, startOffset, gridDateFormat, ctx, { formatDisplayDate }) {
    const header = document.createElement('div');
    header.className = 'grid-days-header';

    const cols = ['minmax(80px,auto)'];
    for (let d = 0; d < totalDisplayDays; d++) {
      cols.push('1fr');
    }
    header.style.gridTemplateColumns = cols.join(' ');

    const emptyHeader = document.createElement('div');
    emptyHeader.className = 'grid-days-header-empty';
    header.appendChild(emptyHeader);

    for (let d = 0; d < totalDisplayDays; d++) {
      const dayIndex = startOffset + d;
      const dayDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
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
        lab.style.fontSize = '0.85em';
        lab.style.color = '#666';
        lab.style.textAlign = 'left';

        const periodLabel = ctx.translate('period') || '';
        const periodSuffix = periodLabel ? `${periodLabel}` : '';
        lab.innerText = `${u.name}.${periodSuffix}\n${String(u.startTime)
          .padStart(4, '0')
          .replace(/(\d{2})(\d{2})/, '$1:$2')}`;
        timeInner.appendChild(lab);

        if (lineMin !== undefined && lineMin !== null && lineMin >= allStart && lineMin <= allEnd) {
          const lineTop = Math.round(((lineMin - allStart) / totalMinutes) * totalHeight);
          const tline = document.createElement('div');
          tline.className = 'grid-hourline';
          tline.style.top = `${lineTop - 2}px`;
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
      // Without the spread, any new field added to payloadCompactor.js/schemas.lesson
      // would silently vanish here and never reach makeLessonInnerHTML().
      return {
        ...el,
        dateStr: String(el.date),
        startMin: ctx._toMinutes(el.startTime),
        endMin: el.endTime ? ctx._toMinutes(el.endTime) : null,
        startTime: el.startTime ? String(el.startTime).padStart(4, '0') : '',
        endTime: el.endTime ? String(el.endTime).padStart(4, '0') : null,
        subjectShort: getSubject ? getSubject(el, 'short') : el.su?.[0]?.name || el.su?.[0]?.longname || 'N/A',
        subject: getSubject ? getSubject(el, 'long') : el.su?.[0]?.longname || el.su?.[0]?.name || 'N/A',
        teacherInitial: getTeachers ? getTeachers(el, 'short')[0] : el.te?.[0]?.name || el.te?.[0]?.longname || 'N/A',
        teacher: getTeachers ? getTeachers(el, 'long')[0] : el.te?.[0]?.longname || el.te?.[0]?.name || 'N/A',
        room: getRoom ? getRoom(el, 'short') : el.ro?.[0]?.name || el.ro?.[0]?.longname || '',
        roomLong: getRoom ? getRoom(el, 'long') : el.ro?.[0]?.longname || el.ro?.[0]?.name || '',
        class: getClass ? getClass(el, 'short') : el.cl?.[0]?.name || el.cl?.[0]?.longname || '',
        classLong: getClass ? getClass(el, 'long') : el.cl?.[0]?.longname || el.cl?.[0]?.name || '',
        studentGroup: getStudentGroup ? getStudentGroup(el, 'short') : el.sg?.[0]?.name || el.sg?.[0]?.longname || '',
        studentGroupLong: getStudentGroup ? getStudentGroup(el, 'long') : el.sg?.[0]?.longname || el.sg?.[0]?.name || '',
        infoShort: getInfo ? getInfo(el, 'short') : el.info?.[0]?.name || el.info?.[0]?.longname || '',
        infoLong: getInfo ? getInfo(el, 'long') : el.info?.[0]?.longname || el.info?.[0]?.name || '',
        isTeacherView: displayMode.isTeacherView,
        isStudentView: displayMode.isStudentView,
        code: el.code || '',
        substText: el.substText || '',
        text: el.lstext || '',
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
          line.style.top = `${top - 2}px`;
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
        lesson.status === 'CHANGED' && changedFields.size > 0 && [...changedFields].every((f) => f === 'te' || f === 'ro');
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
   * Supports two display modes:
   * 1. Flexible field configuration (grid.fields.{primary, secondary, additional})
   * 2. Legacy fallback (subject + teacher/class + room)
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
      return `<div class='lesson-content break-supervision'><span class='lesson-primary'><span class='lesson-inline-icon lesson-break-supervision-icon' aria-hidden='true'></span>${escapeHtml(displayText)}</span></div>`;
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

    const naText = String(lessonConfig?.grid?.naText ?? ctx?.defaults?.grid?.naText ?? 'N/A');

    if (ctx) {
      try {
        const displayParts = buildFlexibleLessonDisplay(lesson, lessonConfig || ctx?.config, { ctx });

        let primaryHtml;
        if (changedFields.has('su')) {
          const newSubject = lesson.su?.[0]?.name || '';
          const oldSubject = getFirstFieldName(lesson.suOld);
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
        if (changedFields.has('te')) {
          const newTeacher = lesson.te?.[0]?.name || '';
          const oldTeacher = getFirstFieldName(lesson.teOld);
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
        if (changedFields.has('ro')) {
          const newRoom = lesson.ro?.[0]?.name || '';
          const oldRoom = getFirstFieldName(lesson.roOld);
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

        const subst = lesson.substText
          ? `<span class='lesson-substitution-text'>${escapeHtml(lesson.substText).replace(/\n/g, '<br>')}</span>`
          : '';
        const txt = lesson.text ? `<span class='lesson-info-text'>${escapeHtml(lesson.text).replace(/\n/g, '<br>')}</span>` : '';

        const secondaryLine =
          secondaryHtml || additionalHtml ? `<span class='lesson-secondary'>${secondaryHtml}${additionalHtml}</span>` : '';

        return `<div class='${lessonContentClass}'>${iconsHtml}<span class='lesson-primary'>${primaryHtml}</span>${secondaryLine}${subst}${txt}</div>`;
      } catch {
        void 0;
      }
    }

    const subject = escapeHtml(lesson.subjectShort || lesson.subject);
    let secondaryInfo = '';
    if (lesson.isTeacherView && lesson.class) {
      secondaryInfo = escapeHtml(lesson.class);
    } else if (lesson.teacher && lesson.teacher !== 'N/A') {
      secondaryInfo = escapeHtml(lesson.teacherInitial || lesson.teacher);
    }

    let roomInfo = '';
    if (lesson.room && lesson.room !== '') {
      roomInfo = ` <span class='lesson-room'>(${escapeHtml(lesson.room)})</span>`;
    }

    const subst = lesson.substText
      ? `<br><span class='lesson-substitution-text'>${escapeHtml(lesson.substText).replace(/\n/g, '<br>')}</span>`
      : '';
    const txt = lesson.text ? `<br><span class='lesson-info-text'>${escapeHtml(lesson.text).replace(/\n/g, '<br>')}</span>` : '';
    const secondaryLine = secondaryInfo ? `<br><span class='lesson-secondary'>${secondaryInfo}${roomInfo}</span>` : '';

    return `<div class='${lessonContentClass}'>${iconsHtml}<span class='lesson-primary'>${subject}</span>${secondaryLine}${subst}${txt}</div>`;
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
    if (cell && cell.innerHTML) {
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
  function createTickerAnimation(lessons, topPx, heightPx, container, ctx, escapeHtml, isPast, nowYmd, nowMin, tickerData, lessonConfig) {
    const getSubjectName = (lesson) => {
      if (lesson.su && lesson.su.length > 0) {
        return lesson.su[0].name || lesson.su[0].longname;
      }
      return null;
    };

    const getStudentGroupName = (lesson) => {
      if (lesson.sg && lesson.sg.length > 0) {
        return lesson.sg[0].name || lesson.sg[0].longname;
      }
      return null;
    };

    const getClassName = (lesson) => {
      if (lesson.cl && lesson.cl.length > 0) {
        return lesson.cl[0].name || lesson.cl[0].longname;
      }
      return null;
    };

    const subjectGroups = new Map();
    for (let index = 0; index < lessons.length; index++) {
      const lesson = lessons[index];
      const subject = getSubjectName(lesson);
      const studentGroup = getStudentGroupName(lesson);
      const className = getClassName(lesson);

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
    if (tickerData && tickerData.hasSplitView && tickerData.cancelledLessons.length > 0) {
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
    const studentGroups = Array.isArray(lesson?.sg) ? lesson.sg : [];
    const classes = Array.isArray(lesson?.cl) ? lesson.cl : [];
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
  function getBaseDateFromYmd(currentTodayYmd) {
    if (!currentTodayYmd) {
      return new Date();
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
    return `${date.getFullYear()}${('0' + (date.getMonth() + 1)).slice(-2)}${('0' + date.getDate()).slice(-2)}`;
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
    holiday,
    bothInner,
    totalHeight,
    allStart,
    allEnd,
    totalMinutes,
    ctx,
    studentConfig,
  }) {
    if (!Array.isArray(lessonsToRender) || lessonsToRender.length === 0) {
      if (!holiday) {
        addDayNotice(bothInner, totalHeight, 'no-lessons', `<b>${ctx.translate('no-lessons')}</b>`, '1.5em');
      }
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
    baseDate,
    todayDateStr,
    config,
    allStart,
    allEnd,
    totalMinutes,
    totalHeight,
    dayOffset,
  }) {
    const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayOffset);
    const dayYmdStr = formatDateKey(targetDate);
    const sourceForDay = getSourceLessonsForDay(ctx, studentTitle, timetable, dayYmdStr);

    let dayLessons = extractDayLessons(sourceForDay, ctx);
    dayLessons = validateAndNormalizeLessons(dayLessons, log);

    const lessonsToRender = filterLessonsByMaxPeriods(dayLessons, config.maxGridLessons, timeUnits, studentTitle, dayYmdStr, ctx, allEnd);
    const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[Number(dayYmdStr)] || null;
    const hiddenCount = dayLessons.length - lessonsToRender.length;
    const col = 2 + dayOffset - config.startOffset;
    const { bothWrap, bothInner } = createDayColumnWrapper(col, totalHeight, dayYmdStr === todayDateStr);

    if (holiday) {
      addDayNotice(bothInner, totalHeight, 'holiday', escapeHtml(holiday.longName || holiday.name), '2em');
    }

    grid.appendChild(bothWrap);
    addHourLinesToColumn(bothInner, timeUnits, allStart, allEnd, totalMinutes, totalHeight);
    addNowLineToColumn(bothInner, allStart, allEnd, totalHeight);

    if (hiddenCount > 0) {
      addMoreBadge(bothInner, hiddenCount, ctx);
    }

    renderDayLessonsOrNotice({
      lessonsToRender,
      holiday,
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

    let nowYmd = ctx._currentTodayYmd;
    if (nowYmd === undefined || nowYmd === null) {
      const d = new Date();
      nowYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    /** Render a single lesson as a standalone full-width cell at its own time position. */
    const renderSingleLesson = (lesson) => {
      const lS = Math.max(lesson.startMin, allStart);
      const lE = Math.min(lesson.endMin, allEnd);
      if (lE <= lS) return;

      const topPx = Math.round(((lS - allStart) / totalMinutes) * totalHeight);
      const heightPx = Math.max(12, Math.round(((lE - lS) / totalMinutes) * totalHeight));
      const ymd = Number(lesson.dateStr) || 0;

      const cell = createLessonCell(topPx, heightPx, lesson.dateStr, lE);
      applyLessonClasses(cell, lesson, { hasExam: lessonHasExam(lesson), isPast: calcIsPast(ymd, lE, nowYmd, nowMin) });
      cell.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx, lessonConfig);
      if (checkHomeworkMatch(lesson)) addHomeworkIcon(cell);
      bothInner.appendChild(cell);
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

      if (tickerEnd > tickerStart) {
        const tickerTop = Math.round(((tickerStart - allStart) / totalMinutes) * totalHeight);
        const tickerHeight = Math.max(12, Math.round(((tickerEnd - tickerStart) / totalMinutes) * totalHeight));
        createTickerAnimation(
          tickerCandidates,
          tickerTop,
          tickerHeight,
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
        const rS = Math.max(repl.startMin, allStart);
        const rE = Math.min(repl.endMin, allEnd);
        if (rE <= rS) continue;
        const rTop = Math.round(((rS - allStart) / totalMinutes) * totalHeight);
        const rH = Math.max(12, Math.round(((rE - rS) / totalMinutes) * totalHeight));
        const cell = createLessonCell(rTop, rH, repl.dateStr, rE);
        applyLessonClasses(cell, repl, { hasExam: lessonHasExam(repl), isPast, additionalClasses: ['split-left'] });
        cell.innerHTML = makeLessonInnerHTML(repl, escapeHtml, ctx, lessonConfig);
        if (checkHomeworkMatch(repl)) addHomeworkIcon(cell);
        bothInner.appendChild(cell);
      }

      for (const cancelled of cancelledLessons) {
        const cS = Math.max(cancelled.startMin, allStart);
        const cE = Math.min(cancelled.endMin, allEnd);
        if (cE <= cS) continue;
        const cTop = Math.round(((cS - allStart) / totalMinutes) * totalHeight);
        const cH = Math.max(12, Math.round(((cE - cS) / totalMinutes) * totalHeight));
        const cell = createLessonCell(cTop, cH, cancelled.dateStr, cE);
        applyLessonClasses(cell, cancelled, {
          hasExam: lessonHasExam(cancelled),
          isPast,
          additionalClasses: ['split-right'],
        });
        cell.innerHTML = makeLessonInnerHTML(cancelled, escapeHtml, ctx, lessonConfig);
        if (checkHomeworkMatch(cancelled)) addHomeworkIcon(cell);
        bothInner.appendChild(cell);
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
        const sS = Math.max(spanning.startMin, allStart);
        const sE = Math.min(spanning.endMin, allEnd);
        if (sE <= sS) continue;
        const sTop = Math.round(((sS - allStart) / totalMinutes) * totalHeight);
        const sH = Math.max(12, Math.round(((sE - sS) / totalMinutes) * totalHeight));
        const cell = createLessonCell(sTop, sH, spanning.dateStr, sE);
        applyLessonClasses(cell, spanning, { hasExam: lessonHasExam(spanning), isPast, additionalClasses: ['split-left'] });
        cell.innerHTML = makeLessonInnerHTML(spanning, escapeHtml, ctx, lessonConfig);
        if (checkHomeworkMatch(spanning)) addHomeworkIcon(cell);
        bothInner.appendChild(cell);
      }

      for (const sub of subPeriodLessons) {
        const sS = Math.max(sub.startMin, allStart);
        const sE = Math.min(sub.endMin, allEnd);
        if (sE <= sS) continue;
        const sTop = Math.round(((sS - allStart) / totalMinutes) * totalHeight);
        const sH = Math.max(12, Math.round(((sE - sS) / totalMinutes) * totalHeight));
        const cell = createLessonCell(sTop, sH, sub.dateStr, sE);
        applyLessonClasses(cell, sub, { hasExam: lessonHasExam(sub), isPast, additionalClasses: ['split-right'] });
        cell.innerHTML = makeLessonInnerHTML(sub, escapeHtml, ctx, lessonConfig);
        if (checkHomeworkMatch(sub)) addHomeworkIcon(cell);
        bothInner.appendChild(cell);
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
        const startMin = ctx._toMinutes(absence?.startTime) || 0;
        const endMin = ctx._toMinutes(absence?.endTime) || 0;

        if (startMin >= allEnd || endMin <= allStart) {
          continue;
        }

        const clampedStart = Math.max(startMin, allStart);
        const clampedEnd = Math.min(endMin, allEnd);

        if (clampedStart >= clampedEnd) {
          continue;
        }

        const topPx = Math.round(((clampedStart - allStart) / totalMinutes) * totalHeight);
        const heightPx = Math.round(((clampedEnd - clampedStart) / totalMinutes) * totalHeight);
        const dateStr = String(absence?.date || '');

        const overlay = createAbsenceOverlay(ctx, topPx, heightPx, dateStr, absence);
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
    const baseDate = getBaseDateFromYmd(ctx._currentTodayYmd);
    const todayDateStr = formatDateKey(baseDate);
    const wrapper = document.createElement('div');

    const widgetCtx = createWidgetContext('grid', studentConfig, root.util || {}, ctx);
    if (widgetCtx.isVerbose && studentTitle && typeof addHeader === 'function') {
      const headerContainer = document.createElement('div');
      headerContainer.className = 'wu-widget-container bright small light';
      addHeader(headerContainer, buildWidgetHeaderTitle(ctx, 'grid', widgetCtx, studentTitle));
      wrapper.appendChild(headerContainer);
    }

    const { header, gridTemplateColumns } = createGridHeader(
      config.totalDisplayDays,
      baseDate,
      config.startOffset,
      config.gridDateFormat,
      ctx,
      { formatDisplayDate, formatDisplayTime, toMinutesSinceMidnight }
    );

    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-combined';
    grid.style.gridTemplateColumns = gridTemplateColumns;
    const timeAxis = createTimeAxis(timeUnits, allStart, allEnd, totalHeight, totalMinutes, ctx);
    grid.appendChild(timeAxis);

    for (let d = 0; d < config.totalDisplayDays; d++) {
      renderGridDayColumn({
        grid,
        ctx,
        studentTitle,
        studentConfig,
        timetable,
        timeUnits,
        absences,
        baseDate,
        todayDateStr,
        config,
        allStart,
        allEnd,
        totalMinutes,
        totalHeight,
        dayOffset: config.startOffset + d,
      });
    }

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
      const nowLocal = new Date();
      const todayYmd =
        typeof ctx._currentTodayYmd === 'number' && ctx._currentTodayYmd
          ? ctx._currentTodayYmd
          : nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
      const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      const scope = rootEl && typeof rootEl.querySelectorAll === 'function' ? rootEl : document;

      const lessons = scope.querySelectorAll('.grid-combined .grid-lesson');
      lessons.forEach((ln) => {
        const ds = ln.getAttribute('data-date');
        const de = ln.getAttribute('data-end-min');
        if (!ds) return;
        const lessonYmd = Number(ds) || 0;
        const endMin = de !== null && de !== undefined ? Number(de) : NaN;
        let isPast = false;
        if (lessonYmd < todayYmd) {
          isPast = true;
        } else if (lessonYmd === todayYmd) {
          if (!Number.isNaN(endMin) && endMin <= nowMin) isPast = true;
        }
        if (isPast) ln.classList.add('past');
        else ln.classList.remove('past');
      });

      const tickers = scope.querySelectorAll('.grid-combined .lesson-ticker-wrapper');
      tickers.forEach((ticker) => {
        const ds = ticker.getAttribute('data-date');
        const de = ticker.getAttribute('data-end-min');
        if (!ds) return;
        const lessonYmd = Number(ds) || 0;
        const endMin = de !== null && de !== undefined ? Number(de) : NaN;
        let isPast = false;
        if (lessonYmd < todayYmd) {
          isPast = true;
        } else if (lessonYmd === todayYmd) {
          if (!Number.isNaN(endMin) && endMin <= nowMin) isPast = true;
        }

        // Update only top-level lesson cells within ticker.
        // Nested `.lesson-content` nodes from makeLessonInnerHTML() must not receive
        // `past`, otherwise a second pseudo-overlay is rendered in the inner content area.
        const lessonDivs = Array.from(ticker.querySelectorAll('.lesson-content')).filter((div) => div.style.position === 'absolute');
        lessonDivs.forEach((div) => {
          if (isPast) div.classList.add('past');
          else div.classList.remove('past');
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
      const nowLocal = new Date();
      const nowMin = nowLocal.getHours() * 60 + nowLocal.getMinutes();
      let updated = 0;
      inners.forEach((inner) => {
        if (!inner.classList || !inner.classList.contains('is-today')) {
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
    renderGridForStudent,
    refreshPastMasks,
    updateNowLinesAll,
    startNowLineUpdater,
    stopNowLineUpdater,
  };
})();
