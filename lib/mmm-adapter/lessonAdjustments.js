/**
 * Config-driven timetable adjustments (issue #91):
 * - `excludeLessons`: hide lessons whose subject, student group or lesson text matches an entry
 *   (plain string = case-insensitive substring, "/pattern/flags" = regular expression); homework
 *   and exams whose subject matches are hidden as well.
 * - `addLessons`: add own lessons that WebUntis does not know about (music school, tutoring, ...),
 *   either recurring per weekday or on a single date.
 *
 * Both options can be set at module level and overridden per student (students[].excludeLessons /
 * students[].addLessons). Adjustments run on the compacted lesson list, so both widgets (grid and
 * lessons) see the same result.
 */

const REGEX_ENTRY = /^\/(.+)\/([a-z]*)$/;

// ISO weekday numbers (Monday = 1 ... Sunday = 7); English and German names/abbreviations.
const WEEKDAY_NAMES = {
  mon: 1,
  monday: 1,
  mo: 1,
  montag: 1,
  tue: 2,
  tuesday: 2,
  di: 2,
  dienstag: 2,
  wed: 3,
  wednesday: 3,
  mi: 3,
  mittwoch: 3,
  thu: 4,
  thursday: 4,
  do: 4,
  donnerstag: 4,
  fri: 5,
  friday: 5,
  fr: 5,
  freitag: 5,
  sat: 6,
  saturday: 6,
  sa: 6,
  samstag: 6,
  sun: 7,
  sunday: 7,
  so: 7,
  sonntag: 7,
};

/**
 * Build a predicate for one excludeLessons entry.
 *
 * @param {*} entry - String (substring) or "/pattern/flags" (regular expression)
 * @returns {Function|null} (text) => boolean, or null when the entry is unusable
 */
function buildMatcher(entry) {
  if (typeof entry !== "string" || entry.trim() === "") return null;
  const regexParts = entry.trim().match(REGEX_ENTRY);
  if (regexParts) {
    try {
      const re = new RegExp(regexParts[1], regexParts[2]);
      return (text) => {
        re.lastIndex = 0;
        return re.test(text);
      };
    } catch {
      return null;
    }
  }
  const needle = entry.trim().toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}

function lessonMatchTexts(lesson) {
  const texts = [];
  for (const key of ["subjects", "studentGroups"]) {
    const first = Array.isArray(lesson?.[key]) ? lesson[key][0] : null;
    if (first?.name) texts.push(String(first.name));
    if (first?.longname) texts.push(String(first.longname));
  }
  if (lesson?.lessonText) texts.push(String(lesson.lessonText));
  return texts;
}

/**
 * Parse "HH:MM" strings or HHMM integers into an HHMM integer.
 *
 * @param {string|number} value
 * @returns {number|null}
 */
function parseTime(value) {
  let hours;
  let minutes;
  if (typeof value === "number" && Number.isInteger(value)) {
    hours = Math.floor(value / 100);
    minutes = value % 100;
  } else if (typeof value === "string") {
    const parts = value.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!parts) return null;
    hours = Number(parts[1]);
    minutes = Number(parts[2]);
  } else {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 100 + minutes;
}

/**
 * Parse "YYYY-MM-DD" strings or YYYYMMDD integers into a YYYYMMDD integer.
 *
 * @param {string|number} value
 * @returns {number|null}
 */
function parseDate(value) {
  const digits = String(value ?? "").replace(/-/g, "");
  if (!/^\d{8}$/.test(digits)) return null;
  const ymd = Number(digits);
  const year = Math.floor(ymd / 10000);
  const month = Math.floor(ymd / 100) % 100;
  const day = ymd % 100;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return ymd;
}

function parseWeekday(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 7 ? value : null;
  if (typeof value !== "string") return null;
  return WEEKDAY_NAMES[value.trim().toLowerCase()] ?? null;
}

/**
 * Normalize one addLessons entry.
 *
 * @param {Object} entry - Raw config entry
 * @returns {{lesson: Object|null, error: string|null}}
 */
