/**
 * Data Orchestration Service
 * Combines data transformation and date range calculations for WebUntis API responses
 * Handles normalization, date range calculations for fetches
 */

const sanitizeHtml = require("sanitize-html");
const { decodeHTML } = require("entities");

const RICH_TEXT_ALLOWED_TAGS = [
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "del",
  "sub",
  "sup",
  "small",
  "br",
  "p",
  "div",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
];
const RICH_TEXT_BLOCK_TAGS = /<\/?(?:p|div|li|h[1-6])>/gi;

/**
 * Sanitizes HTML text by removing tags and decoding entities
 *
 * @param {string} text - HTML text to sanitize
 * @param {boolean} [preserveLineBreaks=true] - Whether to preserve <br> tags as newlines
 * @returns {string} Sanitized text
 *
 * Process:
 * 1. Use sanitize-html to strip all HTML tags (optionally preserving <br> tags)
 * 2. Convert remaining <br> tags to newlines (if preserveLineBreaks is true)
 * 3. Remove any leftover HTML tags as a safety net
 * 4. Clean up extra whitespace; when preserveLineBreaks is true, newlines are kept
 */
function stripAllHtml(text, preserveLineBreaks = true) {
  if (!text) return "";

  let result = String(text);

  // First, sanitize HTML: remove all tags, optionally allowing <br> so we can
  // preserve line breaks. No attributes are allowed.
  result = sanitizeHtml(result, {
    allowedTags: preserveLineBreaks ? ["br"] : [],
    allowedAttributes: {},
    // sanitize-html re-serializes to valid HTML, so entities like &amp; survive as entities,
    // not as the literal characters they represent - decoded explicitly below.
  });

  if (preserveLineBreaks) {
    // Convert any remaining <br> tags to newlines
    result = result.replace(/<br\s*\/?>/gi, "\n");
  }

  // As a safety net, strip any leftover tags that might remain.
  // Apply repeatedly until no further changes occur to avoid incomplete
  // multi-character sanitization where removing one tag exposes another.
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, "");
  } while (result !== previous);

  // Decode entities (&amp;, &auml;, &#228;, ...) into their literal characters now that no
  // tags remain, so a decoded "<" can't be mistaken for the start of a tag above.
  result = decodeHTML(result);

  if (preserveLineBreaks) {
    // Normalize whitespace but keep single newlines
    result = result.replace(/[^\S\n]+/g, " ");
    result = result.replace(/\n{2,}/g, "\n");
    result = result
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim();
  } else {
    // Collapse all whitespace when line breaks are not preserved
    result = result.replace(/\s+/g, " ").trim();
  }

  return result;
}

/**
 * Sanitize a field that is allowed to keep formatting markup.
 *
 * Keeps the tags in RICH_TEXT_ALLOWED_TAGS (b, strong, i, em, ...), drops every attribute and
 * turns block and <br> tags into newlines. Text stays entity-encoded, so the result is safe HTML:
 * insert it as HTML and do NOT escape it again. A frontend that escapes its fields needs
 * richTextToPlainText() instead (see docs/API_REFERENCE.md, "HTML Sanitization").
 *
 * Note what the second parameter does NOT do: it never affects HTML removal. It only decides
 * whether the Markdown emphasis characters `_` and `*` survive as literal characters.
 *
 * @param {string} text - Raw field value from the WebUntis API
 * @param {boolean} [keepMarkdownMarkers=false] - Keep literal `_` and `*` instead of stripping them
 * @returns {string} Sanitized rich text (safe HTML, entities still encoded)
 */
