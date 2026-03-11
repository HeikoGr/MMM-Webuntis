/**
 * WebUntis API Service
 * Unified service for all WebUntis REST API calls
 * Consolidates timetable, exams, homework, absences, and messages of day fetching
 */

const fs = require('fs');
const path = require('path');
const restClient = require('./restClient');
const { formatDateFromDate } = require('./dateUtils');
const { tryOrThrow } = require('./errorUtils');

// API timeout constant (15 seconds)
const API_TIMEOUT_MS = 15000;

/**
 * API endpoint configurations
 */
const ENDPOINTS = {
  timetable: '/WebUntis/api/rest/view/v1/timetable/entries',
  exams: '/WebUntis/api/exams',
  homework: '/WebUntis/api/homeworks/lessons',
  absences: '/WebUntis/api/classreg/absences/students',
  messagesofday: '/WebUntis/api/public/news/newsWidgetData',
};

const adaptLogger = (logger) => (logger ? (level, msg) => logger(level, null, msg) : undefined);

const pickFirstArray = (...candidates) => candidates.find((candidate) => Array.isArray(candidate)) || [];

function buildDisplayIcons(entry) {
  const icons = new Set();

  if (Array.isArray(entry?.icons)) {
    entry.icons.forEach((icon) => {
      if (typeof icon !== 'string' || icon.trim().length === 0) return;
      icons.add(icon.trim().toUpperCase());
    });
  }

  const entryType = String(entry?.type || '')
    .trim()
    .toUpperCase();
  if (entryType && entryType !== 'NORMAL_TEACHING_PERIOD') {
    icons.add(entryType);
  }

  const statusDetail = String(entry?.statusDetail || '')
    .trim()
    .toUpperCase();
  if (statusDetail === 'MOVED') {
    icons.add('MOVED');
  }

  return Array.from(icons);
}

function buildApiResult(data, status, transform) {
  return {
    data: transform ? transform(data) : data,
    status,
  };
}

function logWithStudentContext(logger, level, message) {
  if (logger) {
    logger(level, null, message);
  }
}

function logInvalidTimetableResponse(logger, resp) {
  logWithStudentContext(logger, 'warn', `[timetable] API returned empty or invalid response structure:`);
  logWithStudentContext(logger, 'warn', `  - resp exists: ${!!resp}`);
  logWithStudentContext(logger, 'warn', `  - resp.days exists: ${!!resp?.days}`);
  logWithStudentContext(logger, 'warn', `  - resp.days isArray: ${Array.isArray(resp?.days)}`);
  logWithStudentContext(logger, 'warn', `  - resp.days length: ${resp?.days?.length ?? 'N/A'}`);
  if (resp && typeof resp === 'object') {
    logWithStudentContext(logger, 'warn', `  - response keys: ${JSON.stringify(Object.keys(resp))}`);
  }
}

/**
 * Generic WebUntis API call with automatic retry on auth errors
 *
 * @param {Object} config - Configuration object
 * @param {string} config.dataType - Type of data to fetch ('timetable'|'exams'|'homework'|'absences'|'messagesofday')
 * @param {Object} config.authContext - Authentication context with callbacks
 * @param {Function} config.authContext.getAuth - Function to get authentication (token, cookies, tenantId, schoolYearId)
 * @param {Function} [config.authContext.onAuthError] - Optional callback to invalidate cache on auth error
 * @param {string} config.server - WebUntis server hostname
 * @param {Object} config.params - Query parameters
 * @param {Function} config.logger - Logger function
 * @param {Function} config.transform - Transform function for response data
 * @returns {Promise<any>} Transformed response data
 */
