/**
 * Data Orchestration Service
 * Combines data transformation and date range calculations for WebUntis API responses
 * Handles normalization, date range calculations for fetches
 */

/**
 * Sanitizes HTML text by removing tags and decoding entities
 *
 * @param {string} text - HTML text to sanitize
 * @param {boolean} [preserveLineBreaks=true] - Whether to preserve <br> tags as newlines
 * @returns {string} Sanitized text
 *
 * Process:
 * 1. Convert <br> tags to newlines (if preserveLineBreaks is true)
 * 2. Remove all remaining HTML tags
 * 3. Decode HTML entities (&lt;, &gt;, &quot;, &apos;, &nbsp;, &amp;)
 * 4. Re-encode any remaining angle brackets as HTML entities to prevent tag re-formation
 *    while preserving the decoded text content (e.g. &lt; stays visible as &lt;)
 * 5. Clean up extra whitespace; when preserveLineBreaks is true, newlines are kept
 */
function stripAllHtml(text, preserveLineBreaks = true) {
  if (!text) return '';
  let result = String(text);

  if (preserveLineBreaks) {
    result = result.replace(/<br\s*\/?>/gi, '\n');
  }

  result = result.replace(/<[^>]*>/g, '');

  result = result
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // Must be last

  result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  if (preserveLineBreaks) {
    result = result.replace(/[^\S\n]+/g, ' ');
    result = result.replace(/\n{2,}/g, '\n');
    result = result
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  } else {
    result = result.replace(/\s+/g, ' ').trim();
  }

  return result;
}

/**
 * Normalizes date from various formats to YYYYMMDD integer
 *
 * @param {string|number} date - Date in various formats
 * @returns {number|null} Date as YYYYMMDD integer, or null if invalid
 *
 * Accepts:
 * - ISO string: "2025-12-17" → 20251217
 * - Integer: 20251217 → 20251217
 * - Numeric string: "20251217" → 20251217
 */
function normalizeDateToInteger(date) {
  if (!date) return null;

  if (typeof date === 'number' && date > 10000000 && date < 99991231) {
    return date;
  }

  const dateStr = String(date);
  if (dateStr.includes('-')) {
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      const y = parts[0].padStart(4, '0');
      const m = parts[1].padStart(2, '0');
      const d = parts[2].padStart(2, '0');
      return parseInt(`${y}${m}${d}`, 10);
    }
  }

  const num = parseInt(String(date).replace(/\D/g, ''), 10);
  return num > 10000000 && num < 99991231 ? num : null;
}

/**
 * Parses strict HH:MM strings to HHMM integers.
 * Returns null for non-string or non-HH:MM input.
 *
 * @param {string} value - Time string in HH:MM format
 * @returns {number|null} HHMM integer or null if invalid
 */