function sanitizeRichText(text, keepMarkdownMarkers = false) {
  if (!text) return "";

  let result = sanitizeHtml(String(text), {
    allowedTags: RICH_TEXT_ALLOWED_TAGS,
    allowedAttributes: {},
  });

  result = result.replace(/<br\s*\/?>/gi, "\n").replace(RICH_TEXT_BLOCK_TAGS, "\n");

  // Entities stay encoded: decoding them here would turn text such as "&lt;img onerror=…&gt;"
  // back into live markup after the sanitizer already ran. Plain-text consumers use
  // richTextToPlainText(), which decodes only once every tag is gone.

  if (!keepMarkdownMarkers) result = result.replace(/[_*]/g, "");

  return result
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * The same field as plain text, for frontends that escape it before rendering: every tag removed,
 * then the entities decoded, so "3&amp;4" reads "3&4" (issue #88) and "<b>" is not shown literally.
 *
 * @param {string} text - Raw field value from the WebUntis API
 * @param {boolean} [keepMarkdownMarkers=false] - Keep literal `_` and `*` instead of stripping them
 * @returns {string} Plain text, line breaks kept as "\n"; must be escaped before use as HTML
 */
function richTextToPlainText(text, keepMarkdownMarkers = false) {
  let result = sanitizeRichText(text, keepMarkdownMarkers);
  let previous;
  do {
    previous = result;
    result = result.replace(/<[^>]*>/g, "");
  } while (result !== previous);
  return decodeHTML(result).trim();
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
function normalizeDateToInteger(dateValue) {
  if (!dateValue) return null;

  if (typeof dateValue === "number" && dateValue > 10000000 && dateValue < 99991231) {
    return dateValue;
  }

  const inputDateStr = String(dateValue);
  if (inputDateStr.includes("-")) {
    const parts = inputDateStr.split("-");
    if (parts.length === 3) {
      const y = parts[0].padStart(4, "0");
      const m = parts[1].padStart(2, "0");
      const d = parts[2].padStart(2, "0");
      return parseInt(`${y}${m}${d}`, 10);
    }
  }

  const num = parseInt(String(dateValue).replace(/\D/g, ""), 10);
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
  if (typeof value !== "string") return null;

  const timeStr = value.trim();
  if (!timeStr.includes(":")) return null;

  const parts = timeStr.split(":");
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

  if (typeof time === "number" && time >= 0 && time < 2400) {
    return time;
  }

  const parsedHHMM = parseHHMMStringToInteger(String(time));
  if (parsedHHMM !== null) return parsedHHMM;

  const num = parseInt(String(time).replace(/\D/g, ""), 10);
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
    startDate: holiday?.startDate ?? normalizeDateToInteger(holiday?.start),
    endDate: holiday?.endDate ?? normalizeDateToInteger(holiday?.end),
  }));
}

/**
 * Extract holiday ranges from cached app/data (either `holidays` or `data.holidays`).
 *
 * @param {Object|null} appData - Compacted app/data from the auth session
 * @returns {Array} Compacted holidays (see compactHolidays)
 */
function extractHolidaysFromAppData(appData) {
  if (!appData) return [];
  if (Array.isArray(appData.holidays)) return compactHolidays(appData.holidays);
  if (Array.isArray(appData.data?.holidays)) return compactHolidays(appData.data.holidays);
  return [];
}

/**
 * Compact timegrid data to the fields the frontend uses: startTime, endTime, name.
 * Handles both the app/data format (array of rows with timeUnits) and the derived format
 * (direct array of time slots from extractTimegridFromTimetable).
 *
 * @param {Array} rawGrid - Raw timegrid data
 * @returns {Array} Compacted timeUnits array
 */
function compactTimegrid(rawGrid) {
  if (!Array.isArray(rawGrid) || rawGrid.length === 0) return [];

  const firstRow = rawGrid[0];
  if (firstRow && Array.isArray(firstRow.timeUnits)) {
    return firstRow.timeUnits.map((u) => ({ startTime: u.startTime, endTime: u.endTime, name: u.name }));
  }

  if (firstRow?.startTime && firstRow.endTime) {
    return rawGrid.map((u) => ({ startTime: u.startTime, endTime: u.endTime, name: u.name || "" }));
  }

  return [];
}

/**
 * Derive a timegrid (period slots) from timetable lessons when app/data carries no timeGrid.
 * Each period runs from one distinct start time to the next; the last one ends at its lesson's
 * end time (or start + 45 minutes as a last resort).
 *
 * @param {Array} timetable - Normalized lessons (startTime/endTime as "HH:MM" strings or HHMM)
 * @returns {Array} timeUnits array with { startTime, endTime, name }
 */
