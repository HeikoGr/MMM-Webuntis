const fs = require('node:fs');
const path = require('node:path');
const { tryOrNull } = require('../webuntis/errorUtils');

// Generic normalization helpers for MMM payload shaping.
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

function sanitizeHtml(text, allowMarkdown = false) {
  if (!text) return '';
  let result = String(text);

  const allowedTags = ['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'sub', 'sup', 'small'];

  result = result
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

  result = result
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');

  result = result.replace(/<([a-z][a-z0-9]*)\b[^>]*>/gi, (_match, tagName) => {
    const tag = tagName.toLowerCase();
    if (allowedTags.includes(tag)) {
      return `<${tag}>`;
    }
    return '';
  });

  result = result.replace(/<\/([a-z][a-z0-9]*)>/gi, (_match, tagName) => {
    const tag = tagName.toLowerCase();
    if (allowedTags.includes(tag)) {
      return `</${tag}>`;
    }
    return '';
  });

  if (!allowMarkdown) result = result.replace(/[_*]/g, '');

  result = result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ');

  return result.trim();
}

function formatSubject(su) {
  if (!su) return null;
  if (typeof su === 'object' && !Array.isArray(su)) {
    return { name: su.name || '', longname: su.longname || '' };
  }
  if (Array.isArray(su) && su[0]) {
    return { name: su[0].name || '', longname: su[0].longname || '' };
  }
  return null;
}

function compactItem(raw, schema) {
  if (!raw || typeof raw !== 'object') return {};

  const result = {};
  for (const [outputKey, fieldDef] of Object.entries(schema)) {
    const inputKey = fieldDef.from || outputKey;
    const fallbacks = fieldDef.fallbacks || [];
    const transform = fieldDef.transform || ((v) => v);
    const defaultValue = fieldDef.default ?? null;

    let value = raw[inputKey];
    if (value === null || value === undefined) {
      for (const fb of fallbacks) {
        if (raw[fb] !== null && raw[fb] !== undefined) {
          value = raw[fb];
          break;
        }
      }
    }

    result[outputKey] = value !== null && value !== undefined ? transform(value) : defaultValue;
  }

  return result;
}

function compactArray(rawArray, schema) {
  if (!Array.isArray(rawArray)) return [];
  return rawArray.map((item) => compactItem(item, schema));
}

// Canonical compaction schemas for the MMM transport contract.
const schemas = {
  lesson: {
    date: { from: 'date', transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0 },
    startTime: {
      from: 'startTime',
      transform: (v) => parseHHMMStringToInteger(v) || v,
      default: null,
    },
    endTime: {
      from: 'endTime',
      transform: (v) => parseHHMMStringToInteger(v) || v,
      default: null,
    },
    su: {
      from: 'su',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    te: {
      from: 'te',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    ro: {
      from: 'ro',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    cl: {
      from: 'cl',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    sg: {
      from: 'sg',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    info: {
      from: 'info',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    substText: { from: 'substText', default: '' },
    lstext: { from: 'lstext', default: '' },
    status: { from: 'status', default: 'REGULAR' },
    displayIcons: {
      from: 'displayIcons',
      transform: (v) => (Array.isArray(v) ? v.filter((icon) => typeof icon === 'string' && icon.trim().length > 0) : []),
      default: [],
    },
    id: { from: 'id', default: null },
    teOld: {
      from: 'teOld',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    suOld: {
      from: 'suOld',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    roOld: {
      from: 'roOld',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    changedFields: {
      from: 'changedFields',
      transform: (v) => (Array.isArray(v) ? v : []),
      default: [],
    },
  },
  exam: {
    examDate: {
      from: 'examDate',
      transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0,
    },
    startTime: { from: 'startTime', default: null },
    endTime: { from: 'endTime', default: null },
    name: { from: 'name', transform: (v) => sanitizeHtml(v, false), default: '' },
    subject: { from: 'subject', transform: (v) => sanitizeHtml(v, false), default: '' },
    teachers: { from: 'teachers', transform: (v) => (Array.isArray(v) ? v.slice(0, 2) : []), default: [] },
    text: { from: 'text', transform: (v) => sanitizeHtml(v, true), default: '' },
  },
  homework: {
    id: { from: 'id', default: null },
    lid: { from: 'lid', default: null },
    lessonId: { from: 'lessonId', default: null },
    studentId: { from: 'studentId', default: null },
    elementIds: { from: 'elementIds', transform: (v) => (Array.isArray(v) ? v.slice() : []), default: [] },
    dueDate: { from: 'dueDate', fallbacks: ['date'], default: null },
    completed: { from: 'completed', default: null },
    text: {
      from: 'text',
      fallbacks: ['description', 'remark'],
      transform: (v) => sanitizeHtml(v, true),
      default: '',
    },
    remark: { from: 'remark', transform: (v) => sanitizeHtml(v, false), default: '' },
    su: {
      from: 'su',
      transform: (v) => formatSubject(v),
      default: null,
    },
  },
  absence: {
    date: {
      from: 'date',
      fallbacks: ['startDate', 'absenceDate', 'day'],
      transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0,
    },
    startTime: { from: 'startTime', fallbacks: ['start'], default: null },
    endTime: { from: 'endTime', fallbacks: ['end'], default: null },
    reason: {
      from: 'reason',
      fallbacks: ['reasonText', 'text'],
      transform: (v) => sanitizeHtml(v, false),
      default: '',
    },
    excused: { from: 'isExcused', fallbacks: ['excused'], default: null },
    student: { from: 'student', default: null },
    su: {
      from: 'su',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    te: {
      from: 'te',
      transform: (v) => (Array.isArray(v) && v[0] ? [{ name: v[0].name, longname: v[0].longname }] : []),
      default: [],
    },
    lessonId: { from: 'lessonId', fallbacks: ['lid', 'id'], default: null },
  },
  message: {
    id: { from: 'id', default: null },
    subject: {
      from: 'subject',
      fallbacks: ['title'],
      transform: (v) => sanitizeHtml(v, true),
      default: '',
    },
    text: {
      from: 'text',
      fallbacks: ['content'],
      transform: (v) => sanitizeHtml(v, true),
      default: '',
    },
    isExpanded: { from: 'isExpanded', default: false },
  },
};

function parseDisplayWidgets(displayMode) {
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
}

function toYmd(value) {
  if (!(value instanceof Date)) return null;
  if (Number.isNaN(value.getTime())) return null;
  return value.getFullYear() * 10000 + (value.getMonth() + 1) * 100 + value.getDate();
}

// Bundle raw backend results into compact payload blocks.
function compactPayloadData({ grid, timetable, rawExams, hwResult, rawAbsences, rawMessagesOfDay, fetchFlags, compactTimegrid }) {
  const shouldFetchHomeworks = Boolean(fetchFlags?.fetchHomeworks);
  const shouldFetchAbsences = Boolean(fetchFlags?.fetchAbsences);
  const shouldFetchMessagesOfDay = Boolean(fetchFlags?.fetchMessagesOfDay);

  return {
    compactGrid: compactTimegrid(grid),
    compactTimetable: compactArray(timetable, schemas.lesson),
    compactExams: compactArray(rawExams, schemas.exam),
    compactHomeworks: shouldFetchHomeworks ? compactArray(hwResult, schemas.homework) : [],
    compactAbsences: shouldFetchAbsences ? compactArray(rawAbsences, schemas.absence) : [],
    compactMessagesOfDay: shouldFetchMessagesOfDay ? compactArray(rawMessagesOfDay, schemas.message) : [],
    shouldFetchTimetable: Boolean(fetchFlags?.fetchTimetable),
    shouldFetchHomeworks,
    shouldFetchAbsences,
    shouldFetchMessagesOfDay,
  };
}

function buildBasePayload({
  student,
  moduleConfig,
  compacted,
  compactHolidays,
  activeHoliday,
  todayYmd,
  fetchFlags,
  apiStatus,
  dateRanges,
  moduleId,
  sessionId,
}) {
  const studentWithDebugDate = {
    ...student,
    debugDate: student.debugDate ?? moduleConfig?.debugDate ?? null,
  };

  const rangeStartYmd = toYmd(dateRanges?.timetable?.start);
  const rangeEndYmd = toYmd(dateRanges?.timetable?.end);

  return {
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
      timeUnits: compacted.compactGrid,
      lessons: compacted.compactTimetable,
      exams: compacted.compactExams,
      homework: compacted.compactHomeworks,
      absences: compacted.compactAbsences,
      messages: compacted.compactMessagesOfDay,
      holidays: {
        ranges: compactHolidays,
        current: activeHoliday,
      },
    },
    state: {
      fetch: {
        timegrid: Boolean(fetchFlags?.fetchTimegrid),
        timetable: compacted.shouldFetchTimetable,
        exams: Boolean(fetchFlags?.fetchExams),
        homework: compacted.shouldFetchHomeworks,
        absences: compacted.shouldFetchAbsences,
        messages: compacted.shouldFetchMessagesOfDay,
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
}

// Enrich payload metadata and warnings before optional dump output.
function attachDebugMeta(payload) {
  try {
    const os = require('node:os');
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
  } catch {
    // non-fatal
  }
}

function createWarningCollector(currentFetchWarnings) {
  const warnings = [];
  const payloadWarningSet = new Set();
  const warningMetaByMessage = new Map();

  if (currentFetchWarnings && typeof currentFetchWarnings.forEach === 'function') {
    currentFetchWarnings.forEach((message) => {
      if (!message || payloadWarningSet.has(message)) return;
      warnings.push(message);
      payloadWarningSet.add(message);
    });
  }

  const addWarning = (msg, meta = null) => {
    if (!msg || payloadWarningSet.has(msg)) return;

    warnings.push(msg);
    payloadWarningSet.add(msg);

    if (currentFetchWarnings && typeof currentFetchWarnings.add === 'function') {
      currentFetchWarnings.add(msg);
    }

    if (meta && typeof meta === 'object') {
      warningMetaByMessage.set(msg, meta);
    }
  };

  const flushToPayload = (payload) => {
    payload.state.warnings = Array.from(new Set(warnings));
    payload.state.warningMeta = payload.state.warnings.map((message) => ({
      message,
      ...(warningMetaByMessage.get(message) || { kind: 'generic' }),
    }));
  };

  return {
    addWarning,
    flushToPayload,
  };
}

function collectWarnings({
  payload,
  moduleConfig,
  student,
  timetable,
  activeHoliday,
  todayYmd,
  compacted,
  apiStatus,
  mmLog,
  warningCollector,
}) {
  if (moduleConfig && Array.isArray(moduleConfig.__warnings)) {
    moduleConfig.__warnings.forEach((warning) => {
      warningCollector.addWarning(warning, { kind: 'config' });
    });
  }

  if (payload.context?.config && Array.isArray(payload.context.config.__warnings)) {
    payload.context.config.__warnings.forEach((warning) => {
      warningCollector.addWarning(warning, { kind: 'config' });
    });
  }

  const timetableApiStatus = Number(apiStatus?.timetable);
  const hasSuccessfulTimetableStatus = Number.isFinite(timetableApiStatus) && timetableApiStatus >= 200 && timetableApiStatus < 300;
  const timetableLookaheadDays = Number(student.lessons?.nextDays ?? student.grid?.nextDays ?? student.nextDays ?? 0);

  if (timetable.length === 0 && compacted.shouldFetchTimetable && timetableLookaheadDays > 0) {
    if (activeHoliday) {
      mmLog(
        'debug',
        student,
        `Empty timetable without warning during holiday: "${activeHoliday.longName || activeHoliday.name}" (today=${todayYmd})`
      );
    } else if (!hasSuccessfulTimetableStatus) {
      mmLog(
        'debug',
        student,
        `Empty timetable without warning due to non-success timetable status: ${Number.isFinite(timetableApiStatus) ? timetableApiStatus : 'unknown'}`
      );
    } else {
      mmLog('debug', student, 'Empty timetable without warning: lesson-free date ranges are valid.');
    }
  }

  warningCollector.flushToPayload(payload);
}

function createSafePayloadForDump(payload) {
  try {
    return JSON.parse(JSON.stringify(payload));
  } catch {
    return Object.assign({}, payload);
  }
}

function redactSensitiveFields(safePayload) {
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
      } catch {
        // ignore individual redact errors
      }
    }
  };
  redact(safePayload);

  try {
    if (safePayload?.context?.config && typeof safePayload.context.config === 'object') {
      ['password', 'token', '_authService', 'cookie', 'jsessionid', 'auth', 'authToken', 'accessToken', 'refreshToken'].forEach((k) => {
        if (Object.hasOwn(safePayload.context.config, k)) safePayload.context.config[k] = '<REDACTED>';
      });
    }
  } catch {
    // ignore
  }
}

function createOrderedDumpPayload(safePayload) {
  const orderedPayload = {};
  if (safePayload.meta) orderedPayload.meta = safePayload.meta;

  if (safePayload.context?.config) {
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

  Object.keys(safePayload).forEach((k) => {
    if (k === 'meta' || k === 'context') return;
    if (Object.hasOwn(orderedPayload, k)) return;
    orderedPayload[k] = safePayload[k];
  });

  return orderedPayload;
}

// Debug dumps are written from the already compacted MMM payload contract.
function writeDebugDump({ payload, moduleConfig, student, cleanupOldDebugDumps, mmLog }) {
  tryOrNull(
    () => {
      if (!moduleConfig?.dumpBackendPayloads) return;

      const dumpDir = path.join(__dirname, '..', '..', 'debug_dumps');
      if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
      cleanupOldDebugDumps(dumpDir, 25);

      const safeTitle = (student?.title || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
      const fname = `${Date.now()}_${safeTitle}_api.json`;
      const target = path.join(dumpDir, fname);

      const safePayload = createSafePayloadForDump(payload);
      redactSensitiveFields(safePayload);
      const orderedPayload = createOrderedDumpPayload(safePayload);

      fs.writeFileSync(target, JSON.stringify(orderedPayload, null, 2), 'utf8');
      mmLog('debug', student, `Wrote debug payload to ${path.join('debug_dumps', fname)} (sensitive fields redacted, ordered)`, 'debug');
    },
    (err) => mmLog('error', student, `Failed to write debug payload: ${err}`, 'debug')
  );
}

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
    apiStatus = {},
    dateRanges,
    moduleId,
    sessionId,
  } = params;

  const compacted = compactPayloadData({
    grid,
    timetable,
    rawExams,
    hwResult,
    rawAbsences,
    rawMessagesOfDay,
    fetchFlags,
    compactTimegrid,
  });

  const payload = buildBasePayload({
    student,
    moduleConfig,
    compacted,
    compactHolidays,
    activeHoliday,
    todayYmd,
    fetchFlags,
    apiStatus,
    dateRanges,
    moduleId,
    sessionId,
  });

  attachDebugMeta(payload);

  const warningCollector = createWarningCollector(currentFetchWarnings);
  collectWarnings({
    payload,
    moduleConfig,
    student,
    timetable,
    activeHoliday,
    todayYmd,
    compacted,
    apiStatus,
    checkEmptyDataWarning,
    mmLog,
    warningCollector,
  });

  writeDebugDump({
    payload,
    moduleConfig,
    student,
    cleanupOldDebugDumps,
    mmLog,
  });

  return payload;
}

// Public adapter entry point used by the lib/webuntisClient facade.
function mapBundleToMmmPayload(bundle, deps = {}) {
  const { compactTimegrid, checkEmptyDataWarning, mmLog, cleanupOldDebugDumps } = deps;

  if (!bundle?.coreData) return null;

  const { identifier, sessionKey, student, config, compactHolidays, currentFetchWarnings, coreData } = bundle;
  const { dateRanges, todayYmd, activeHoliday, fetchFlags, apiStatus, data } = coreData;

  const sessionId = String(sessionKey || '').split(':')[1] || null;

  return buildGotDataPayload({
    student,
    grid: data.grid,
    timetable: data.timetable,
    rawExams: data.rawExams,
    hwResult: data.hwResult,
    rawAbsences: data.rawAbsences,
    rawMessagesOfDay: data.rawMessagesOfDay,
    compactHolidays,
    dateRanges,
    todayYmd,
    fetchFlags,
    activeHoliday,
    moduleId: identifier,
    sessionId,
    moduleConfig: config,
    currentFetchWarnings,
    compactTimegrid,
    checkEmptyDataWarning,
    mmLog,
    cleanupOldDebugDumps,
    apiStatus,
  });
}

module.exports = {
  mapBundleToMmmPayload,
};