function parseHHMMStringToInteger(value) {
  if (typeof value !== 'string') return null;

  const timeStr = value.trim();
  if (!timeStr.includes(':')) return null;

  const parts = timeStr.split(':');
  if (parts.length < 2) return null;

  const hh = parseInt(parts[0], 10);
  const mm = parseInt(parts[1], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  return hh * 100 + mm;
}

/**
 * Normalizes time from various formats to HHMM integer
 *
 * @param {string|number} time - Time in various formats
 * @returns {number|null} Time as HHMM integer (e.g., 750 for 07:50), or null if invalid
 *
 * Accepts:
 * - HH:MM string: "07:50" → 750, "08:45" → 845
 * - Integer: 750 → 750
 * - Numeric string: "0750" → 750
 */
function normalizeTimeToHHMM(time) {
  if (!time && time !== 0) return null;

  if (typeof time === 'number' && time >= 0 && time < 2400) {
    return time;
  }

  const parsedHHMM = parseHHMMStringToInteger(String(time));
  if (parsedHHMM !== null) return parsedHHMM;

  const num = parseInt(String(time).replace(/\D/g, ''), 10);
  return num >= 0 && num < 2400 ? num : null;
}

/**
 * Compacts holiday data by removing unnecessary fields
 *
 * @param {Array} rawHolidays - Raw holiday data from WebUntis API
 * @returns {Array} Compacted holiday data with only essential fields
 */
function compactHolidays(rawHolidays) {
  if (!Array.isArray(rawHolidays)) return [];

  return rawHolidays.map((holiday) => ({
    id: holiday?.id,
    name: holiday?.name || holiday?.shortName,
    longName: holiday?.longName || holiday?.name,
    startDate: holiday?.startDate,
    endDate: holiday?.endDate,
  }));
}

/**
 * Formats backend YYYYMMDD values to various output formats
 *
 * @param {number} ymd - Date as YYYYMMDD integer (e.g., 20251217)
 * @param {string} [format='YYYY-MM-DD'] - Output format
 * @returns {string} Formatted date string
 */
function formatDateFromYmd(ymd, format = 'YYYY-MM-DD') {
  if (!ymd) return '';

  const num = Number(ymd);
  if (!Number.isFinite(num)) return '';

  const year = Math.floor(num / 10000);
  const month = Math.floor((num % 10000) / 100);
  const day = num % 100;

  if (format === 'YYYY-MM-DD') {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (format === 'DD.MM.YYYY') {
    return `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`;
  }
  if (format === 'YYYYMMDD') {
    return String(ymd);
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Calculate date ranges for all data types using a flat generic input object.
 *
 * @param {Object} input - Range calculation input
 * @param {Date} input.baseNow - Base date for calculations
 * @param {Object} [input.fetchPlan] - Fetch plan flags
 * @param {boolean} [input.fetchPlan.wantsGridWidget] - Whether grid widget is enabled
 * @param {boolean} [input.fetchPlan.wantsLessonsWidget] - Whether lessons widget is enabled
 * @param {boolean} [input.fetchPlan.fetchExams] - Whether exams should be fetched
 * @param {boolean} [input.fetchPlan.fetchAbsences] - Whether absences should be fetched
 * @param {Object} [input.days] - Flat day offsets used for range computation
 * @param {number} [input.days.globalPastDays] - Global fallback past days
 * @param {number} [input.days.globalNextDays] - Global fallback next days
 * @param {number} [input.days.gridPastDays] - Grid-specific past days
 * @param {number} [input.days.gridNextDays] - Grid-specific next days
 * @param {number} [input.days.lessonsPastDays] - Lessons-specific past days
 * @param {number} [input.days.lessonsNextDays] - Lessons-specific next days
 * @param {number} [input.days.examsPastDays] - Exams-specific past days
 * @param {number} [input.days.examsNextDays] - Exams-specific next days
 * @param {number} [input.days.absencesPastDays] - Absences-specific past days
 * @param {number} [input.days.absencesNextDays] - Absences-specific next days
 * @param {number} [input.days.homeworkPastDays] - Homework-specific past days
 * @param {number} [input.days.homeworkNextDays] - Homework-specific next days
 * @param {Object} [input.options] - Additional options
 * @param {boolean} [input.options.gridWeekView] - Whether weekView is enabled for grid
 * @param {boolean} [input.options.debugDateEnabled] - Whether debug date mode is active
 * @returns {Object} Date ranges for timetable, exams, homework, absences
 */
function calculateFetchRanges(input = {}) {
  const { baseNow, fetchPlan = {}, days = {}, options = {} } = input;
  if (!(baseNow instanceof Date) || Number.isNaN(baseNow.getTime())) {
    throw new Error('calculateFetchRanges requires a valid baseNow Date');
  }

  const wantsGridWidget = Boolean(fetchPlan.wantsGridWidget);
  const wantsLessonsWidget = Boolean(fetchPlan.wantsLessonsWidget);
  const fetchExams = Boolean(fetchPlan.fetchExams);
  const fetchAbsences = Boolean(fetchPlan.fetchAbsences);

  const pastDaysValue = Number(days.globalPastDays ?? 0);
  const nextDaysValue = Number(days.globalNextDays ?? 2);

  // For timetable/grid, check grid and lessons specific nextDays/pastDays
  let timetableNextDays = 0;
  let timetablePastDays = 0;

  if (wantsGridWidget) {
    const weekView = Boolean(options.gridWeekView);
    const gridNext = Number(days.gridNextDays ?? 4);
    const gridPast = Number(days.gridPastDays ?? 0);
    let minNextDaysForWeekView = gridNext;
    if (weekView) {
      const dayOfWeek = baseNow.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const currentHour = baseNow.getHours();

      // Determine if we show current week or next week (same logic as grid.js)
      let weekOffset = 0;
      if (dayOfWeek === 5) {
        // Friday - advance to next week after 16:00 (unless debugDate is set)
        const isDebugMode = Boolean(options.debugDateEnabled);
        if (!isDebugMode && currentHour >= 16) {
          weekOffset = 1;
        }
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        // Saturday or Sunday - show next week
        weekOffset = 1;
      }

      // Calculate offset to Monday of target week
      const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // Sunday needs special handling
      const startOffset = daysToMonday + weekOffset * 7;
      const endOffset = startOffset + 4; // Monday + 4 = Friday

      // We need to fetch from baseNow to the end of the target week
      minNextDaysForWeekView = Math.max(0, endOffset);
    }

    timetableNextDays = Math.max(timetableNextDays, gridNext, minNextDaysForWeekView);
    timetablePastDays = Math.max(timetablePastDays, gridPast);
  }

  if (wantsLessonsWidget) {
    const lessonsNext = Number(days.lessonsNextDays ?? 2);
    const lessonsPast = Number(days.lessonsPastDays ?? 0);
    timetableNextDays = Math.max(timetableNextDays, lessonsNext);
    timetablePastDays = Math.max(timetablePastDays, lessonsPast);
  }

  // Also include global fallbacks if we need timetable
  if (wantsGridWidget || wantsLessonsWidget) {
    timetableNextDays = Math.max(timetableNextDays, Number.isFinite(nextDaysValue) ? nextDaysValue : 2);
    timetablePastDays = Math.max(timetablePastDays, Number.isFinite(pastDaysValue) ? pastDaysValue : 0);
  }

  const timetableStart = new Date(baseNow);
  const timetableEnd = new Date(baseNow);
  timetableStart.setDate(timetableStart.getDate() - timetablePastDays);
  // API end date is exclusive, so add 1 day to include the last day
  timetableEnd.setDate(timetableEnd.getDate() + Math.floor(timetableNextDays) + 1);

  // Exams range (frontend provides defaults now)
  const examsNextDays = Number(days.examsNextDays ?? 0);
  let validatedExamsDays = examsNextDays;
  if (validatedExamsDays < 1 || validatedExamsDays > 360 || isNaN(validatedExamsDays)) {
    validatedExamsDays = 21; // Fallback to default if invalid
  }
  const examsStart = new Date(baseNow);
  const examsEnd = new Date(baseNow);
  examsStart.setDate(examsStart.getDate() - Number(days.examsPastDays ?? days.globalPastDays ?? 0));
  examsEnd.setDate(examsEnd.getDate() + validatedExamsDays);

  // Absences range (frontend provides defaults now)
  const absPast = Number.isFinite(Number(days.absencesPastDays ?? 0)) ? Number(days.absencesPastDays ?? 0) : 0;
  const absFuture = Number.isFinite(Number(days.absencesNextDays ?? 0)) ? Number(days.absencesNextDays ?? 0) : 0;
  const absencesStart = new Date(baseNow);
  const absencesEnd = new Date(baseNow);
  absencesStart.setDate(absencesStart.getDate() - absPast);
  absencesEnd.setDate(absencesEnd.getDate() + absFuture);

  // Homework range (calculate maximum range across all widgets)
  // Check homework-specific config first
  const hwNextDays = Number(days.homeworkNextDays ?? 0);
  const hwPastDays = Number(days.homeworkPastDays ?? 0);

  const allRanges = [
    { pastDays: timetablePastDays, futureDays: timetableNextDays },
    fetchExams && examsNextDays > 0
      ? { pastDays: Number(days.examsPastDays ?? days.globalPastDays ?? 0), futureDays: examsNextDays }
      : null,
    fetchAbsences && (absPast > 0 || absFuture > 0) ? { pastDays: absPast, futureDays: absFuture } : null,
    hwNextDays > 0 || hwPastDays > 0 ? { pastDays: hwPastDays, futureDays: hwNextDays } : null,
  ].filter(Boolean);

  let maxPastDays = 0;
  let maxFutureDays = 0;
  allRanges.forEach((range) => {
    maxPastDays = Math.max(maxPastDays, range.pastDays || 0);
    maxFutureDays = Math.max(maxFutureDays, range.futureDays || 0);
  });

  // If no homework-specific config and calculated range is too short, use reasonable default
  if (hwNextDays === 0 && maxFutureDays < 7) {
    maxFutureDays = 28; // Default homework lookahead (4 weeks)
  }

  const homeworkStart = new Date(baseNow);
  const homeworkEnd = new Date(baseNow);
  homeworkStart.setDate(homeworkStart.getDate() - maxPastDays);
  homeworkEnd.setDate(homeworkEnd.getDate() + maxFutureDays);

  return {
    timetable: { start: timetableStart, end: timetableEnd, pastDays: timetablePastDays, nextDays: timetableNextDays },
    exams: { start: examsStart, end: examsEnd, nextDays: validatedExamsDays },
    homework: { start: homeworkStart, end: homeworkEnd, pastDays: maxPastDays, futureDays: maxFutureDays },
    absences: { start: absencesStart, end: absencesEnd, pastDays: absPast, futureDays: absFuture },
  };
}

module.exports = {
  // Data transformation exports
  stripAllHtml,
  normalizeDateToInteger,
  parseHHMMStringToInteger,
  normalizeTimeToHHMM,
  compactHolidays,
  formatDateFromYmd,
  // Date range calculation exports
  calculateFetchRanges,
};