function extractTimegridFromTimetable(timetable) {
  if (!Array.isArray(timetable) || timetable.length === 0) return [];

  const startTimes = new Set();
  timetable.forEach((lesson) => {
    if (lesson.startTime) startTimes.add(lesson.startTime);
  });
  if (startTimes.size === 0) return [];

  const sortedStarts = Array.from(startTimes).sort(
    (a, b) => (normalizeTimeToHHMM(a) || 0) - (normalizeTimeToHHMM(b) || 0),
  );

  return sortedStarts.map((startTime, i) => {
    let endTime = sortedStarts[i + 1];
    if (!endTime) {
      const lessonsWithThisStart = timetable.filter((l) => l.startTime === startTime);
      endTime = lessonsWithThisStart.length > 0 ? lessonsWithThisStart[0].endTime : null;
      if (!endTime) {
        const hhmm = normalizeTimeToHHMM(startTime) || 0;
        const minutes = Math.floor(hhmm / 100) * 60 + (hhmm % 100) + 45;
        endTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
      }
    }
    return { startTime, endTime, name: `${i + 1}` };
  });
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
 * @param {boolean} [input.options.gridHideWeekends] - Whether grid hides empty weekend days in rolling mode
 * @param {boolean} [input.options.lessonsHideWeekends] - Whether lessons hides empty weekend days
 * @param {boolean} [input.options.debugDateEnabled] - Whether debug date mode is active
 * @returns {Object} Date ranges for timetable, exams, homework, absences
 */
function isWeekendDay(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function calculateCalendarOffsetForVisibleWeekdays(baseNow, visibleDays, direction) {
  if (!Number.isFinite(visibleDays) || visibleDays <= 0) return 0;

  let offset = 0;
  let collected = 0;
  while (collected < visibleDays && Math.abs(offset) <= 366) {
    offset += direction;
    const candidate = new Date(baseNow);
    candidate.setDate(candidate.getDate() + offset);
    if (!isWeekendDay(candidate)) {
      collected += 1;
    }
  }

  return Math.abs(offset);
}

/**
 * How many days ahead the grid's week view has to reach: to the Friday of the week it shows.
 * From Saturday on (and on Friday from 16:00, unless a debugDate froze the clock) that is next week.
 */
function weekViewNextDays(baseNow, debugDateEnabled) {
  const dayOfWeek = baseNow.getDay(); // 0 = Sunday ... 6 = Saturday
  const showsNextWeek =
    dayOfWeek === 6 || dayOfWeek === 0 || (dayOfWeek === 5 && !debugDateEnabled && baseNow.getHours() >= 16);
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const fridayOffset = daysToMonday + (showsNextWeek ? 7 : 0) + 4;
  return Math.max(0, fridayOffset);
}

/**
 * A widget's day range in calendar days. With hideWeekends the configured counts are weekdays, so
 * the calendar range grows by the weekends in between (starting on a weekend counts one day more).
 */
function widgetDayRange(baseNow, nextDays, pastDays, hideWeekends) {
  if (!hideWeekends) return { next: nextDays, past: pastDays };
  return {
    next: calculateCalendarOffsetForVisibleWeekdays(baseNow, nextDays + (isWeekendDay(baseNow) ? 1 : 0), 1),
    past: calculateCalendarOffsetForVisibleWeekdays(baseNow, pastDays, -1),
  };
}

/** Timetable range: the widest of grid, lessons and the global nextDays/pastDays. */
function timetableDayRange(baseNow, fetchPlan, days, options) {
  const wantsGrid = Boolean(fetchPlan.wantsGridWidget);
  const wantsLessons = Boolean(fetchPlan.wantsLessonsWidget);
  let next = 0;
  let past = 0;

  if (wantsGrid) {
    const weekView = Boolean(options.gridWeekView);
    // hideWeekends has no effect on the week view, which always shows Monday to Friday.
    const grid = widgetDayRange(
      baseNow,
      Number(days.gridNextDays ?? 4),
      Number(days.gridPastDays ?? 0),
      !weekView && Boolean(options.gridHideWeekends),
    );
    const weekViewNext = weekView ? weekViewNextDays(baseNow, Boolean(options.debugDateEnabled)) : grid.next;
    next = Math.max(next, grid.next, weekViewNext);
    past = Math.max(past, grid.past);
  }

  if (wantsLessons) {
    const lessons = widgetDayRange(
      baseNow,
      Number(days.lessonsNextDays ?? 2),
      Number(days.lessonsPastDays ?? 0),
      Boolean(options.lessonsHideWeekends),
    );
    next = Math.max(next, lessons.next);
    past = Math.max(past, lessons.past);
  }

  if (wantsGrid || wantsLessons) {
    const globalNext = Number(days.globalNextDays ?? 2);
    const globalPast = Number(days.globalPastDays ?? 0);
    next = Math.max(next, Number.isFinite(globalNext) ? globalNext : 2);
    past = Math.max(past, Number.isFinite(globalPast) ? globalPast : 0);
  }

  return { next, past };
}

/** baseNow shifted by a number of days (a copy). */
function shiftDays(baseNow, offset) {
  const date = new Date(baseNow);
  date.setDate(date.getDate() + offset);
  return date;
}

/** A finite number, or 0. */
function finiteOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Homework is fetched once for all widgets, so its range covers every other range that is in use.
 * Without an own homework nextDays and less than a week ahead it looks four weeks ahead.
 */
function homeworkDayRange(timetable, fetchPlan, days, absences) {
  const examsNextDays = Number(days.examsNextDays ?? 0);
  const hwNextDays = Number(days.homeworkNextDays ?? 0);
  const hwPastDays = Number(days.homeworkPastDays ?? 0);

  const ranges = [{ pastDays: timetable.past, futureDays: timetable.next }];
  if (fetchPlan.fetchExams && examsNextDays > 0) {
    ranges.push({ pastDays: Number(days.examsPastDays ?? days.globalPastDays ?? 0), futureDays: examsNextDays });
  }
  if (fetchPlan.fetchAbsences && (absences.past > 0 || absences.next > 0)) {
    ranges.push({ pastDays: absences.past, futureDays: absences.next });
  }
  if (hwNextDays > 0 || hwPastDays > 0) {
    ranges.push({ pastDays: hwPastDays, futureDays: hwNextDays });
  }

  let past = 0;
  let next = 0;
  for (const range of ranges) {
    past = Math.max(past, range.pastDays || 0);
    next = Math.max(next, range.futureDays || 0);
  }
  if (hwNextDays === 0 && next < 7) {
    next = 28;
  }
  return { past, next };
}

/**
 * Date ranges to fetch for the timetable, exams, homework and absences.
 *
 * @param {Object} input - { baseNow: Date, fetchPlan, days, options }
 * @returns {Object} { timetable, exams, homework, absences } with start/end Dates and day counts
 */
function calculateFetchRanges(input = {}) {
  const { baseNow, fetchPlan = {}, days = {}, options = {} } = input;
  if (!(baseNow instanceof Date) || Number.isNaN(baseNow.getTime())) {
    throw new Error("calculateFetchRanges requires a valid baseNow Date");
  }

  const timetable = timetableDayRange(baseNow, fetchPlan, days, options);

  // Exams: 1..360 days ahead, anything else falls back to three weeks.
  const examsNextDays = Number(days.examsNextDays ?? 0);
  const validatedExamsDays =
    examsNextDays < 1 || examsNextDays > 360 || Number.isNaN(examsNextDays) ? 21 : examsNextDays;
  const examsPastDays = Number(days.examsPastDays ?? days.globalPastDays ?? 0);

  const absences = { past: finiteOrZero(days.absencesPastDays), next: finiteOrZero(days.absencesNextDays) };
  const homework = homeworkDayRange(timetable, fetchPlan, days, absences);

  return {
    timetable: {
      start: shiftDays(baseNow, -timetable.past),
      // The API end date is exclusive: one more day includes the last one.
      end: shiftDays(baseNow, Math.floor(timetable.next) + 1),
      pastDays: timetable.past,
      nextDays: timetable.next,
    },
    exams: {
      start: shiftDays(baseNow, -examsPastDays),
      end: shiftDays(baseNow, validatedExamsDays),
      nextDays: validatedExamsDays,
    },
    homework: {
      start: shiftDays(baseNow, -homework.past),
      end: shiftDays(baseNow, homework.next),
      pastDays: homework.past,
      futureDays: homework.next,
    },
    absences: {
      start: shiftDays(baseNow, -absences.past),
      end: shiftDays(baseNow, absences.next),
      pastDays: absences.past,
      futureDays: absences.next,
    },
  };
}

module.exports = {
  // Data transformation exports
  stripAllHtml,
  sanitizeRichText,
  richTextToPlainText,
  normalizeDateToInteger,
  parseHHMMStringToInteger,
  normalizeTimeToHHMM,
  compactHolidays,
  compactTimegrid,
  extractHolidaysFromAppData,
  extractTimegridFromTimetable,
  // Date range calculation exports
  calculateFetchRanges,
};