function normalizeAddLesson(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { lesson: null, error: "must be an object" };

  const startTime = parseTime(entry.startTime);
  const endTime = parseTime(entry.endTime);
  if (startTime === null) return { lesson: null, error: '"startTime" must be "HH:MM"' };
  if (endTime === null) return { lesson: null, error: '"endTime" must be "HH:MM"' };
  if (endTime <= startTime) return { lesson: null, error: '"endTime" must be after "startTime"' };

  const hasDate = entry.date !== undefined && entry.date !== null;
  const hasWeekday = entry.weekday !== undefined && entry.weekday !== null;
  if (hasDate === hasWeekday) return { lesson: null, error: 'needs either "weekday" or "date"' };

  let date = null;
  let weekdays = null;
  if (hasDate) {
    date = parseDate(entry.date);
    if (date === null) return { lesson: null, error: '"date" must be "YYYY-MM-DD"' };
  } else {
    const rawWeekdays = Array.isArray(entry.weekday) ? entry.weekday : [entry.weekday];
    weekdays = rawWeekdays.map(parseWeekday);
    if (weekdays.length === 0 || weekdays.includes(null)) {
      return { lesson: null, error: '"weekday" must be a weekday name (e.g. "mon") or 1-7 (Monday = 1)' };
    }
  }

  const from = entry.from === undefined || entry.from === null ? null : parseDate(entry.from);
  const until = entry.until === undefined || entry.until === null ? null : parseDate(entry.until);
  if (entry.from != null && from === null) return { lesson: null, error: '"from" must be "YYYY-MM-DD"' };
  if (entry.until != null && until === null) return { lesson: null, error: '"until" must be "YYYY-MM-DD"' };
  if (from !== null && until !== null && from > until) {
    return { lesson: null, error: '"from" must not be after "until"' };
  }

  if (typeof entry.subject !== "string" || entry.subject.trim() === "") {
    return { lesson: null, error: '"subject" must be a non-empty string' };
  }

  const toText = (v) => (typeof v === "string" ? v.trim() : "");
  return {
    lesson: {
      date,
      weekdays,
      from,
      until,
      startTime,
      endTime,
      subject: entry.subject.trim(),
      subjectShort: toText(entry.subjectShort) || entry.subject.trim(),
      teacher: toText(entry.teacher),
      room: toText(entry.room),
      text: toText(entry.text),
      showInHolidays: entry.showInHolidays === true,
    },
    error: null,
  };
}

/**
 * Validate excludeLessons/addLessons of one config level.
 *
 * @param {Object} config - Module config or student entry
 * @param {string} [prefix] - Label for messages (e.g. 'students[0].')
 * @returns {string[]} Warning messages
 */
function validateLessonAdjustments(config, prefix = "") {
  const warnings = [];
  if (!config || typeof config !== "object") return warnings;

  if (config.excludeLessons !== undefined && config.excludeLessons !== null) {
    if (Array.isArray(config.excludeLessons)) {
      config.excludeLessons.forEach((entry, idx) => {
        if (!buildMatcher(entry)) {
          warnings.push(
            `${prefix}excludeLessons[${idx}]: must be a non-empty string or a valid "/regex/" – entry ignored`,
          );
        }
      });
    } else {
      warnings.push(`${prefix}excludeLessons must be an array of strings – option ignored`);
    }
  }

  if (config.addLessons !== undefined && config.addLessons !== null) {
    if (Array.isArray(config.addLessons)) {
      config.addLessons.forEach((entry, idx) => {
        const { error } = normalizeAddLesson(entry);
        if (error) warnings.push(`${prefix}addLessons[${idx}]: ${error} – entry ignored`);
      });
    } else {
      warnings.push(`${prefix}addLessons must be an array of lesson objects – option ignored`);
    }
  }

  return warnings;
}

function ymdToUtcDate(ymd) {
  return new Date(Date.UTC(Math.floor(ymd / 10000), (Math.floor(ymd / 100) % 100) - 1, ymd % 100));
}

function utcDateToYmd(date) {
  return date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate();
}

function isHoliday(ymd, holidays) {
  return holidays.some((holiday) => Number(holiday?.startDate) <= ymd && ymd <= Number(holiday?.endDate));
}

/**
 * Expand addLessons into raw lesson objects (the shape schemas.lesson compacts) for every
 * matching date inside [startYmd, endYmd].
 *
 * @param {Array} addLessons - Config entries
 * @param {Object} range
 * @param {number|null} range.startYmd - First date of the timetable range
 * @param {number|null} range.endYmd - Last date of the timetable range
 * @param {Array} [range.holidays] - Compacted holidays ({startDate, endDate}); skipped unless showInHolidays
 * @returns {Object[]} Raw lessons
 */
