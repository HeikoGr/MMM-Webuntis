/**
 * Payload Builder
 * Constructs the GOT_DATA payload from fetched data with compacting,
 * holiday mapping, warning collection, and debug dumping
 */

const fs = require('fs');
const path = require('path');
const { compactArray, schemas } = require('./payloadCompactor');
const { tryOrNull } = require('./errorUtils');

/**
 * Build GOT_DATA payload from fetched and compacted data
 * @param {Object} params - Build parameters
 * @param {Object} params.student - Student configuration
 * @param {Array} params.grid - Timegrid data
 * @param {Array} params.timetable - Timetable lessons
 * @param {Array} params.rawExams - Raw exams data
 * @param {Array} params.hwResult - Homework results
 * @param {Array} params.rawAbsences - Raw absences data
 * @param {Array} params.rawMessagesOfDay - Raw messages data
 * @param {Array} params.compactHolidays - Pre-compacted holidays
 * @param {boolean} params.fetchHomeworks - Whether homework was fetched
 * @param {boolean} params.fetchAbsences - Whether absences were fetched
 * @param {boolean} params.fetchMessagesOfDay - Whether messages were fetched
 * @param {Object} params.dateRanges - Pre-calculated date ranges
 * @param {number} params.todayYmd - Today's date as YYYYMMDD integer
 * @param {boolean} params.fetchTimetable - Whether timetable was fetched
 * @param {Object|null} params.activeHoliday - Active holiday for today (if any)
 * @param {Object} params.moduleConfig - Module configuration (for warnings and debug)
 * @param {Set} params.currentFetchWarnings - Set for deduplicating warnings across students
 * @param {Function} params.compactTimegrid - Function to compact timegrid
 * @param {Function} params.checkEmptyDataWarning - Function to check for empty data warnings
 * @param {Function} params.mmLog - Logging function
 * @param {Function} params.cleanupOldDebugDumps - Function to cleanup old debug dumps
 * @returns {Object} Complete payload ready for frontend
 */