async function callWebUntisAPI({ dataType, authContext, server, params, logger, transform, debugApi = false, dumpRaw = false }) {
  if (!authContext || typeof authContext.getAuth !== 'function') {
    throw new Error(`[${dataType}] Missing authContext.getAuth`);
  }

  const endpoint = tryOrThrow(
    () =>
      ENDPOINTS[dataType] ||
      (() => {
        throw new Error(`Unknown dataType: ${dataType}`);
      })(),
    (msg) => (logger ? logger('error', null, msg) : null)
  );

  const logPrefix = `[${dataType}]`;
  const restLogger = adaptLogger(logger);

  const parseHttpStatus = (error) => {
    const numericStatus = Number(error?.httpStatus || error?.status || error?.response?.status);
    if (Number.isFinite(numericStatus)) return numericStatus;
    return null;
  };

  const isAuthError = (error) => {
    if (!error) return false;
    if (error.isAuthError === true) return true;

    const code = String(error.code || '').toUpperCase();
    if (['AUTH_FAILED', 'SESSION_EXPIRED', 'TOKEN_REQUEST_FAILED', 'TOKEN_INVALID'].includes(code)) {
      return true;
    }

    const status = parseHttpStatus(error);
    if (status === 401) return true;
    return false;
  };

  const makeRequest = async () => {
    const auth = await authContext.getAuth();
    const { token, cookieString, tenantId, schoolYearId } = auth;

    const response = await restClient.callRestAPI({
      server,
      path: endpoint,
      method: 'GET',
      params,
      token,
      cookies: cookieString,
      tenantId,
      schoolYearId,
      timeout: API_TIMEOUT_MS,
      logger: restLogger,
      debugApi,
    });

    return { data: response.data, status: response.status };
  };

  try {
    const response = await makeRequest();
    const { data, status } = response;

    if (dumpRaw) {
      try {
        const dumpDir = path.join(__dirname, '..', '..', 'debug_dumps');
        fs.mkdirSync(dumpDir, { recursive: true });
        const serverSafe = String(server || 'server').replace(/[^a-z0-9.-]/gi, '_');
        const filename = `${Date.now()}_${serverSafe}_${dataType}.json`;
        const filePath = path.join(dumpDir, `raw_api_${filename}`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
        logWithStudentContext(logger, 'debug', `${logPrefix} Raw API response dumped to ${filePath}`);
      } catch (dumpErr) {
        logWithStudentContext(
          logger,
          'warn',
          `${logPrefix} Failed to write raw API dump: ${dumpErr && dumpErr.message ? dumpErr.message : dumpErr}`
        );
      }
    }

    const result = buildApiResult(data, status, transform);
    return result;
  } catch (error) {
    if (isAuthError(error) && typeof authContext.onAuthError === 'function') {
      logWithStudentContext(logger, 'warn', `${logPrefix} Authentication token expired, invalidating cache and retrying...`);

      try {
        await authContext.onAuthError();
        const response = await makeRequest();
        const { data, status } = response;
        const result = buildApiResult(data, status, transform);
        logWithStudentContext(
          logger,
          'info',
          `${logPrefix} Token refresh successful: ${Array.isArray(result.data) ? result.data.length : '?'} items`
        );
        return result;
      } catch (retryError) {
        logWithStudentContext(logger, 'error', `${logPrefix} Retry failed after token refresh: ${retryError.message}`);
        throw retryError;
      }
    }

    const httpStatus = parseHttpStatus(error) ?? 'unknown';
    const logLevel = httpStatus === 403 ? 'warn' : 'error';
    logWithStudentContext(logger, logLevel, `${logPrefix} API call failed (HTTP ${httpStatus}): ${error.message}`);
    throw error;
  }
}

async function callPersonRangeEndpoint({
  dataType,
  authContext,
  server,
  rangeStart,
  rangeEnd,
  logger,
  transform,
  debugApi = false,
  dumpRaw = false,
  extraParams = {},
}) {
  const params = {
    startDate: formatDateFromDate(rangeStart, 'YYYYMMDD'),
    endDate: formatDateFromDate(rangeEnd, 'YYYYMMDD'),
    ...extraParams,
  };

  return callWebUntisAPI({
    dataType,
    authContext,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

async function callStudentRangeDataType({
  dataType,
  authContext,
  server,
  rangeStart,
  rangeEnd,
  personId,
  logger,
  transform,
  debugApi = false,
  dumpRaw = false,
  extraParamsFactory,
}) {
  const extraParams = typeof extraParamsFactory === 'function' ? extraParamsFactory(personId) : {};

  return callPersonRangeEndpoint({
    dataType,
    authContext,
    server,
    rangeStart,
    rangeEnd,
    logger,
    transform,
    debugApi,
    dumpRaw,
    extraParams,
  });
}

const TYPE_TO_FIELD_MAPPING = {
  TEACHER: 'te',
  SUBJECT: 'su',
  ROOM: 'ro',
  CLASS: 'cl',
  STUDENT_GROUP: 'sg',
  INFO: 'info',
};

function mapPositionsToFields(entry, logger) {
  const result = { te: [], su: [], ro: [], cl: [], sg: [], info: [], teOld: [], suOld: [], roOld: [], changedFields: [] };

  ['position1', 'position2', 'position3', 'position4', 'position5', 'position6', 'position7'].forEach((posKey) => {
    const positions = entry[posKey];
    if (Array.isArray(positions)) {
      positions.forEach((pos) => {
        const current = pos?.current;
        if (current && current.type) {
          const fieldKey = TYPE_TO_FIELD_MAPPING[current.type];
          if (fieldKey && result[fieldKey]) {
            result[fieldKey].push({
              name: current.shortName,
              longname: current.longName,
            });

            if (pos.removed && pos.removed.shortName) {
              const oldFieldKey = `${fieldKey}Old`;
              if (oldFieldKey in result) {
                result[oldFieldKey].push({
                  name: pos.removed.shortName,
                  longname: pos.removed.longName,
                });
                if (!result.changedFields.includes(fieldKey)) {
                  result.changedFields.push(fieldKey);
                }
              }
            }
          } else if (logger) {
            logger('debug', null, `[timetable] Unknown position type: ${current.type} in ${posKey}`);
          }
        }
      });
    }
  });

  return result;
}

/**
 * Fetch timetable (lessons) for a student or class
 */
async function getTimetable({
  authContext,
  server,
  rangeStart,
  rangeEnd,
  personId,
  useClassTimetable = false,
  classId = null,
  resourceType = null,
  logger,

  debugApi = false,
  dumpRaw = false,
}) {
  const effectiveResourceType = useClassTimetable ? 'CLASS' : resourceType || 'STUDENT';
  const resourceId = useClassTimetable ? classId : personId;

  if (!resourceId) {
    throw new Error(`Missing ${effectiveResourceType} id for timetable request`);
  }

  const params = {
    start: restClient.formatDateForAPI(rangeStart),
    end: restClient.formatDateForAPI(rangeEnd),
    resourceType: effectiveResourceType,
    resources: String(resourceId),
    timetableType: 'MY_TIMETABLE',
  };

  const transform = (resp) => {
    const lessons = [];

    if (!resp || !resp.days || !Array.isArray(resp.days) || resp.days.length === 0) {
      logInvalidTimetableResponse(logger, resp);
    }

    if (!Array.isArray(resp?.days)) {
      return lessons;
    }

    for (const day of resp.days) {
      const entries = day?.gridEntries;
      if (!Array.isArray(entries) || entries.length === 0) {
        continue;
      }

      for (const entry of entries) {
        const mappedFields = mapPositionsToFields(entry, logger);

        lessons.push({
          id: entry.ids?.[0] ?? entry.id ?? entry.lessonId ?? entry.lid ?? null,
          date: day.date ? day.date.split('T')[0] : '',
          startTime: entry.duration?.start ? entry.duration.start.split('T')[1] : '',
          endTime: entry.duration?.end ? entry.duration.end.split('T')[1] : '',
          displayIcons: buildDisplayIcons(entry),
          te: mappedFields.te,
          su: mappedFields.su,
          ro: mappedFields.ro,
          cl: mappedFields.cl,
          sg: mappedFields.sg,
          info: mappedFields.info,
          teOld: mappedFields.teOld,
          suOld: mappedFields.suOld,
          roOld: mappedFields.roOld,
          changedFields: mappedFields.changedFields,
          substText: entry.substitutionText || '',
          lstext: entry.lessonInfo || '',
          status: entry.status || 'REGULAR',
        });
      }
    }

    return lessons;
  };

  return callWebUntisAPI({
    dataType: 'timetable',
    authContext,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

/**
 * Fetch exams for a student
 */
async function getExams({
  authContext,
  server,
  rangeStart,
  rangeEnd,
  personId,
  logger,
  normalizeDate,
  normalizeTime,
  sanitizeHtml,
  debugApi = false,
  dumpRaw = false,
}) {
  const transform = (data) => {
    const exams = [];
    const examArr = pickFirstArray(data?.data?.exams, data?.exams, data);

    examArr.forEach((exam) => {
      const isAssignedToStudent =
        personId && Array.isArray(exam.assignedStudents) && exam.assignedStudents.some((s) => Number(s.id) === Number(personId));

      if (!personId || isAssignedToStudent) {
        exams.push({
          examDate: normalizeDate ? normalizeDate(exam.examDate ?? exam.date) : (exam.examDate ?? exam.date),
          startTime: normalizeTime ? normalizeTime(exam.startTime ?? exam.start) : (exam.startTime ?? exam.start),
          endTime: normalizeTime ? normalizeTime(exam.endTime ?? exam.end) : (exam.endTime ?? exam.end),
          name: sanitizeHtml ? sanitizeHtml(exam.name ?? exam.examType ?? exam.lessonName ?? '', false) : (exam.name ?? ''),
          subject: sanitizeHtml ? sanitizeHtml(exam.subject ?? exam.lessonName ?? '', false) : (exam.subject ?? ''),
          teachers: Array.isArray(exam.teachers) ? exam.teachers : [],
          text: sanitizeHtml ? sanitizeHtml(exam.text ?? exam.description ?? '', true) : (exam.text ?? ''),
        });
      }
    });

    return exams;
  };

  return callStudentRangeDataType({
    dataType: 'exams',
    authContext,
    server,
    rangeStart,
    rangeEnd,
    personId,
    logger,
    transform,
    debugApi,
    dumpRaw,
    extraParamsFactory: (resolvedPersonId) => ({
      studentId: resolvedPersonId ?? -1,
      klasseId: -1,
      withGrades: true,
    }),
  });
}

/**
 * Fetch homework for a student
 */
async function getHomework({ authContext, server, rangeStart, rangeEnd, personId, logger, debugApi = false, dumpRaw = false }) {
  const transform = (data) => {
    const homeworks = [];
    const seenIds = new Set();

    const hwArray = pickFirstArray(data?.homeworks, data?.data?.homeworks);
    const lessonsArray = pickFirstArray(data?.lessons, data?.data?.lessons);
    const recordsArray = pickFirstArray(data?.records, data?.data?.records);

    if (!Array.isArray(hwArray)) return homeworks;

    const lessonsMap = {};
    if (Array.isArray(lessonsArray)) {
      lessonsArray.forEach((lesson) => {
        if (lesson.id) lessonsMap[lesson.id] = lesson;
      });
    }

    const recordsMap = {};
    if (Array.isArray(recordsArray)) {
      recordsArray.forEach((rec) => {
        if (rec?.homeworkId !== undefined && rec.homeworkId !== null) {
          recordsMap[rec.homeworkId] = Array.isArray(rec.elementIds) ? rec.elementIds.slice() : [];
        }
      });
    }

    hwArray.forEach((hw) => {
      const hwId = hw.id ?? `${hw.lessonId}_${hw.dueDate}`;
      if (seenIds.has(hwId)) return;
      seenIds.add(hwId);

      const lesson = lessonsMap[hw.lessonId];
      const elementIds = recordsMap[hw.id] || [];

      if (Number.isFinite(Number(personId)) && Number(personId) !== -1) {
        const matchesByElement = Array.isArray(elementIds) && elementIds.some((e) => Number(e) === Number(personId));
        const matchesByField = hw.studentId && Number(hw.studentId) === Number(personId);
        if (!matchesByElement && !matchesByField) return;
      }

      let subjectData = [];
      if (lesson?.subject) {
        subjectData = [{ name: lesson.subject, longname: lesson.subject }];
      } else if (lesson?.su) {
        subjectData = lesson.su;
      } else if (hw.su) {
        subjectData = hw.su;
      }

      homeworks.push({
        id: hw.id ?? null,
        lessonId: hw.lessonId ?? hw.lid ?? null,
        dueDate: hw.dueDate ?? hw.date ?? null,
        completed: hw.completed ?? hw.isDone ?? false,
        text: hw.text ?? hw.homework ?? hw.remark ?? '',
        remark: hw.remark ?? '',
        su: subjectData,
        elementIds,
        studentId: hw.studentId ?? (elementIds.length ? elementIds[0] : (personId ?? null)),
      });
    });

    return homeworks;
  };

  return callStudentRangeDataType({
    dataType: 'homework',
    authContext,
    server,
    rangeStart,
    rangeEnd,
    personId,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

/**
 * Fetch absences for a student
 */
async function getAbsences({ authContext, server, rangeStart, rangeEnd, personId, logger, debugApi = false, dumpRaw = false }) {
  const transform = (data) => {
    const absences = [];
    const absArr = pickFirstArray(data?.data?.absences, data?.absences, data?.absentLessons, data);

    absArr.forEach((abs) => {
      const startTimeHHMM = Number.isFinite(abs.startTime) ? abs.startTime : null;
      const endTimeHHMM = Number.isFinite(abs.endTime) ? abs.endTime : null;

      absences.push({
        date: abs.date ?? abs.startDate ?? abs.absenceDate ?? abs.day ?? null,
        startTime: startTimeHHMM ?? abs.start ?? null,
        endTime: endTimeHHMM ?? abs.end ?? null,
        reason: abs.reason ?? abs.reasonText ?? abs.text ?? '',
        excused: abs.isExcused ?? abs.excused ?? null,
        student: abs.student ?? null,
        su: abs.su?.[0]?.name ? [{ name: abs.su[0].name, longname: abs.su[0].longname ?? abs.su[0].name }] : [],
        te: abs.te?.[0]?.name ? [{ name: abs.te[0].name, longname: abs.te[0].longname ?? abs.te[0].name }] : [],
        lessonId: abs.lessonId ?? abs.lid ?? abs.id ?? null,
      });
    });

    return absences;
  };

  return callStudentRangeDataType({
    dataType: 'absences',
    authContext,
    server,
    rangeStart,
    rangeEnd,
    personId,
    logger,
    transform,
    debugApi,
    dumpRaw,
    extraParamsFactory: (resolvedPersonId) => ({
      studentId: resolvedPersonId ?? -1,
      excuseStatusId: -1,
    }),
  });
}

/**
 * Fetch messages of the day
 */
async function getMessagesOfDay({ authContext, server, date, logger, debugApi = false, dumpRaw = false }) {
  const params = {
    date: formatDateFromDate(date, 'YYYYMMDD'),
  };

  const transform = (data) => {
    return pickFirstArray(data?.data?.messagesOfDay, data?.messagesOfDay, data?.messages, data);
  };

  return callWebUntisAPI({
    dataType: 'messagesofday',
    authContext,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

/**
 * Fetch class candidates using classservices (for parent accounts)
 *
 * @param {Object} options Options
 * @param {Function} options.getAuth Authentication callback
 * @param {string} options.server Server hostname
 * @param {string} options.startDate Start date (YYYYMMDD integer)
 * @param {string} options.endDate End date (YYYYMMDD integer)
 * @param {number|string} options.studentId Target student ID
 * @param {Function} [options.logger] Optional logger
 * @returns {Promise<Object>} API response data
 */
async function getClassServices({ getAuth, server, startDate, endDate, studentId, logger }) {
  return callClassCandidateEndpoint({
    getAuth,
    server,
    path: '/WebUntis/api/classreg/classservices',
    params: {
      startDate,
      endDate,
      elementId: studentId,
    },
    logger,
  });
}

async function callClassCandidateEndpoint({ getAuth, server, path, params, logger }) {
  const auth = await getAuth();
  const { token, cookieString, tenantId, schoolYearId } = auth;

  const response = await restClient.callRestAPI({
    server,
    path,
    method: 'GET',
    params,
    token,
    cookies: cookieString,
    tenantId,
    schoolYearId,
    timeout: API_TIMEOUT_MS,
    logger: adaptLogger(logger),
  });

  return response.data;
}

/**
 * Fetch class candidates using timetable/filter (for student/teacher accounts)
 *
 * @param {Object} options Options
 * @param {Function} options.getAuth Authentication callback
 * @param {string} options.server Server hostname
 * @param {string} options.start Start date (YYYY-MM-DD string)
 * @param {string} options.end End date (YYYY-MM-DD string)
 * @param {Function} [options.logger] Optional logger
 * @returns {Promise<Object>} API response data
 */
async function getTimetableFilterClasses({ getAuth, server, start, end, logger }) {
  return callClassCandidateEndpoint({
    getAuth,
    server,
    path: '/WebUntis/api/rest/view/v1/timetable/filter',
    params: {
      resourceType: 'CLASS',
      timetableType: 'STANDARD',
      start,
      end,
    },
    logger,
  });
}

module.exports = {
  getTimetable,
  getExams,
  getHomework,
  getAbsences,
  getMessagesOfDay,
  getClassServices,
  getTimetableFilterClasses,
};