function buildCustomLessons(addLessons, { startYmd, endYmd, holidays = [] }) {
  if (!Array.isArray(addLessons) || addLessons.length === 0) return [];
  if (!Number.isInteger(startYmd) || !Number.isInteger(endYmd) || endYmd < startYmd) return [];

  const knownHolidays = Array.isArray(holidays) ? holidays : [];
  const result = [];

  addLessons.forEach((entry, idx) => {
    const { lesson } = normalizeAddLesson(entry);
    if (!lesson) return;

    const pushLesson = (ymd) => {
      if (ymd < startYmd || ymd > endYmd) return;
      if (lesson.from !== null && ymd < lesson.from) return;
      if (lesson.until !== null && ymd > lesson.until) return;
      if (!lesson.showInHolidays && isHoliday(ymd, knownHolidays)) return;
      result.push({
        id: `custom-${idx}-${ymd}`,
        date: ymd,
        startTime: lesson.startTime,
        endTime: lesson.endTime,
        subjects: [{ name: lesson.subjectShort, longname: lesson.subject }],
        teachers: lesson.teacher ? [{ name: lesson.teacher, longname: lesson.teacher }] : [],
        rooms: lesson.room ? [{ name: lesson.room, longname: lesson.room }] : [],
        lessonText: lesson.text,
        status: "REGULAR",
      });
    };

    if (lesson.date !== null) {
      pushLesson(lesson.date);
      return;
    }

    for (let day = ymdToUtcDate(startYmd); utcDateToYmd(day) <= endYmd; day.setUTCDate(day.getUTCDate() + 1)) {
      const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
      if (lesson.weekdays.includes(isoWeekday)) pushLesson(utcDateToYmd(day));
    }
  });

  return result;
}

function filterExcludedItems(items, excludeLessons, getTexts) {
  if (!Array.isArray(items) || !Array.isArray(excludeLessons) || excludeLessons.length === 0) return items;
  const matchers = excludeLessons.map(buildMatcher).filter(Boolean);
  if (matchers.length === 0) return items;
  return items.filter((item) => {
    const texts = getTexts(item);
    return !matchers.some((matches) => texts.some((text) => matches(text)));
  });
}

/**
 * Remove lessons matching any excludeLessons entry (subject, student group, lesson text).
 *
 * @param {Object[]} lessons - Compacted lessons
 * @param {Array} excludeLessons - Config entries
 * @returns {Object[]} Remaining lessons
 */
function filterExcludedLessons(lessons, excludeLessons) {
  return filterExcludedItems(lessons, excludeLessons, lessonMatchTexts);
}

/**
 * Remove homework whose subject matches an excludeLessons entry, so hidden lessons do not
 * leave their homework behind in the homework widget.
 *
 * @param {Object[]} homework - Compacted homework ({subject: {name, longname}})
 * @param {Array} excludeLessons - Config entries
 * @returns {Object[]} Remaining homework
 */
function filterExcludedHomework(homework, excludeLessons) {
  return filterExcludedItems(homework, excludeLessons, (hw) =>
    [hw?.subject?.name, hw?.subject?.longname].filter(Boolean).map(String),
  );
}

/**
 * Remove exams whose subject matches an excludeLessons entry.
 *
 * @param {Object[]} exams - Compacted exams ({subject: string})
 * @param {Array} excludeLessons - Config entries
 * @returns {Object[]} Remaining exams
 */
function filterExcludedExams(exams, excludeLessons) {
  return filterExcludedItems(exams, excludeLessons, (exam) => (exam?.subject ? [String(exam.subject)] : []));
}

/**
 * Per-student option with module-level fallback (students[].X overrides config.X).
 *
 * @param {Object} student - Student config
 * @param {Object} config - Module config
 * @param {string} key - Option name
 * @returns {Array}
 */
function resolveListOption(student, config, key) {
  const value = student?.[key] ?? config?.[key];
  return Array.isArray(value) ? value : [];
}

module.exports = {
  buildCustomLessons,
  filterExcludedExams,
  filterExcludedHomework,
  filterExcludedLessons,
  resolveListOption,
  validateLessonAdjustments,
};