function buildGotDataPayload(params) {
  const {
    student,
    grid,
    timetable,
    rawExams,
    hwResult,
    rawAbsences,
    rawMessagesOfDay,
    compactHolidays,
    fetchHomeworks,
    fetchAbsences,
    fetchMessagesOfDay,
    dateRanges,
    todayYmd,
    fetchTimetable,
    activeHoliday,
    moduleConfig,
    currentFetchWarnings,
    compactTimegrid,
    checkEmptyDataWarning,
    mmLog,
    cleanupOldDebugDumps,
  } = params;

  // Compact payload to reduce memory
  const compactGrid = compactTimegrid(grid);
  const compactTimetable = compactArray(timetable, schemas.lesson);
  const compactExams = compactArray(rawExams, schemas.exam);
  const compactHomeworks = fetchHomeworks ? compactArray(hwResult, schemas.homework) : [];
  const compactAbsences = fetchAbsences ? compactArray(rawAbsences, schemas.absence) : [];
  const compactMessagesOfDay = fetchMessagesOfDay ? compactArray(rawMessagesOfDay, schemas.message) : [];

  // Build holidayByDate mapping
  const toYmd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const rangeStartYmd = toYmd(dateRanges.timetable.start);
  const rangeEndYmd = toYmd(dateRanges.timetable.end);
  const holidayByDate = (() => {
    if (!Array.isArray(compactHolidays) || compactHolidays.length === 0) return {};
    const map = {};
    for (let ymd = rangeStartYmd; ymd <= rangeEndYmd; ) {
      const holiday = compactHolidays.find((h) => Number(h.startDate) <= ymd && ymd <= Number(h.endDate));
      if (holiday) map[ymd] = holiday;
      const year = Math.floor(ymd / 10000);
      const month = Math.floor((ymd % 10000) / 100) - 1;
      const day = ymd % 100;
      const tmp = new Date(year, month, day);
      tmp.setDate(tmp.getDate() + 1);
      ymd = tmp.getFullYear() * 10000 + (tmp.getMonth() + 1) * 100 + tmp.getDate();
    }
    return map;
  })();

  // Build payload
  const payload = {
    title: student.title,
    studentId: student.studentId,
    config: student,
    timeUnits: compactGrid,
    timetableRange: compactTimetable,
    exams: compactExams,
    homeworks: compactHomeworks,
    absences: compactAbsences,
    messagesOfDay: compactMessagesOfDay,
    holidays: compactHolidays,
    holidayByDate,
    currentHoliday: activeHoliday,
    absencesUnavailable: false,
  };

  // Attach metadata for debug dumps (version, environment, timestamp)
  try {
    const os = require('os');
    const pkg = tryOrNull(() => require(path.join(__dirname, '..', 'package.json')));
    payload.meta = {
      moduleVersion: pkg?.version || 'unknown',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hostname: tryOrNull(() => os.hostname()) || 'unknown',
      pid: process.pid,
      fetchedAt: new Date().toISOString(),
    };
    // eslint-disable-next-line no-unused-vars
  } catch (e) {
    // non-fatal
  }

  // Collect warnings - use shared warnings set from caller to dedupe across students
  let warnings = [];
  const addWarning = (msg) => {
    if (!msg) return;
    if (!currentFetchWarnings.has(msg)) {
      warnings.push(msg);
      currentFetchWarnings.add(msg);
    }
  };

  if (moduleConfig && Array.isArray(moduleConfig.__warnings)) {
    moduleConfig.__warnings.forEach(addWarning);
  }
  if (payload.config && Array.isArray(payload.config.__warnings)) {
    payload.config.__warnings.forEach(addWarning);
  }

  // Add empty data warnings (skip during holidays)
  if (!activeHoliday && timetable.length === 0 && fetchTimetable && student.daysToShow > 0) {
    const emptyWarn = checkEmptyDataWarning(timetable, 'lessons', student.title, true);
    addWarning(emptyWarn);
  }
  if (activeHoliday) {
    mmLog('debug', student, `Skipping empty lessons warning: "${activeHoliday.longName || activeHoliday.name}" (today=${todayYmd})`);
  }

  payload._warnings = Array.from(new Set(warnings));

  // Optional debug dump (non-blocking: errors logged but don't break flow)
  tryOrNull(
    () => {
      if (!moduleConfig?.dumpBackendPayloads) return;

      const dumpDir = path.join(__dirname, '..', 'debug_dumps');
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      cleanupOldDebugDumps(dumpDir, 10);

      const safeTitle = (student?.title || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fname = `${Date.now()}_${safeTitle}_api.json`;
      const target = path.join(dumpDir, fname);

      // Create a sanitized copy for dumping so we never mutate runtime `payload`.
      let safePayload;
      try {
        safePayload = JSON.parse(JSON.stringify(payload));
        // eslint-disable-next-line no-unused-vars
      } catch (e) {
        safePayload = Object.assign({}, payload);
      }

      // Redact sensitive keys (only for the dump). Do not modify original payload.
      const redactRegex = /password$|pass(word)?$|token$|auth$|authToken$|cookie$|jsessionid$|bearer$|accessToken$|refreshToken$/i;
      const redact = (obj) => {
        if (!obj || typeof obj !== 'object') return;
        for (const k of Object.keys(obj)) {
          try {
            if (redactRegex.test(k)) {
              obj[k] = '<REDACTED>';
            } else {
              const v = obj[k];
              if (v && typeof v === 'object') redact(v);
            }
            // eslint-disable-next-line no-unused-vars
          } catch (e) {
            // ignore individual redact errors
          }
        }
      };
      redact(safePayload);

      // Explicit redaction for common sensitive config fields (fallback)
      try {
        if (safePayload && safePayload.config && typeof safePayload.config === 'object') {
          [
            'password',
            'token',
            '_authService',
            'sessionId',
            'cookie',
            'jsessionid',
            'auth',
            'authToken',
            'accessToken',
            'refreshToken',
          ].forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(safePayload.config, k)) safePayload.config[k] = '<REDACTED>';
          });
        }
        // eslint-disable-next-line no-unused-vars
      } catch (e) {
        // ignore
      }

      // Reorder dump: `meta` first, then `config` with direct config values
      // followed by config subobjects, then the remaining top-level keys.
      const orderedPayload = {};
      if (safePayload.meta) orderedPayload.meta = safePayload.meta;

      if (safePayload.config) {
        const cfg = safePayload.config;
        const prim = {};
        const objs = {};
        Object.keys(cfg).forEach((k) => {
          const v = cfg[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) objs[k] = v;
          else prim[k] = v;
        });
        orderedPayload.config = Object.assign({}, prim, objs);
      }

      // Add remaining top-level keys in original order, skipping ones already added.
      Object.keys(safePayload).forEach((k) => {
        if (k === 'meta' || k === 'config') return;
        if (Object.prototype.hasOwnProperty.call(orderedPayload, k)) return;
        orderedPayload[k] = safePayload[k];
      });

      fs.writeFileSync(target, JSON.stringify(orderedPayload, null, 2), 'utf8');
      mmLog('debug', student, `Wrote debug payload to ${path.join('debug_dumps', fname)} (sensitive fields redacted, ordered)`, 'debug');
    },
    (err) => mmLog('error', student, `Failed to write debug payload: ${err}`, 'debug')
  );

  mmLog(
    'debug',
    student,
    `✓ Final payload: ${compactTimetable.length} timetable, ${compactExams.length} exams, ${compactHomeworks.length} homework, ${compactAbsences.length} absences, ${compactMessagesOfDay.length} messages (after compacting)\n`
  );

  return payload;
}

module.exports = {
  buildGotDataPayload,
};
