/**
 * Payload Builder
 * Constructs the GOT_DATA payload from fetched data with compacting,
 * holiday ranges, warning collection, and debug dumping
 */

const fs = require('fs');
const path = require('path');
const { compactArray, schemas } = require('../webuntis/payloadCompactor');
const { tryOrNull } = require('../webuntis/errorUtils');

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
 * @param {number} params.todayYmd - Today's date as YYYYMMDD integer
 * @param {Object} params.fetchFlags - Fetch flags (timetable, timegrid, exams, homework, absences, messagesOfDay)
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
    todayYmd,
    fetchFlags,
    activeHoliday,
    moduleConfig,
    currentFetchWarnings,
    compactTimegrid,
    checkEmptyDataWarning,
    mmLog,
    cleanupOldDebugDumps,
    apiStatus = {}, // HTTP status codes for API endpoints
    dateRanges,
    moduleId,
    sessionId,
  } = params;

  const shouldFetchTimetable = Boolean(fetchFlags?.fetchTimetable);
  const shouldFetchHomeworks = Boolean(fetchFlags?.fetchHomeworks);
  const shouldFetchAbsences = Boolean(fetchFlags?.fetchAbsences);
  const shouldFetchMessagesOfDay = Boolean(fetchFlags?.fetchMessagesOfDay);

  // Compact payload to reduce memory
  const compactGrid = compactTimegrid(grid);
  const compactTimetable = compactArray(timetable, schemas.lesson);
  const compactExams = compactArray(rawExams, schemas.exam);
  const compactHomeworks = shouldFetchHomeworks ? compactArray(hwResult, schemas.homework) : [];
  const compactAbsences = shouldFetchAbsences ? compactArray(rawAbsences, schemas.absence) : [];
  const compactMessagesOfDay = shouldFetchMessagesOfDay ? compactArray(rawMessagesOfDay, schemas.message) : [];

  // Build payload
  // Inherit debugDate from moduleConfig to student config for frontend
  const studentWithDebugDate = {
    ...student,
    debugDate: student.debugDate ?? moduleConfig?.debugDate ?? null,
  };

  const parseDisplayWidgets = (displayMode) => {
    const lower = String(displayMode || '')
      .toLowerCase()
      .trim();
    if (!lower) return ['lessons', 'exams'];
    if (lower === 'grid') return ['grid'];
    if (lower === 'list') return ['lessons', 'exams'];

    const alias = {
      lesson: 'lessons',
      lessons: 'lessons',
      exam: 'exams',
      exams: 'exams',
      homework: 'homework',
      homeworks: 'homework',
      absence: 'absences',
      absences: 'absences',
      grid: 'grid',
      messages: 'messagesofday',
      messagesofday: 'messagesofday',
    };

    const widgets = [];
    lower
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .forEach((part) => {
        const mapped = alias[part];
        if (mapped && !widgets.includes(mapped)) widgets.push(mapped);
      });
    return widgets.length > 0 ? widgets : ['lessons', 'exams'];
  };

  const toYmd = (value) => {
    if (!(value instanceof Date)) return null;
    if (Number.isNaN(value.getTime())) return null;
    return value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate();
  };

  const rangeStartYmd = toYmd(dateRanges?.timetable?.start);
  const rangeEndYmd = toYmd(dateRanges?.timetable?.end);

  const payload = {
    contractVersion: 2,
    meta: {
      moduleVersion: 'unknown',
      generatedAt: new Date().toISOString(),
      moduleId: moduleId || null,
      sessionId: sessionId || null,
    },
    context: {
      student: {
        id: student.studentId ?? null,
        title: student.title || '',
      },
      config: studentWithDebugDate,
      timezone: moduleConfig?.timezone || 'Europe/Berlin',
      todayYmd,
      range: {
        startYmd: rangeStartYmd,
        endYmd: rangeEndYmd,
      },
      display: {
        mode: studentWithDebugDate?.mode ?? moduleConfig?.mode ?? 'verbose',
        widgets: parseDisplayWidgets(studentWithDebugDate?.displayMode),
      },
    },
    data: {
      timeUnits: compactGrid,
      lessons: compactTimetable,
      exams: compactExams,
      homework: compactHomeworks,
      absences: compactAbsences,
      messages: compactMessagesOfDay,
      holidays: {
        ranges: compactHolidays,
        current: activeHoliday,
      },
    },
    state: {
      fetch: {
        timegrid: Boolean(fetchFlags?.fetchTimegrid),
        timetable: shouldFetchTimetable,
        exams: Boolean(fetchFlags?.fetchExams),
        homework: shouldFetchHomeworks,
        absences: shouldFetchAbsences,
        messages: shouldFetchMessagesOfDay,
      },
      api: {
        timetable: apiStatus?.timetable ?? null,
        exams: apiStatus?.exams ?? null,
        homework: apiStatus?.homework ?? null,
        absences: apiStatus?.absences ?? null,
        messages: apiStatus?.messagesOfDay ?? apiStatus?.messages ?? null,
      },
      warnings: [],
      warningMeta: [],
    },
  };

  // Attach metadata for debug dumps (version, environment, timestamp)
  try {
    const os = require('os');
    const pkg = tryOrNull(() => require(path.join(__dirname, '..', '..', 'package.json')));
    payload.meta = {
      ...payload.meta,
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

  // Collect warnings.
  // Use payload-local dedupe for what gets sent to frontend, then mirror into
  // shared currentFetchWarnings for cross-student tracking.
  let warnings = [];
  const payloadWarningSet = new Set();
  const warningMetaByMessage = new Map();
  const addWarning = (msg, meta = null) => {
    if (!msg) return;
    if (payloadWarningSet.has(msg)) return;

    warnings.push(msg);
    payloadWarningSet.add(msg);

    if (currentFetchWarnings && typeof currentFetchWarnings.add === 'function') {
      currentFetchWarnings.add(msg);
    }

    if (meta && typeof meta === 'object') {
      warningMetaByMessage.set(msg, meta);
    }
  };

  if (moduleConfig && Array.isArray(moduleConfig.__warnings)) {
    moduleConfig.__warnings.forEach((warning) => addWarning(warning, { kind: 'config' }));
  }
  if (payload.context?.config && Array.isArray(payload.context.config.__warnings)) {
    payload.context.config.__warnings.forEach((warning) => addWarning(warning, { kind: 'config' }));
  }

  // Add empty data warnings (skip during holidays)
  // Important: only emit this warning when timetable API call itself succeeded.
  // Otherwise transient API/network errors (which fallback to []) can produce
  // misleading "No lessons found" messages.
  const timetableApiStatus = Number(apiStatus?.timetable);
  const hasSuccessfulTimetableStatus = Number.isFinite(timetableApiStatus) && timetableApiStatus >= 200 && timetableApiStatus < 300;
  const timetableLookaheadDays = Number(student.lessons?.nextDays ?? student.grid?.nextDays ?? student.nextDays ?? 0);
  if (!activeHoliday && timetable.length === 0 && shouldFetchTimetable && timetableLookaheadDays > 0 && hasSuccessfulTimetableStatus) {
    const emptyWarn = checkEmptyDataWarning(timetable, 'lessons', student.title, true);
    addWarning(emptyWarn, { kind: 'no_data', dataType: 'lessons' });
  }
  if (!activeHoliday && timetable.length === 0 && shouldFetchTimetable && timetableLookaheadDays > 0 && !hasSuccessfulTimetableStatus) {
    mmLog(
      'debug',
      student,
      `Skipping empty lessons warning due to non-success timetable status: ${Number.isFinite(timetableApiStatus) ? timetableApiStatus : 'unknown'}`
    );
  }
  if (activeHoliday) {
    mmLog('debug', student, `Skipping empty lessons warning: "${activeHoliday.longName || activeHoliday.name}" (today=${todayYmd})`);
  }

  payload.state.warnings = Array.from(new Set(warnings));
  payload.state.warningMeta = payload.state.warnings.map((message) => ({
    message,
    ...(warningMetaByMessage.get(message) || { kind: 'generic' }),
  }));

  // Optional debug dump (non-blocking: errors logged but don't break flow)
  tryOrNull(
    () => {
      if (!moduleConfig?.dumpBackendPayloads) return;

      const dumpDir = path.join(__dirname, '..', '..', 'debug_dumps');
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      cleanupOldDebugDumps(dumpDir, 25);

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
        if (safePayload && safePayload.context?.config && typeof safePayload.context.config === 'object') {
          ['password', 'token', '_authService', 'cookie', 'jsessionid', 'auth', 'authToken', 'accessToken', 'refreshToken'].forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(safePayload.context.config, k)) safePayload.context.config[k] = '<REDACTED>';
          });
        }
        // eslint-disable-next-line no-unused-vars
      } catch (e) {
        // ignore
      }

      // Reorder dump: `meta` first, then `context.config` with direct config values,
      // followed by config subobjects, then the remaining top-level keys.
      const orderedPayload = {};
      if (safePayload.meta) orderedPayload.meta = safePayload.meta;

      if (safePayload.context && safePayload.context.config) {
        const cfg = safePayload.context.config;
        const prim = {};
        const objs = {};
        Object.keys(cfg).forEach((k) => {
          const v = cfg[k];
          if (v && typeof v === 'object' && !Array.isArray(v)) objs[k] = v;
          else prim[k] = v;
        });
        orderedPayload.context = {
          ...safePayload.context,
          config: Object.assign({}, prim, objs),
        };
      }

      // Add remaining top-level keys in original order, skipping ones already added.
      Object.keys(safePayload).forEach((k) => {
        if (k === 'meta' || k === 'context') return;
        if (Object.prototype.hasOwnProperty.call(orderedPayload, k)) return;
        orderedPayload[k] = safePayload[k];
      });

      fs.writeFileSync(target, JSON.stringify(orderedPayload, null, 2), 'utf8');
      mmLog('debug', student, `Wrote debug payload to ${path.join('debug_dumps', fname)} (sensitive fields redacted, ordered)`, 'debug');
    },
    (err) => mmLog('error', student, `Failed to write debug payload: ${err}`, 'debug')
  );

  // mmLog(
  //   'debug',
  //   student,
  //   `✓ Final payload v2: ${compactTimetable.length} lessons, ${compactExams.length} exams, ${compactHomeworks.length} homework, ${compactAbsences.length} absences, ${compactMessagesOfDay.length} messages (after compacting)\n`
  // );

  return payload;
}

module.exports = {
  buildGotDataPayload,
};
