/**
 * Data Orchestration Service
 * Combines data transformation and date range calculations for WebUntis API responses
 * Handles normalization, date range calculations for fetches
 */

// ============================================================================
// DATA TRANSFORMATION FUNCTIONS
// ============================================================================

/**
 * Sanitizes HTML text by removing tags and decoding entities
 *
 * @param {string} text - HTML text to sanitize
 * @param {boolean} [preserveLineBreaks=true] - Whether to preserve <br> tags as newlines
 * @returns {string} Sanitized text
 *
 * Process:
 * 1. Convert <br> tags to newlines (if preserveLineBreaks is true)
 * 2. Remove all HTML tags
 * 3. Decode HTML entities (&lt;, &gt;, &quot;, &apos;, &nbsp;, &amp;)
 * 4. Clean up extra whitespace
 */
function sanitizeHtmlText(text, preserveLineBreaks = true) {
  if (!text) return '';
  let result = String(text);

  // Step 1: Preserve intentional line breaks by converting <br> tags to newlines
  if (preserveLineBreaks) {
    result = result.replace(/<br\s*\/?>/gi, '\n');
  }

  // Step 2: Remove all remaining HTML tags
  result = result.replace(/<[^>]*>/g, '');

  // Step 3: Decode HTML entities
  result = result
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // Must be last

  // Step 4: Clean up extra whitespace (but preserve intentional newlines)
  result = result.replace(/\s+/g, ' ').trim();

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

  // If already an integer in YYYYMMDD format, return as-is
  if (typeof date === 'number' && date > 10000000 && date < 99991231) {
    return date;
  }

  // Parse ISO string format "YYYY-MM-DD" → YYYYMMDD
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

  // Try to parse as plain number
  const num = parseInt(String(date).replace(/\D/g, ''), 10);
  return num > 10000000 && num < 99991231 ? num : null;
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
function normalizeTimeToMinutes(time) {
  if (!time && time !== 0) return null;

  // If already an integer in HHMM format, return as-is
  if (typeof time === 'number' && time >= 0 && time < 2400) {
    return time;
  }

  // Parse HH:MM string format
  const timeStr = String(time).trim();
  if (timeStr.includes(':')) {
    const parts = timeStr.split(':');
    if (parts.length >= 2) {
      const hh = parseInt(parts[0], 10) || 0;
      const mm = parseInt(parts[1], 10) || 0;
      return hh * 100 + mm;
    }
  }

  // Try to parse as plain number
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
 * Formats date from YYYYMMDD integer to various output formats
 *
 * @param {number} ymd - Date as YYYYMMDD integer (e.g., 20251217)
 * @param {string} [format='YYYY-MM-DD'] - Output format
 * @returns {string} Formatted date string
 */
function formatDate(ymd, format = 'YYYY-MM-DD') {
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

// ============================================================================
// DATE RANGE CALCULATION FUNCTIONS
// ============================================================================

/**
 * Calculate date ranges for all data types based on student config
 * @param {Object} student - Student config object
 * @param {Object} config - Module config object
 * @param {Date} baseNow - Base date for calculations
 * @param {boolean} wantsGridWidget - Whether grid widget is enabled
 * @param {boolean} fetchExams - Whether exams should be fetched
 * @param {boolean} fetchAbsences - Whether absences should be fetched
 * @returns {Object} Date ranges for timetable, exams, homework, absences
 */
function calculateFetchRanges(student, config, baseNow, wantsGridWidget, fetchExams, fetchAbsences) {
  const pastDaysValue = Number(student.pastDays ?? 0);
  const nextDaysValue = Number(student.nextDays ?? 2);

  // For timetable/grid, also check grid-specific nextDays/pastDays
  let gridNextDays;
  let gridPastDays;
  if (wantsGridWidget) {
    const weekView = student.grid?.weekView ?? false;
    const gridNext = Number(student.grid?.nextDays ?? 4); // Default 4 days ahead to show full school week (Mon-Fri)
    const gridPast = Number(student.grid?.pastDays ?? 0);

    // WeekView: Calculate required days based on current day of week (same logic as frontend)
    let minNextDaysForWeekView = gridNext;
    if (weekView) {
      const dayOfWeek = baseNow.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
      const currentHour = baseNow.getHours();

      // Determine if we show current week or next week (same logic as grid.js)
      let weekOffset = 0;
      if (dayOfWeek === 5) {
        // Friday - advance to next week after 16:00 (unless debugDate is set)
        const isDebugMode = config && typeof config.debugDate === 'string' && config.debugDate;
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

    gridNextDays = Math.max(
      0,
      Number.isFinite(gridNext) ? gridNext : 4,
      minNextDaysForWeekView,
      Number.isFinite(nextDaysValue) ? nextDaysValue : 2
    );
    gridPastDays = Math.max(0, Number.isFinite(gridPast) ? gridPast : 0, Number.isFinite(pastDaysValue) ? pastDaysValue : 0);
  } else {
    gridNextDays = Math.max(0, Number.isFinite(nextDaysValue) ? nextDaysValue : 2);
    gridPastDays = Math.max(0, Number.isFinite(pastDaysValue) ? pastDaysValue : 0);
  }

  const timetableStart = new Date(baseNow);
  const timetableEnd = new Date(baseNow);
  timetableStart.setDate(timetableStart.getDate() - gridPastDays);
  // API end date is exclusive, so add 1 day to include the last day
  timetableEnd.setDate(timetableEnd.getDate() + Math.floor(gridNextDays) + 1);

  // Exams range (frontend provides defaults now)
  const examsNextDays = student.exams?.nextDays ?? student.examsDaysAhead ?? student.exams?.daysAhead ?? 0;
  let validatedExamsDays = examsNextDays;
  if (validatedExamsDays < 1 || validatedExamsDays > 360 || isNaN(validatedExamsDays)) {
    validatedExamsDays = 21; // Fallback to default if invalid
  }
  const examsStart = new Date(baseNow);
  const examsEnd = new Date(baseNow);
  examsStart.setDate(examsStart.getDate() - (student.exams?.pastDays ?? student.pastDays ?? 0));
  examsEnd.setDate(examsEnd.getDate() + validatedExamsDays);

  // Absences range (frontend provides defaults now)
  const absPast = Number.isFinite(Number(student.absences?.pastDays ?? student.absencesPastDays ?? 0))
    ? Number(student.absences?.pastDays ?? student.absencesPastDays ?? 0)
    : 0;
  const absFuture = Number.isFinite(Number(student.absences?.nextDays ?? student.absencesFutureDays ?? 0))
    ? Number(student.absences?.nextDays ?? student.absencesFutureDays ?? 0)
    : 0;
  const absencesStart = new Date(baseNow);
  const absencesEnd = new Date(baseNow);
  absencesStart.setDate(absencesStart.getDate() - absPast);
  absencesEnd.setDate(absencesEnd.getDate() + absFuture);

  // Homework range (calculate maximum range across all widgets)
  // Check homework-specific config first
  const hwNextDays = Number(student.homework?.nextDays ?? student.homework?.daysAhead ?? 0);
  const hwPastDays = Number(student.homework?.pastDays ?? 0);

  const allRanges = [
    { pastDays: gridPastDays, futureDays: gridNextDays },
    fetchExams && examsNextDays > 0 ? { pastDays: student.exams?.pastDays ?? student.pastDays ?? 0, futureDays: examsNextDays } : null,
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
    timetable: { start: timetableStart, end: timetableEnd, pastDays: gridPastDays, nextDays: gridNextDays },
    exams: { start: examsStart, end: examsEnd, nextDays: validatedExamsDays },
    homework: { start: homeworkStart, end: homeworkEnd, pastDays: maxPastDays, futureDays: maxFutureDays },
    absences: { start: absencesStart, end: absencesEnd, pastDays: absPast, futureDays: absFuture },
  };
}

module.exports = {
  // Data transformation exports
  sanitizeHtmlText,
  normalizeDateToInteger,
  normalizeTimeToMinutes,
  compactHolidays,
  formatDate,
  // Date range calculation exports
  calculateFetchRanges,
};
