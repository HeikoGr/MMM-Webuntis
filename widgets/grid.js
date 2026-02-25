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

(function () {
  const root = window.MMMWebuntisWidgets || (window.MMMWebuntisWidgets = {});
  const {
    log,
    escapeHtml,
    addHeader,
    getWidgetConfig,
    formatDate,
    formatTime,
    toMinutes,
    createWidgetContext,
    getTeachers,
    getSubject,
    getRoom,
    getClass,
    getStudentGroup,
    getInfo,
  } = root.util?.initWidget?.(root) || {};

  // ============================================================================
  // Grid-specific helper functions (moved from util.js)
  // ============================================================================

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
   * @param {Object} config - Student configuration object
   * @returns {Object} Resolved field configuration with defaults:
   *   - primary: string - Primary field type (default: 'subject')
   *   - secondary: string - Secondary field type (default: 'teacher')
   *   - additional: string[] - Additional field types (default: ['room'])
   *   - format: Object - Name format per field type (default: 'short')
   */
  function resolveFieldConfig(config) {
    const gridConfig = config?.grid?.fields || {};
    return {
      primary: gridConfig.primary || 'subject',
      secondary: gridConfig.secondary || 'teacher',
      additional: gridConfig.additional || ['room'],
      format: gridConfig.format || {
        subject: 'short',
        teacher: 'short',
        class: 'short',
        room: 'short',
        studentGroup: 'short',
        info: 'short',
      },
    };
  }

  /**
   * Check if lesson status is "irregular" (substitution/replacement/additional)
   * Based on REST API status values mapping to legacy codes
   *
   * @param {string} status - REST API status code
   * @returns {boolean} True if status represents irregular lesson
   *
   * Irregular statuses:
   * - 'ADDITIONAL', 'CHANGED', 'SUBSTITUTION', 'SUBSTITUTE' → replacement/additional lesson
   */

  function isIrregularStatus(status) {
    const upperStatus = String(status || '').toUpperCase();
    return ['ADDITIONAL', 'CHANGED', 'SUBSTITUTION', 'SUBSTITUTE'].includes(upperStatus);
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
    const fieldConfig = resolveFieldConfig(config);
    const { includeAdditional = true } = options;

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

  // ============================================================================
  // Now line updater
  // ============================================================================

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
        // Calculate real date (not affected by debugDate)
        const realNowYmd = nowLocal.getFullYear() * 10000 + (nowLocal.getMonth() + 1) * 100 + nowLocal.getDate();
        // Only refresh data if debugDate is NOT set (i.e., using real time) and the day has changed
        const isDebugMode = ctx.config && typeof ctx.config.debugDate === 'string' && ctx.config.debugDate;
        if (!isDebugMode) {
          if (ctx._currentTodayYmd === undefined) ctx._currentTodayYmd = realNowYmd;
          if (realNowYmd !== ctx._currentTodayYmd) {
            try {
              // Use the debounced _sendFetchData if available, otherwise direct socket call
              if (typeof ctx._sendFetchData === 'function') {
                ctx._sendFetchData('date-change');
              } else {
                ctx.sendSocketNotification('FETCH_DATA', ctx.config);
              }
            } catch {
              // ignore
            }
            try {
              ctx.updateDom();
            } catch {
              // ignore
            }
            ctx._currentTodayYmd = realNowYmd;
          }
        }

        const gridWidget = ctx._getWidgetApi()?.grid;
        if (gridWidget) {
          if (typeof gridWidget.updateNowLinesAll === 'function') gridWidget.updateNowLinesAll(ctx);
          if (typeof gridWidget.refreshPastMasks === 'function') gridWidget.refreshPastMasks(ctx);
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

  // ============================================================================
  // CONFIGURATION & VALIDATION
  // ============================================================================

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
    // Read widget-specific config (defaults already applied by MMM-Webuntis.js)
    const weekView = getWidgetConfig(studentConfig, 'grid', 'weekView') ?? false;
    const configuredNext = getWidgetConfig(studentConfig, 'grid', 'nextDays') ?? 3;
    const configuredPast = getWidgetConfig(studentConfig, 'grid', 'pastDays') ?? 0;
    const gridDateFormat = getWidgetConfig(studentConfig, 'grid', 'dateFormat') ?? 'EEE dd.MM.';
    const maxGridLessons = Math.max(0, Math.floor(Number(getWidgetConfig(studentConfig, 'grid', 'maxLessons') ?? 0)));

    let daysToShow, pastDays, startOffset, totalDisplayDays;

    if (weekView) {
      // Calendar week view (Monday-Friday)
      // Use debugDate if configured, otherwise current date
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

      const dayOfWeek = baseDate.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const currentHour = new Date().getHours();
      const currentMinute = new Date().getMinutes();

      // Determine if we should show current week or next week
      let weekOffset = 0;
      if (dayOfWeek === 5) {
        // Friday - only advance to next week if in real-time mode (no debugDate) and after 16:00
        const isDebugMode = ctx.config && typeof ctx.config.debugDate === 'string' && ctx.config.debugDate;
        if (!isDebugMode && (currentHour >= 16 || (currentHour === 15 && currentMinute >= 45))) {
          weekOffset = 1; // Show next week
        }
        // In debug mode on Friday, show current week (Mon-Fri including Friday)
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        // Saturday or Sunday - show next week
        weekOffset = 1;
      }

      // Calculate offset to Monday of target week
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sunday needs special handling
      startOffset = daysToMonday + weekOffset * 7;
      totalDisplayDays = 5; // Monday to Friday
      daysToShow = totalDisplayDays - 1; // Used for some calculations
      pastDays = 0;
    } else {
      // Standard view with configurable nextDays/pastDays
      daysToShow = configuredNext && Number(configuredNext) > 0 ? parseInt(configuredNext, 10) : 3;
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
      weekView,
    };
  }

  // ============================================================================
  // TIME AXIS CALCULATION
  // ============================================================================

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
      // Calculate range from timeUnits first
      timeUnits.forEach((u) => {
        if (u.startMin !== undefined && u.startMin !== null) allStart = Math.min(allStart, u.startMin);
        if (u.endMin !== undefined && u.endMin !== null) allEnd = Math.max(allEnd, u.endMin);
      });

      // Also check timetable entries that fall outside timeUnits range
      // (e.g., early morning supervision before first period, late activities after last period)
      (Array.isArray(timetable) ? timetable : []).forEach((el) => {
        const s = ctx._toMinutes(el.startTime);
        const e = el.endTime ? ctx._toMinutes(el.endTime) : null;
        if (s !== null && s !== undefined && e !== null && e !== undefined) {
          // Only expand range for entries outside current bounds (prevents excessive expansion)
          if (s < allStart || e > allEnd) {
            // Sanity check: ignore unreasonably long entries (>12 hours)
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

      // Make sure cutoff includes the full timeUnit (go to the next unit's start if available)
      if (
        cutoff !== undefined &&
        cutoff !== null &&
        targetIndex + 1 < timeUnits.length &&
        timeUnits[targetIndex + 1]?.startMin !== undefined
      ) {
        /**
         * Get time unit start and line position
         * Calculates where to draw horizontal grid lines between periods
         *
         * @param {Array} timeUnits - Array of time unit objects
         * @param {number} ui - Time unit index
         * @returns {Object} Boundary object:
         *   - startMin: number|null - Start time in minutes
         *   - lineMin: number|null - Line position in minutes (at period end or next period start)
         */
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

  // ============================================================================
  // DOM CREATION - HEADER & TIME AXIS
  // ============================================================================

  /**
   * Create grid header with day labels
   * Creates a grid row with empty corner cell + day column labels
   *
   * @param {number} totalDisplayDays - Number of days to display
   * @param {Date} baseDate - Base date for calculations
   * @param {number} startOffset - Day offset from base date
   * @param {string} gridDateFormat - Date format for day labels
   * @param {Object} ctx - Main module context
   * @param {Object} util - Utility object with formatDate function
   * @returns {Object} Object with header element and gridTemplateColumns string
   */
  function createGridHeader(totalDisplayDays, baseDate, startOffset, gridDateFormat, ctx, { formatDate }) {
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

      const dayLabelText = formatDate
        ? formatDate(dayDate, gridDateFormat)
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

  // ============================================================================
  // LESSON PROCESSING & FILTERING
  // ============================================================================

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
      // Use dynamic field extraction for flexible display
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
        // Flexible field extraction (derived from el.su/te/ro/cl/sg/info)
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
        // Display mode information
        isTeacherView: displayMode.isTeacherView,
        isStudentView: displayMode.isStudentView,
        // Normalize legacy/mapped fields
        code: el.code || '',
        substText: el.substText || '',
        text: el.lstext || '',
        lessonId: el.id ?? el.lid ?? el.lessonId ?? null,
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
   * @param {number|null} allEnd - End time cutoff in minutes
   * @returns {Array} Filtered lesson objects
   */
  function filterLessonsByMaxPeriods(dayLessons, maxGridLessons, timeUnits, studentTitle, dateStr, ctx, allEnd = null) {
    if (maxGridLessons < 1 || !Array.isArray(timeUnits) || timeUnits.length === 0) {
      // If no maxGridLessons limit, still filter by allEnd cutoff if provided
      if (allEnd !== null && allEnd !== undefined) {
        return dayLessons.filter((lesson) => {
          // Always keep cancelled and irregular lessons
          if (lesson.status === 'CANCELLED' || isIrregularStatus(lesson.status)) {
            return true;
          }
          const s = lesson.startMin;
          return s === undefined || s === null || Number.isNaN(s) || s < allEnd;
        });
      }
      return dayLessons;
    }

    const filtered = dayLessons.filter((lesson) => {
      const s = lesson.startMin;
      if (s === undefined || s === null || Number.isNaN(s)) {
        return true;
      }

      // Always show break supervisions (they can occur outside regular periods, e.g., early morning supervision)
      if (lesson.activityType === 'BREAK_SUPERVISION') {
        return true;
      }

      // If maxGridLessons is set, filter ALL lessons (including cancelled/irregular) by period
      if (maxGridLessons >= 1) {
        // Check if the lesson's period index is within maxGridLessons
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

        // Only keep lessons in the first maxGridLessons periods
        return matchedIndex !== -1 && matchedIndex < maxGridLessons;
      }

      // Otherwise (no maxGridLessons limit), use allEnd cutoff if provided
      if (allEnd !== null && allEnd !== undefined && s >= allEnd) {
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

  /**
   * Check if lesson is an exam
   * Uses two detection methods:
   * 1. REST API activityType field (activityType === 'EXAM')
   * 2. Fallback text-based keywords (Klassenarbeit, Klausur, Arbeit)
   *
   * Note: The raw REST API sends 'type: "EXAM"' which is mapped to 'activityType'
   * during transformation (see lib/webuntisApiService.js#L260). The 'type' field
   * in lesson objects is always null.
   *
   * @param {Object} lesson - Lesson object
   * @returns {boolean} True if lesson is an exam
   */
  function lessonHasExam(lesson) {
    // Primary check: REST API activityType field (mapped from raw API's 'type' field)
    if (lesson?.activityType && String(lesson.activityType).toUpperCase() === 'EXAM') return true;

    // Fallback: Check if lesson text contains exam keywords
    const lText = String(lesson?.text || lesson?.lstext || '').toLowerCase();
    if (lText.includes('klassenarbeit') || lText.includes('klausur') || lText.includes('arbeit')) {
      return true;
    }

    return false;
  }

  // ============================================================================
  // DOM CREATION - DAY COLUMNS
  // ============================================================================

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
   * @param {string} icon - Icon emoji or text (e.g., '🏖️', '📅')
   * @param {string} text - Notice text (HTML allowed)
   * @param {string} iconSize - Icon font size (default: '1.5em')
   */
  function addDayNotice(inner, totalHeight, icon, text, iconSize = '1.5em') {
    // Unified function for both holiday and no-lessons notices
    const notice = document.createElement('div');
    notice.className = 'grid-lesson lesson lesson-content no-lesson';
    notice.style.height = `${totalHeight}px`;
    notice.innerHTML = `
      <div style="font-size: ${iconSize}; margin-bottom: 4px;">${icon}</div>
      <div style="font-weight: bold;">${text}</div>
    `;
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

  // ============================================================================
  // LESSON CELL RENDERING
  // ============================================================================

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

    // Apply lesson type classes
    if (lesson.activityType === 'BREAK_SUPERVISION') {
      element.classList.add('lesson-break-supervision');
    } else if (lesson.status === 'CANCELLED') {
      element.classList.add('lesson-cancelled');
    } else if (isIrregularStatus(lesson.status)) {
      // CHANGED lessons where only teacher and/or room differ are kept in the
      // regular colour — the inline change markers still highlight the diff.
      // Any other irregular status (ADDITIONAL, SUBSTITUTION, …) or CHANGED
      // with a more significant field (subject, class, …) keeps the blue tint.
      const changedFields = Array.isArray(lesson.changedFields) ? lesson.changedFields : [];
      const isMinorChange = lesson.status === 'CHANGED' && changedFields.length > 0 && changedFields.every((f) => f === 'te' || f === 'ro');
      element.classList.add(isMinorChange ? 'lesson-regular' : 'lesson-substitution');
    } else {
      element.classList.add('lesson-regular');
    }

    // Apply additional classes (e.g., split-left, split-right)
    if (additionalClasses.length > 0) {
      element.classList.add(...additionalClasses);
    }

    // Calculate isPast (either from parameter or calculate individually)
    let lessonIsPast = isPast;
    if (nowYmd !== null && nowMin !== null) {
      // Individual calculation for ticker items
      const lessonYmd = Number(lesson.dateStr) || 0;
      lessonIsPast = false;
      if (lessonYmd < nowYmd) {
        lessonIsPast = true;
      } else if (lessonYmd === nowYmd) {
        if (lesson.endMin <= nowMin) lessonIsPast = true;
      }
    }

    // Apply state classes
    if (lessonIsPast) element.classList.add('past');
    if (hasExam) element.classList.add('has-exam');
  }

  /**
   * Create a lesson cell container
   * Base element for all lesson types (regular, cancelled, substitution, exam)
   *
   * @param {number} topPx - Top position in pixels
   * @param {number} heightPx - Height in pixels
   * @param {string} dateStr - Date string (YYYYMMDD)
   * @param {number} eMin - End time in minutes
   * @returns {HTMLElement} Lesson cell div
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
  function makeLessonInnerHTML(lesson, escapeHtml, ctx) {
    // Special handling for BREAK_SUPERVISION (must run first, before flexible display)
    if (lesson.activityType === 'BREAK_SUPERVISION') {
      const breakSupervisionLabel = ctx.translate ? ctx.translate('break_supervision') : 'Break Supervision';
      const shortLabel = breakSupervisionLabel === 'Pausenaufsicht' ? 'PA' : 'BS';
      const supervisedArea = lesson.room || lesson.roomLong || '';
      const displayText = supervisedArea ? `🔔 ${shortLabel} (${supervisedArea})` : `🔔 ${shortLabel}`;
      return `<div class='lesson-content break-supervision'><span class='lesson-primary'>${escapeHtml(displayText)}</span></div>`;
    }

    // Build change-diff indicators for CHANGED lessons.
    // These are injected INLINE into the existing primary/secondary/additional lines
    // (not appended as a new row) to avoid overflow in compact grid cells.
    const changedFields = Array.isArray(lesson.changedFields) ? lesson.changedFields : [];

    // MOVED indicator (lesson was shifted to a different time slot)
    const movedBadge = lesson.statusDetail === 'MOVED' ? `<span class='lesson-moved-badge'>↕</span>` : '';

    // Use flexible field configuration
    if (ctx) {
      try {
        const displayParts = buildFlexibleLessonDisplay(lesson, ctx.config);

        // Primary: show subject, highlight in changed colour when subject was swapped
        let primaryHtml;
        if (changedFields.includes('su') && lesson.su?.[0]) {
          primaryHtml = `<span class='lesson-changed-new'>${escapeHtml(lesson.su[0].name)}</span>`;
        } else {
          primaryHtml = displayParts.primary ? escapeHtml(displayParts.primary) : '';
        }

        // Secondary: show current teacher; highlight when changed
        // Always use displayParts so teacher + room from field config are respected.
        let secondaryHtml;
        if (changedFields.includes('te') && lesson.te?.[0]) {
          secondaryHtml = `<span class='lesson-changed-new'>${escapeHtml(lesson.te[0].name)}</span>`;
        } else {
          secondaryHtml = displayParts.secondary ? escapeHtml(displayParts.secondary) : '';
        }

        // Additional (e.g. room): show current room; highlight when changed
        let additionalHtml = '';
        if (changedFields.includes('ro') && lesson.ro?.[0]) {
          additionalHtml = ` <span class='lesson-additional'>(<span class='lesson-changed-new'>${escapeHtml(lesson.ro[0].name)}</span>)</span>`;
        } else if (displayParts.additional && displayParts.additional.length > 0) {
          const additionalParts = displayParts.additional
            .filter(Boolean)
            .map((item) => `<span class='lesson-additional'>(${escapeHtml(item)})</span>`)
            .join(' ');
          if (additionalParts) {
            additionalHtml = ` ${additionalParts}`;
          }
        }

        // Build the display
        const subst = lesson.substText
          ? `<br><span class='lesson-substitution-text'>${escapeHtml(lesson.substText).replace(/\n/g, '<br>')}</span>`
          : '';
        const txt = lesson.text ? `<br><span class='lesson-info-text'>${escapeHtml(lesson.text).replace(/\n/g, '<br>')}</span>` : '';

        const secondaryLine =
          secondaryHtml || additionalHtml ? `<br><span class='lesson-secondary'>${secondaryHtml}${additionalHtml}</span>` : '';

        return `<div class='lesson-content'>${movedBadge}<span class='lesson-primary'>${primaryHtml}</span>${secondaryLine}${subst}${txt}</div>`;
      } catch {
        // Silently fall through to legacy behavior on error
      }
    }

    // Fallback to legacy behavior
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

    return `<div class='lesson-content'>${movedBadge}<span class='lesson-primary'>${subject}</span>${secondaryLine}${subst}${txt}</div>`;
  }

  /**
   * Check if lesson has matching homework
   * Matches by date and subject name
   *
   * @param {Object} lesson - Lesson object
   * @param {Array} homeworks - Array of homework objects
   * @returns {boolean} True if homework matches lesson
   */
  function checkHomeworkMatch(lesson, homeworks) {
    if (!homeworks || !Array.isArray(homeworks) || homeworks.length === 0) {
      return false;
    }

    const lessonDate = Number(lesson.date);
    const lessonNames = Array.isArray(lesson.su) ? lesson.su.flatMap((su) => [su.name, su.longname].filter(Boolean)) : [];

    return homeworks.some((hw) => {
      const hwDueDate = Number(hw.dueDate);
      const hwSuArr = Array.isArray(hw.su) ? hw.su : hw.su ? [hw.su] : [];
      const hwNames = hwSuArr.flatMap((su) => [su.name, su.longname].filter(Boolean));
      const subjectMatch = lessonNames.some((ln) => hwNames.includes(ln));
      return hwDueDate === lessonDate && subjectMatch;
    });
  }

  /**
   * Add homework icon to lesson cell
   * Displays 📘 icon when homework is due
   *
   * @param {HTMLElement} cell - Lesson cell element
   */
  function addHomeworkIcon(cell) {
    const icon = document.createElement('span');
    icon.className = 'homework-icon';
    icon.innerHTML = '📘';
    if (cell && cell.innerHTML) {
      cell.appendChild(icon.cloneNode(true));
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
    // Group lessons by date first
    const byDate = new Map();
    for (const lesson of lessonsToRender) {
      if (!byDate.has(lesson.dateStr)) {
        byDate.set(lesson.dateStr, []);
      }
      byDate.get(lesson.dateStr).push(lesson);
    }

    // For each date, find overlapping time slots
    const groups = new Map();
    let groupId = 0;

    for (const [dateStr, lessons] of byDate.entries()) {
      // Separate break supervisions from regular lessons
      // Break supervisions should be positioned freely, not grouped with overlapping lessons
      const regularLessons = [];
      const breakSupervisions = [];

      for (const lesson of lessons) {
        if (lesson.activityType === 'BREAK_SUPERVISION') {
          breakSupervisions.push(lesson);
        } else {
          regularLessons.push(lesson);
        }
      }

      // Sort regular lessons by start time for efficient overlap detection
      const sorted = regularLessons.slice().sort((a, b) => a.startMin - b.startMin);

      // Track which lessons have been assigned to a group
      const assigned = new Set();

      for (let i = 0; i < sorted.length; i++) {
        if (assigned.has(i)) continue;

        const lesson = sorted[i];
        const overlappingGroup = [lesson];
        assigned.add(i);

        // Find all lessons that overlap with any lesson in this group
        let foundNew = true;
        while (foundNew) {
          foundNew = false;
          for (let j = i + 1; j < sorted.length; j++) {
            if (assigned.has(j)) continue;

            const candidate = sorted[j];
            // Check if candidate overlaps with any lesson in the current group
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

        // Create unique key for this group
        const key = `${dateStr}_group_${groupId++}`;
        groups.set(key, overlappingGroup);
      }

      // Add break supervisions as individual groups (no overlap checking)
      // This allows them to be positioned freely, even if they overlap with regular lessons
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
   * @param {boolean} hasExam - True if any lesson in group is an exam
   * @param {boolean} isPast - True if lesson group is in the past (used for ticker wrapper)
   * @param {Array} homeworks - Array of homework objects
   * @param {number} nowYmd - Current date as YYYYMMDD integer
   * @param {number} nowMin - Current time in minutes since midnight
   */
  function createTickerAnimation(
    lessons,
    topPx,
    heightPx,
    container,
    ctx,
    escapeHtml,
    hasExam,
    isPast,
    homeworks,
    nowYmd,
    nowMin,
    tickerData
  ) {
    // Group lessons by subject + studentGroup/class for parallel classes.
    // Teacher changes inside one subject/group should remain stacked in one item.
    // Special handling: If a lesson is CANCELLED and has a replacement, they are shown as split-view within the same ticker item
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

    // Identify cancelled+replacement pairs for split-view rendering within ticker.
    // Multiple cancelled lessons that share the same replacement set are merged
    // into ONE split ticker item (left side stacked), e.g. Deutsch/Bio/KT -> Excursion.
    const splitViewPairs = [];
    if (tickerData && tickerData.hasSplitView && tickerData.cancelledLessons.length > 0) {
      const pairMap = new Map();
      for (const cancelled of tickerData.cancelledLessons) {
        // Find replacements that temporally overlap with this cancelled lesson
        const matchingReplacements = tickerData.replacements.filter((r) => r.startMin < cancelled.endMin && r.endMin > cancelled.startMin);

        if (matchingReplacements.length > 0) {
          const replacementKey = matchingReplacements
            .map((r) => `${r.lessonId ?? 'noId'}_${r.startMin}_${r.endMin}_${r.status || ''}`)
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

      // Remove split-pair lessons from subject groups (they're handled in split ticker items)
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

    // Create ticker wrapper - minimal container without lesson styling
    const tickerWrapper = document.createElement('div');
    tickerWrapper.className = 'lesson-ticker-wrapper';
    tickerWrapper.style.top = `${topPx}px`;
    tickerWrapper.style.height = `${heightPx}px`;
    tickerWrapper.style.position = 'absolute';
    tickerWrapper.style.left = '0.15rem'; // Match grid-lesson left offset
    tickerWrapper.style.right = '0.15rem'; // Match grid-lesson right offset
    tickerWrapper.style.zIndex = '10'; // Ensure ticker appears above cancelled lessons
    tickerWrapper.setAttribute('data-date', lessons[0].dateStr);
    tickerWrapper.setAttribute('data-end-min', String(Math.max(...lessons.map((l) => l.endMin))));

    // Create ticker track (will contain 2 copies for seamless loop)
    const tickerTrack = document.createElement('div');
    tickerTrack.className = 'ticker-track';

    // Each subject group + split-view pairs are ticker units
    const itemCount = subjectGroups.size + splitViewPairs.length;
    const itemWidthPercent = 100; // Each item should be 100% of wrapper width

    // Track width is: number of items * 2 (for 2 copies) * item width
    const trackWidth = itemCount * 2 * itemWidthPercent;
    tickerTrack.style.width = `${trackWidth}%`;

    // Add subject groups twice for seamless loop
    for (let copy = 0; copy < 2; copy++) {
      // Regular subject groups
      for (const [, subjectLessons] of subjectGroups.entries()) {
        const tickerItem = document.createElement('div');
        tickerItem.className = 'ticker-item';

        // Set item width as percentage of track
        tickerItem.style.width = `${itemWidthPercent / (itemCount * 2)}%`;
        tickerItem.style.position = 'relative';
        tickerItem.style.height = '100%';

        // Calculate overall time range for this subject group
        const groupStartMin = Math.min(...subjectLessons.map((l) => l.startMin));
        const groupEndMin = Math.max(...subjectLessons.map((l) => l.endMin));
        const totalGroupMinutes = groupEndMin - groupStartMin;

        // Create a sub-element for each lesson in this subject group (positioned absolutely)
        for (const lesson of subjectLessons) {
          const lessonDiv = document.createElement('div');
          lessonDiv.className = 'lesson-content';

          // Calculate absolute position and height within the group's time range
          const lessonStartOffset = lesson.startMin - groupStartMin;
          const lessonDuration = lesson.endMin - lesson.startMin;

          let topPercent;
          let heightPercent;

          if (totalGroupMinutes === 0) {
            // Degenerate case: no time span in this group (e.g. zero-length lesson).
            // Render the lesson as occupying the full height.
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

          // Apply lesson classes (type, past, exam)
          applyLessonClasses(lessonDiv, lesson, {
            hasExam,
            nowYmd,
            nowMin,
          });

          lessonDiv.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx);

          if (checkHomeworkMatch(lesson, homeworks)) {
            addHomeworkIcon(lessonDiv);
          }

          tickerItem.appendChild(lessonDiv);
        }

        tickerTrack.appendChild(tickerItem);
      }

      // Cancelled+replacement pairs as split-view ticker items
      for (const pair of splitViewPairs) {
        const tickerItem = document.createElement('div');
        tickerItem.className = 'ticker-item ticker-item-split';

        // Set item width as percentage of track
        tickerItem.style.width = `${itemWidthPercent / (itemCount * 2)}%`;
        tickerItem.style.position = 'relative';
        tickerItem.style.height = '100%';

        // Create split-view container within ticker item
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

        // Left side: cancelled lesson(s), stacked at natural positions
        for (const cancelled of pair.cancelledLessons) {
          const cancelledDiv = document.createElement('div');
          cancelledDiv.className = 'lesson-content split-left';
          const cancelledPos = toPairPercent(cancelled);
          cancelledDiv.style.position = 'absolute';
          cancelledDiv.style.top = `${cancelledPos.top}%`;
          cancelledDiv.style.height = `${cancelledPos.height}%`;
          cancelledDiv.style.left = '0';
          cancelledDiv.style.width = '50%';

          applyLessonClasses(cancelledDiv, cancelled, {
            hasExam,
            nowYmd,
            nowMin,
            additionalClasses: ['split-left'],
          });

          cancelledDiv.innerHTML = makeLessonInnerHTML(cancelled, escapeHtml, ctx);
          if (checkHomeworkMatch(cancelled, homeworks)) {
            addHomeworkIcon(cancelledDiv);
          }

          splitContainer.appendChild(cancelledDiv);
        }

        // Right side: replacement lesson(s)
        for (const replacement of pair.replacements) {
          const replacementDiv = document.createElement('div');
          replacementDiv.className = 'lesson-content split-right';
          const replacementPos = toPairPercent(replacement);
          replacementDiv.style.position = 'absolute';
          replacementDiv.style.top = `${replacementPos.top}%`;
          replacementDiv.style.height = `${replacementPos.height}%`;
          replacementDiv.style.right = '0';
          replacementDiv.style.width = '50%';

          applyLessonClasses(replacementDiv, replacement, {
            hasExam,
            nowYmd,
            nowMin,
            additionalClasses: ['split-right'],
          });

          replacementDiv.innerHTML = makeLessonInnerHTML(replacement, escapeHtml, ctx);
          if (checkHomeworkMatch(replacement, homeworks)) {
            addHomeworkIcon(replacementDiv);
          }

          splitContainer.appendChild(replacementDiv);
        }

        tickerItem.appendChild(splitContainer);
        tickerTrack.appendChild(tickerItem);
      }
    }

    tickerWrapper.appendChild(tickerTrack);

    // Calculate animation duration based on number of subject groups (longer for more items)
    const duration = Math.max(10, itemCount * 3); // 3s per subject group, min 10s
    tickerTrack.style.animation = `ticker-scroll ${duration}s linear infinite`;

    container.appendChild(tickerWrapper);
  }

  /**
   * Render all lesson cells for a day column.
   *
   * Three rendering strategies (evaluated in order for each transitive overlap group):
   *
   * SPLIT VIEW — when a lesson was cancelled and a replacement runs in its slot:
   *   Triggerred when the group contains CANCELLED + ADDITIONAL (any layoutWidth),
   *   OR CANCELLED + SUBSTITUTION where the substitution is a full-class course
   *   (layoutWidth ≥ 1000 → not a parallel half-group course).
   *   Left side: cancelled lessons at their own positions.
   *   Right side: replacement lesson(s) at their own positions.
   *
   *   layoutWidth for SUBSTITUTION:
   *     parallel half-group (lw=500) alongside its sibling half-group → NOT split
   *     full-class replacement (lw=1000) → SPLIT
   *
   * SPAN SPLIT — one lesson spans the full group range while others cover sub-periods:
   *   The spanning lesson appears full-height on the left; sub-period lessons are
   *   stacked on the right at their natural positions, preserving break gaps.
   *   Triggered when ≥ 1 ticker candidate spans [groupStart, groupEnd] and
   *   ≥ 1 ticker candidate does not.
   *
   * TICKER — truly parallel courses that all run in the same time range:
   *   Triggered when ≥ 2 NORMAL_TEACHING_PERIOD lessons exist in the group,
   *   regardless of status (REGULAR, CHANGED, or CANCELLED).
   *   Cancelled lessons appear in the ticker with strikethrough styling.
   *   Uses sub-interval rendering with bridge-absorption to handle gaps between
   *   partially-overlapping lessons.
   *
   * INDIVIDUAL CELLS — all other cases (single lessons, unmatched statuses, etc.)
   *
   * @param {Array}    lessonsToRender
   * @param {Object}   containers      - { bothInner }
   * @param {number}   allStart        - Grid start in minutes since midnight
   * @param {number}   allEnd          - Grid end in minutes since midnight
   * @param {number}   totalMinutes    - allEnd − allStart
   * @param {number}   totalHeight     - Total column height in pixels
   * @param {Array}    homeworks
   * @param {Object}   ctx
   * @param {Function} escapeHtml
   */
  function renderLessonCells(lessonsToRender, containers, allStart, allEnd, totalMinutes, totalHeight, homeworks, ctx, escapeHtml) {
    const { bothInner } = containers;

    const timeSlotGroups = groupLessonsByTimeSlot(lessonsToRender);

    let nowYmd = ctx._currentTodayYmd;
    if (nowYmd === undefined || nowYmd === null) {
      const d = new Date();
      nowYmd = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    }
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();

    /** Compute isPast for a lesson or group based on its end time. */
    const calcIsPast = (ymd, endMin) => {
      if (ymd < nowYmd) return true;
      if (ymd === nowYmd && typeof endMin === 'number' && !Number.isNaN(endMin) && endMin <= nowMin) return true;
      return false;
    };

    /** Render a single lesson as a standalone full-width cell at its own time position. */
    const renderSingleLesson = (lesson) => {
      const lS = Math.max(lesson.startMin, allStart);
      const lE = Math.min(lesson.endMin, allEnd);
      if (lE <= lS) return;

      const topPx = Math.round(((lS - allStart) / totalMinutes) * totalHeight);
      const heightPx = Math.max(12, Math.round(((lE - lS) / totalMinutes) * totalHeight));
      const ymd = Number(lesson.dateStr) || 0;

      const cell = createLessonCell(topPx, heightPx, lesson.dateStr, lE);
      applyLessonClasses(cell, lesson, { hasExam: lessonHasExam(lesson), isPast: calcIsPast(ymd, lE) });
      cell.innerHTML = makeLessonInnerHTML(lesson, escapeHtml, ctx);
      if (checkHomeworkMatch(lesson, homeworks)) addHomeworkIcon(cell);
      bothInner.appendChild(cell);
    };

    for (const [, lessons] of timeSlotGroups.entries()) {
      if (!lessons || lessons.length === 0) continue;

      // ── Classify lessons in this group ───────────────────────────────────────
      const cancelledLessons = lessons.filter((l) => l.status === 'CANCELLED');
      const addedLessons = lessons.filter((l) => l.status === 'ADDITIONAL'); // ADDITIONAL_PERIOD
      const substLessons = lessons.filter((l) => l.status === 'SUBSTITUTION');
      // School events (excursion, field trips, class trips, …) that replace cancelled regular lessons.
      // activityType=EVENT with status=CHANGED means a scheduled event overrides this slot.
      const eventLessons = lessons.filter((l) => l.activityType === 'EVENT');
      // Ticker candidates: ALL scheduled parallel courses (NORMAL_TEACHING_PERIOD).
      // Include CANCELLED lessons - they were originally scheduled in parallel and should
      // appear in the ticker (displayed as crossed-out via applyLessonClasses).
      const tickerCandidates = lessons.filter((l) => l.activityType === 'NORMAL_TEACHING_PERIOD');
      const plannedParallelCandidates = tickerCandidates.filter((l) => {
        const status = String(l.status || '').toUpperCase();
        return status === 'REGULAR' || status === 'CHANGED' || status === 'CANCELLED';
      });

      // ── Strategy decision ─────────────────────────────────────────────────────
      //
      // SPLIT VIEW: cancelled lesson(s) + a replacement in the same slot.
      //   ADDITIONAL always triggers split (a replacement was explicitly scheduled).
      //   SUBSTITUTION triggers split only for full-class courses (layoutWidth ≥ 1000);
      //   parallel half-group sibling lessons (lw=500) do not trigger split.
      //   EVENT (school trips, class excursions, …) alongside CANCELLED → split.
      const isSplitView =
        cancelledLessons.length >= 1 &&
        (addedLessons.length >= 1 || substLessons.some((l) => (l.layoutWidth ?? 1000) >= 1000) || eventLessons.length >= 1);

      // SPAN SPLIT: one ticker candidate spans the entire group range while at least
      // one other covers only a sub-period. The spanning lesson goes left; sub-period
      // lessons go right, each at their natural position (preserving break gaps).
      const tcGroupStart = tickerCandidates.length > 0 ? Math.min(...tickerCandidates.map((l) => l.startMin)) : Infinity;
      const tcGroupEnd = tickerCandidates.length > 0 ? Math.max(...tickerCandidates.map((l) => l.endMin)) : -Infinity;
      const spanningLessons = tickerCandidates.filter((l) => l.startMin <= tcGroupStart && l.endMin >= tcGroupEnd);
      const subPeriodLessons = tickerCandidates.filter((l) => !spanningLessons.includes(l));
      const isSpanSplitLayout =
        !isSplitView &&
        cancelledLessons.length === 0 &&
        addedLessons.length === 0 &&
        spanningLessons.length >= 1 &&
        subPeriodLessons.length >= 1;

      // TICKER: activated from PLANNED parallel timetable structure.
      // It must be true parallelism: at least two planned NORMAL_TEACHING_PERIOD
      // entries overlap in time. Sequential lessons replaced by one excursion must
      // NOT activate ticker.
      const hasPlannedParallelOverlap = (() => {
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
      })();
      const isTickerGroup = hasPlannedParallelOverlap;

      // SPLIT VIEW: activated when there are cancelled+replacement lessons,
      // but ONLY if Ticker is NOT active. If Ticker is active, cancelled+replacement
      // are rendered within the ticker animation as split-view items.
      const shouldUseSplitView = isSplitView && !isTickerGroup;

      // ── TICKER rendering ──────────────────────────────────────────────────────
      // HIGHEST PRIORITY: Checked first for parallel lessons.
      // If cancelled+replacement exists alongside parallel lessons, they are
      // rendered as split-view within ticker items, not as separate split view.
      if (isTickerGroup) {
        const tYmd = Number(tickerCandidates[0].dateStr) || 0;
        const tEMin = Math.min(Math.max(...tickerCandidates.map((l) => l.endMin)), allEnd);
        const isPast = calcIsPast(tYmd, tEMin);
        const hasExam = tickerCandidates.some((l) => lessonHasExam(l));

        // Pass cancelled lessons and replacements to ticker for split-view rendering
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
            hasExam,
            isPast,
            homeworks,
            nowYmd,
            nowMin,
            tickerData
          );
        }

        // Render any non-ticker-candidate lessons (events, break supervisions) individually
        for (const lesson of lessons) {
          if (tickerCandidates.includes(lesson)) continue;
          // Cancelled lessons are represented in the ticker.
          if (cancelledLessons.includes(lesson)) continue;

          // Replacements that overlap cancelled lessons are represented as
          // split-view items inside the ticker and must not be duplicated here.
          const isReplacement = tickerData.replacements.includes(lesson);
          const overlapsCancelled = cancelledLessons.some((c) => lesson.startMin < c.endMin && lesson.endMin > c.startMin);
          if (isReplacement && overlapsCancelled) continue;

          renderSingleLesson(lesson);
        }

        continue;
      }

      // ── SPLIT VIEW rendering ──────────────────────────────────────────────────
      // Only used when there are NO parallel lessons (< 2 ticker candidates).
      // Shows cancelled lessons on left, replacements on right.
      if (shouldUseSplitView) {
        const replacements = [...addedLessons, ...substLessons, ...eventLessons];
        const allLessonsYmd = Number((cancelledLessons[0] ?? replacements[0]).dateStr) || 0;
        const groupEMin = Math.min(Math.max(...lessons.map((l) => l.endMin)), allEnd);
        const hasExam = lessons.some((l) => lessonHasExam(l));
        const isPast = calcIsPast(allLessonsYmd, groupEMin);

        // Left side: each cancelled lesson at its own time slot
        for (const cancelled of cancelledLessons) {
          const cS = Math.max(cancelled.startMin, allStart);
          const cE = Math.min(cancelled.endMin, allEnd);
          if (cE <= cS) continue;
          const cTop = Math.round(((cS - allStart) / totalMinutes) * totalHeight);
          const cH = Math.max(12, Math.round(((cE - cS) / totalMinutes) * totalHeight));
          const cell = createLessonCell(cTop, cH, cancelled.dateStr, cE);
          applyLessonClasses(cell, cancelled, { hasExam, isPast, additionalClasses: ['split-left'] });
          cell.innerHTML = makeLessonInnerHTML(cancelled, escapeHtml, ctx);
          if (checkHomeworkMatch(cancelled, homeworks)) addHomeworkIcon(cell);
          bothInner.appendChild(cell);
        }

        // Right side: replacement lesson(s) — each at its own time slot
        for (const repl of replacements) {
          const rS = Math.max(repl.startMin, allStart);
          const rE = Math.min(repl.endMin, allEnd);
          if (rE <= rS) continue;
          const rTop = Math.round(((rS - allStart) / totalMinutes) * totalHeight);
          const rH = Math.max(12, Math.round(((rE - rS) / totalMinutes) * totalHeight));
          const cell = createLessonCell(rTop, rH, repl.dateStr, rE);
          applyLessonClasses(cell, repl, { hasExam, isPast, additionalClasses: ['split-right'] });
          cell.innerHTML = makeLessonInnerHTML(repl, escapeHtml, ctx);
          if (checkHomeworkMatch(repl, homeworks)) addHomeworkIcon(cell);
          bothInner.appendChild(cell);
        }

        // Any remaining lessons in the group that are neither cancelled nor replacements
        // (rare edge case) are rendered as individual cells.
        for (const lesson of lessons) {
          if (cancelledLessons.includes(lesson) || replacements.includes(lesson)) continue;
          renderSingleLesson(lesson);
        }

        continue;
      }

      // ── SPAN SPLIT rendering ──────────────────────────────────────────────────
      //
      // Spanning lesson(s) → full-height on the left.
      // Sub-period lessons → individually on the right at their natural positions.
      // Break gaps between sub-period slots remain empty and visible.
      if (isSpanSplitLayout) {
        const tYmd = Number(spanningLessons[0].dateStr) || 0;
        const tEMin = Math.min(tcGroupEnd, allEnd);
        const isPast = calcIsPast(tYmd, tEMin);
        const hasExam = lessons.some((l) => lessonHasExam(l));

        // Left: spanning lesson(s) at their full natural height
        for (const spanning of spanningLessons) {
          const sS = Math.max(spanning.startMin, allStart);
          const sE = Math.min(spanning.endMin, allEnd);
          if (sE <= sS) continue;
          const sTop = Math.round(((sS - allStart) / totalMinutes) * totalHeight);
          const sH = Math.max(12, Math.round(((sE - sS) / totalMinutes) * totalHeight));
          const cell = createLessonCell(sTop, sH, spanning.dateStr, sE);
          applyLessonClasses(cell, spanning, { hasExam, isPast, additionalClasses: ['split-left'] });
          cell.innerHTML = makeLessonInnerHTML(spanning, escapeHtml, ctx);
          if (checkHomeworkMatch(spanning, homeworks)) addHomeworkIcon(cell);
          bothInner.appendChild(cell);
        }

        // Right: sub-period lessons individually, each at their natural position.
        // Gaps between them (class-period breaks) remain empty.
        for (const sub of subPeriodLessons) {
          const sS = Math.max(sub.startMin, allStart);
          const sE = Math.min(sub.endMin, allEnd);
          if (sE <= sS) continue;
          const sTop = Math.round(((sS - allStart) / totalMinutes) * totalHeight);
          const sH = Math.max(12, Math.round(((sE - sS) / totalMinutes) * totalHeight));
          const cell = createLessonCell(sTop, sH, sub.dateStr, sE);
          applyLessonClasses(cell, sub, { hasExam, isPast, additionalClasses: ['split-right'] });
          cell.innerHTML = makeLessonInnerHTML(sub, escapeHtml, ctx);
          if (checkHomeworkMatch(sub, homeworks)) addHomeworkIcon(cell);
          bothInner.appendChild(cell);
        }

        // Any non-ticker-candidate lessons in this group are rendered individually.
        for (const lesson of lessons) {
          if (tickerCandidates.includes(lesson)) continue;
          renderSingleLesson(lesson);
        }

        continue;
      }

      // ── INDIVIDUAL CELLS (fallback) ───────────────────────────────────────────
      for (const lesson of lessons) {
        renderSingleLesson(lesson);
      }
    }
  }

  // ============================================================================
  // ABSENCE OVERLAY RENDERING
  // ============================================================================

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

    // Add icon and reason text
    const icon = document.createElement('span');
    icon.className = 'absence-icon';
    icon.textContent = '⚡';
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
   * Add absence overlays to day column
   * Renders semi-transparent overlays for each absence period
   * Clamps overlays to visible time range
   *
   * @param {HTMLElement} bothInner - Day column inner container
   * @param {Array} dayAbsences - Array of absence objects for this day
   * @param {number} allStart - Start time in minutes
   * @param {number} allEnd - End time in minutes
   * @param {number} totalMinutes - Total minutes span
   * @param {number} totalHeight - Total height in pixels
   * @param {Object} ctx - Main module context
   */
  function addAbsenceOverlays(bothInner, dayAbsences, allStart, allEnd, totalMinutes, totalHeight, ctx) {
    if (!Array.isArray(dayAbsences) || dayAbsences.length === 0) {
      return;
    }

    try {
      for (const absence of dayAbsences) {
        // Convert HHMM (1330 = 13:30) to minutes (810 minutes)
        const startMin = ctx._toMinutes(absence?.startTime) || 0;
        const endMin = ctx._toMinutes(absence?.endTime) || 0;

        if (startMin >= allEnd || endMin <= allStart) {
          // Absence is outside the visible time range
          continue;
        }

        // Clamp to visible range
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

  // ============================================================================
  // MAIN ORCHESTRATION FUNCTION
  // ============================================================================

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
   * @param {Array} homeworks - Array of homework objects
   * @param {Array} timeUnits - Array of time unit objects (periods)
   * @param {Array} exams - Array of exam objects (not used in grid, but passed for context)
   * @param {Array} absences - Array of absence objects
   * @returns {HTMLElement} Grid widget wrapper element
   */
  function renderGridForStudent(ctx, studentTitle, studentConfig, timetable, homeworks, timeUnits, exams, absences) {
    // 1. Validate and extract configuration
    const config = validateAndExtractGridConfig(ctx, studentConfig);

    // 2. Calculate time range
    const timeRange = calculateTimeRange(timetable, timeUnits, ctx);
    let { allStart, allEnd } = timeRange;
    allEnd = applyMaxLessonsLimit(allStart, allEnd, config.maxGridLessons, timeUnits);

    const totalMinutes = allEnd - allStart;
    const pxPerMinute = 0.75;
    const totalHeight = Math.max(120, Math.round(totalMinutes * pxPerMinute));

    // 3. Determine base date
    const baseDate = ctx._currentTodayYmd
      ? (() => {
          const s = String(ctx._currentTodayYmd);
          const by = parseInt(s.substring(0, 4), 10);
          const bm = parseInt(s.substring(4, 6), 10) - 1;
          const bd = parseInt(s.substring(6, 8), 10);
          return new Date(by, bm, bd);
        })()
      : new Date();
    const todayDateStr = `${baseDate.getFullYear()}${('0' + (baseDate.getMonth() + 1)).slice(-2)}${('0' + baseDate.getDate()).slice(-2)}`;

    // 4. Create wrapper and add student title header for verbose mode
    const wrapper = document.createElement('div');

    // Add student title header if in verbose mode using helper
    const widgetCtx = createWidgetContext('grid', studentConfig, root.util || {});
    if (widgetCtx.isVerbose && studentTitle && typeof addHeader === 'function') {
      // Create a separate container for the header with the standard widget styling
      const headerContainer = document.createElement('div');
      headerContainer.className = 'wu-widget-container bright small light';
      addHeader(headerContainer, studentTitle);
      wrapper.appendChild(headerContainer);
    }

    // 5. Create date header and grid container
    const { header, gridTemplateColumns } = createGridHeader(
      config.totalDisplayDays,
      baseDate,
      config.startOffset,
      config.gridDateFormat,
      ctx,
      { formatDate, formatTime, toMinutes }
    );

    wrapper.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'grid-combined';
    grid.style.gridTemplateColumns = gridTemplateColumns;

    // 5. Create time axis
    const timeAxis = createTimeAxis(timeUnits, allStart, allEnd, totalHeight, totalMinutes, ctx);
    grid.appendChild(timeAxis);

    // 6. Render each day column
    for (let d = 0; d < config.totalDisplayDays; d++) {
      const dayIndex = config.startOffset + d;
      const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + dayIndex);
      const dateStr = `${targetDate.getFullYear()}${('0' + (targetDate.getMonth() + 1)).slice(-2)}${('0' + targetDate.getDate()).slice(-2)}`;

      const groupedRaw = ctx.preprocessedByStudent?.[studentTitle]?.rawGroupedByDate;
      const sourceForDay =
        groupedRaw?.[dateStr] ??
        (Array.isArray(timetable) ? timetable : [])
          .filter((el) => String(el.date) === dateStr)
          .sort((a, b) => (a.startTime || 0) - (b.startTime || 0));

      // Extract and normalize lessons
      let dayLessons = extractDayLessons(sourceForDay, ctx);
      dayLessons = validateAndNormalizeLessons(dayLessons, log);

      // Filter by max periods and time cutoff
      const lessonsToRender = filterLessonsByMaxPeriods(dayLessons, config.maxGridLessons, timeUnits, studentTitle, dateStr, ctx, allEnd);

      // Create day column (single column per day)
      const col = 2 + d;
      const isToday = dateStr === todayDateStr;

      const bothWrap = document.createElement('div');
      bothWrap.style.gridColumn = `${col}`;
      bothWrap.style.gridRow = '1';
      const bothInner = document.createElement('div');
      bothInner.className = 'day-column-inner';
      bothInner.style.height = `${totalHeight}px`;
      bothInner.style.position = 'relative';
      if (isToday) bothInner.classList.add('is-today');
      bothWrap.appendChild(bothInner);

      // Add holiday notice if applicable - use totalHeight to respect maxLessons
      const holiday = (ctx.holidayMapByStudent?.[studentTitle] || {})[Number(dateStr)] || null;
      if (holiday) {
        addDayNotice(bothInner, totalHeight, '🏖️', escapeHtml(holiday.longName || holiday.name), '2em');
      }

      // Add to grid
      grid.appendChild(bothWrap);

      // Add hour lines
      addHourLinesToColumn(bothInner, timeUnits, allStart, allEnd, totalMinutes, totalHeight);

      // Add now line
      addNowLineToColumn(bothInner, allStart, allEnd, totalHeight);

      // Add "more" badge if lessons were hidden
      const hiddenCount = dayLessons.length - lessonsToRender.length;
      if (hiddenCount > 0) {
        addMoreBadge(bothInner, hiddenCount, ctx);
      }

      // Add "no lessons" notice if empty and not a holiday
      if (!Array.isArray(lessonsToRender) || lessonsToRender.length === 0) {
        // Don't show "no lessons" if there's a holiday notice
        if (!holiday) {
          addDayNotice(bothInner, totalHeight, '📅', `<b>${ctx.translate('no-lessons')}</b>`, '1.5em');
        }
      } else {
        // Render lesson cells
        renderLessonCells(lessonsToRender, { bothInner }, allStart, allEnd, totalMinutes, totalHeight, homeworks, ctx, escapeHtml);
      }

      // Add absence overlays if any
      if (Array.isArray(absences) && absences.length > 0) {
        const dayAbsences = absences.filter((ab) => String(ab?.date) === dateStr);
        if (dayAbsences.length > 0) {
          addAbsenceOverlays(bothInner, dayAbsences, allStart, allEnd, totalMinutes, totalHeight, ctx);
        }
      }
    }

    wrapper.appendChild(grid);

    // Draw nowLine and set past masks immediately on first render
    // Use setTimeout to ensure DOM is fully updated before running
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

      // Update regular lesson cells (.grid-lesson)
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

      // Update ticker wrappers (for overlapping lessons)
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

        // Update all lesson-content divs within ticker
        const lessonDivs = ticker.querySelectorAll('.lesson-content');
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
   * @param {Object} ctx - Main module context (provides studentConfig.showNowLine)
   * @param {HTMLElement} rootEl - Root element to search (defaults to document)
   * @returns {number} Number of now-lines updated
   */
  function updateNowLinesAll(ctx, rootEl = null) {
    try {
      if (!ctx) return;
      // Respect the showNowLine config option (from current displayed student config)
      if (ctx.studentConfig?.showNowLine === false) {
        // Hide all now lines if disabled
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
        // Only show the now-line for the column explicitly marked as "is-today".
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
        if (nowMin < allS || nowMin > allE) {
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
