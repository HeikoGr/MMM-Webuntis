/**
 * WebUntis API Service
 * Unified service for all WebUntis REST API calls
 * Consolidates timetable, exams, homework, absences, and messages of day fetching
 */

const fs = require('fs');
const path = require('path');
const restClient = require('./restClient');
const { tryOrThrow } = require('./errorUtils');

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

/**
 * Date formatting utilities
 */
const formatDateYYYYMMDD = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

/**
 * Generic WebUntis API call with automatic retry on auth errors
 *
 * @param {Object} config - Configuration object
 * @param {string} config.dataType - Type of data to fetch ('timetable'|'exams'|'homework'|'absences'|'messagesofday')
 * @param {Function} config.getAuth - Function to get authentication (token, cookies, tenantId, schoolYearId)
 * @param {Function} config.onAuthError - Optional callback to invalidate cache on auth error
 * @param {string} config.server - WebUntis server hostname
 * @param {Object} config.params - Query parameters
 * @param {Function} config.logger - Logger function
 * @param {Function} config.transform - Transform function for response data
 * @returns {Promise<any>} Transformed response data
 */
async function callWebUntisAPI({ dataType, getAuth, onAuthError, server, params, logger, transform, debugApi = false, dumpRaw = false }) {
  const endpoint = tryOrThrow(
    () =>
      ENDPOINTS[dataType] ||
      (() => {
        throw new Error(`Unknown dataType: ${dataType}`);
      })(),
    (msg) => (logger ? logger('error', null, msg) : null)
  );

  const logPrefix = `[${dataType}]`;
  // Fetching silently (removed debug log for cleaner output)

  // Helper to detect authentication errors
  // Note: 403 Forbidden is NOT an auth error - it means the endpoint is not available/permitted
  // Only 401 Unauthorized indicates invalid/expired credentials that warrant a retry
  const isAuthError = (error) => {
    const msg = error?.message || '';
    return msg.includes('401') || msg.includes('Authentication failed');
  };

  // Build and log full API URL with query parameters
  const buildUrlForLogging = () => {
    const baseUrl = `https://${server}${endpoint}`;
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }
    const queryString = Object.entries(params)
      .map(([key, val]) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`)
      .join('&');
    return `${baseUrl}?${queryString}`;
  };

  // Main request logic
  const makeRequest = async () => {
    const auth = await getAuth();
    const { token, cookieString, tenantId, schoolYearId } = auth;

    // Log full REST API URL
    if (logger) {
      const fullUrl = buildUrlForLogging();
      logger('debug', null, `${logPrefix} REST API: ${fullUrl}`);
    }

    const response = await restClient.callRestAPI({
      server,
      path: endpoint,
      method: 'GET',
      params,
      token,
      cookies: cookieString,
      tenantId,
      schoolYearId,
      timeout: 15000,
      logger: logger ? (level, msg) => logger(level, null, msg) : undefined,
      debugApi,
    });

    // Return both data and status for tracking
    return { data: response.data, status: response.status };
  };

  try {
    const response = await makeRequest();
    const { data, status } = response;

    // Optionally write raw API responses for forensic/debugging purposes
    if (dumpRaw) {
      try {
        const dumpDir = path.join(__dirname, '..', 'debug_dumps');
        fs.mkdirSync(dumpDir, { recursive: true });
        const serverSafe = String(server || 'server').replace(/[^a-z0-9.-]/gi, '_');
        const filename = `${Date.now()}_${serverSafe}_${dataType}.json`;
        const filePath = path.join(dumpDir, `raw_api_${filename}`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
        if (logger) logger('debug', null, `${logPrefix} Raw API response dumped to ${filePath}`);
      } catch (dumpErr) {
        if (logger)
          logger('warn', null, `${logPrefix} Failed to write raw API dump: ${dumpErr && dumpErr.message ? dumpErr.message : dumpErr}`);
      }
    }

    const result = transform ? transform(data) : data;
    if (logger) logger('debug', null, `${logPrefix} Returned ${Array.isArray(result) ? result.length : '?'} items`);
    return { data: result, status };
  } catch (error) {
    // Retry once on authentication errors
    if (isAuthError(error) && onAuthError) {
      if (logger) logger('warn', null, `${logPrefix} Authentication token expired, invalidating cache and retrying...`);

      try {
        // Invalidate cache and retry
        await onAuthError();
        const response = await makeRequest();
        const { data, status } = response;
        const result = transform ? transform(data) : data;
        if (logger) logger('info', null, `${logPrefix} Token refresh successful: ${Array.isArray(result) ? result.length : '?'} items`);
        return { data: result, status };
      } catch (retryError) {
        if (logger) logger('error', null, `${logPrefix} Retry failed after token refresh: ${retryError.message}`);
        throw retryError;
      }
    }

    // No retry or retry exhausted - extract HTTP status if available
    const statusMatch = error.message?.match(/(\d{3})/);
    const httpStatus = statusMatch ? statusMatch[1] : 'unknown';
    if (logger) logger('error', null, `${logPrefix} API call failed (HTTP ${httpStatus}): ${error.message}`);
    throw error;
  }
}

/**
 * Fetch timetable (lessons) for a student or class
 */
async function getTimetable({
  getAuth,
  onAuthError,
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
  // Auto-detect resourceType based on useClassTimetable flag first, then fall back to provided resourceType
  // IMPORTANT: useClassTimetable has priority over resourceType from role detection
  const effectiveResourceType = useClassTimetable ? 'CLASS' : resourceType || 'STUDENT';
  const resourceId = useClassTimetable ? classId : personId;

  if (logger) {
    logger(
      'debug',
      null,
      `[timetable] Config: useClassTimetable=${useClassTimetable}, providedResourceType=${resourceType || 'null'}, effectiveResourceType=${effectiveResourceType}, resourceId=${resourceId}`
    );
  }

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

  // Dynamic position mapping based on position.current.type
  const TYPE_TO_FIELD_MAPPING = {
    TEACHER: 'te', // Lehrer
    SUBJECT: 'su', // Fach/Subject
    ROOM: 'ro', // Raum
    CLASS: 'cl', // Klasse
    STUDENT_GROUP: 'sg', // Schülergruppe
    INFO: 'info', // Zusätzliche Information
  };

  function mapPositionsToFields(entry) {
    // Initialize all possible fields as empty arrays
    // *Old fields (teOld, suOld, roOld) capture the previous value when a field was changed
    const result = { te: [], su: [], ro: [], cl: [], sg: [], info: [], teOld: [], suOld: [], roOld: [], changedFields: [] };

    // Map each position1-7 to appropriate field based on type
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
              // Debug log for INFO type
              if (current.type === 'INFO' && logger) {
                logger('debug', null, `[timetable] Mapped INFO to field 'info': ${current.shortName}`);
              }

              // Capture "removed" value when a field was changed (ADDED/REMOVED pair)
              // Only TEACHER, ROOM and SUBJECT changes are surfaced in the UI
              if (pos.removed && pos.removed.shortName) {
                const oldFieldKey = `${fieldKey}Old`;
                if (Object.prototype.hasOwnProperty.call(result, oldFieldKey)) {
                  result[oldFieldKey].push({
                    name: pos.removed.shortName,
                    longname: pos.removed.longName,
                  });
                  // Track which field types were changed for quick lookup in frontend
                  if (!result.changedFields.includes(fieldKey)) {
                    result.changedFields.push(fieldKey);
                  }
                }
              }
            } else if (logger) {
              // Log unknown position types for future expansion
              logger('debug', null, `[timetable] Unknown position type: ${current.type} in ${posKey}`);
            }
          }
        });
      }
    });

    return result;
  }

  const transform = (resp) => {
    const lessons = [];

    // Debug: Log response structure when no data is returned
    if (!resp || !resp.days || !Array.isArray(resp.days) || resp.days.length === 0) {
      if (logger) {
        logger('warn', null, `[timetable] API returned empty or invalid response structure:`);
        logger('warn', null, `  - resp exists: ${!!resp}`);
        logger('warn', null, `  - resp.days exists: ${!!resp?.days}`);
        logger('warn', null, `  - resp.days isArray: ${Array.isArray(resp?.days)}`);
        logger('warn', null, `  - resp.days length: ${resp?.days?.length ?? 'N/A'}`);
        if (resp && typeof resp === 'object') {
          logger('warn', null, `  - response keys: ${JSON.stringify(Object.keys(resp))}`);
        }
      }
    }

    if (resp?.days && Array.isArray(resp.days)) {
      resp.days.forEach((day) => {
        // Process days even if they have no grid entries (needed for weekView to show empty days)
        if (day.gridEntries && Array.isArray(day.gridEntries) && day.gridEntries.length > 0) {
          day.gridEntries.forEach((entry) => {
            // Use dynamic position mapping
            const mappedFields = mapPositionsToFields(entry);

            const lesson = {
              id: entry.ids?.[0] ?? null,
              date: day.date ? day.date.split('T')[0] : '',
              startTime: entry.duration?.start ? entry.duration.start.split('T')[1] : '',
              endTime: entry.duration?.end ? entry.duration.end.split('T')[1] : '',
              // Dynamic fields based on position types
              te: mappedFields.te, // Teachers (current)
              su: mappedFields.su, // Subjects (current)
              ro: mappedFields.ro, // Rooms (current)
              cl: mappedFields.cl, // Classes
              sg: mappedFields.sg, // Student Groups
              info: mappedFields.info, // Additional Info
              // Previous values for CHANGED lessons (empty arrays when unchanged)
              teOld: mappedFields.teOld, // Previous teacher(s) before change
              suOld: mappedFields.suOld, // Previous subject(s) before change
              roOld: mappedFields.roOld, // Previous room(s) before change
              changedFields: mappedFields.changedFields, // List of field keys that changed (e.g. ['te', 'ro'])
              substText: entry.substitutionText || '',
              lstext: entry.lessonInfo || '',
              activityType: entry.type || 'NORMAL_TEACHING_PERIOD',
              status: entry.status || 'REGULAR',
              statusDetail: entry.statusDetail || null, // e.g. 'MOVED' for shifted lessons
              layoutWidth: typeof entry.layoutWidth === 'number' ? entry.layoutWidth : 1000, // 1000=full class, 500=parallel half-group
            };
            lessons.push(lesson);
          });
        }
      });
    }
    return lessons;
  };

  return callWebUntisAPI({
    dataType: 'timetable',
    getAuth,
    onAuthError,
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
  getAuth,
  onAuthError,
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
  const params = {
    startDate: formatDateYYYYMMDD(rangeStart),
    endDate: formatDateYYYYMMDD(rangeEnd),
    studentId: personId ?? -1,
    klasseId: -1,
    withGrades: true,
  };

  const transform = (data) => {
    const exams = [];
    let examArr = [];

    // Handle multiple response formats
    if (Array.isArray(data?.data?.exams)) {
      examArr = data.data.exams;
    } else if (Array.isArray(data?.exams)) {
      examArr = data.exams;
    } else if (Array.isArray(data)) {
      examArr = data;
    }

    examArr.forEach((exam) => {
      const isAssignedToStudent = personId && Array.isArray(exam.assignedStudents) && exam.assignedStudents.some((s) => s.id === personId);

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

  return callWebUntisAPI({
    dataType: 'exams',
    getAuth,
    onAuthError,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

/**
 * Fetch homework for a student
 */
async function getHomework({ getAuth, onAuthError, server, rangeStart, rangeEnd, personId, logger, debugApi = false, dumpRaw = false }) {
  const params = {
    startDate: formatDateYYYYMMDD(rangeStart),
    endDate: formatDateYYYYMMDD(rangeEnd),
  };

  const transform = (data) => {
    const homeworks = [];
    const seenIds = new Set();

    let hwArray = data.homeworks;
    let lessonsArray = data.lessons;
    let recordsArray = data.records;

    // Handle nested response format
    if (!hwArray && data.data) {
      hwArray = data.data.homeworks;
      lessonsArray = data.data.lessons;
      recordsArray = data.data.records;
    }

    if (!Array.isArray(hwArray)) return homeworks;

    // Build lessons map
    const lessonsMap = {};
    if (Array.isArray(lessonsArray)) {
      lessonsArray.forEach((lesson) => {
        if (lesson.id) lessonsMap[lesson.id] = lesson;
      });
    }

    // Build records map (homeworkId -> elementIds)
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

      // Filter by personId if provided
      if (Number.isFinite(Number(personId)) && Number(personId) !== -1) {
        const matchesByElement = Array.isArray(elementIds) && elementIds.some((e) => Number(e) === Number(personId));
        const matchesByField = hw.studentId && Number(hw.studentId) === Number(personId);
        if (!matchesByElement && !matchesByField) return;
      }

      homeworks.push({
        id: hw.id ?? null,
        lessonId: hw.lessonId ?? hw.lid ?? null,
        dueDate: hw.dueDate ?? hw.date ?? null,
        completed: hw.completed ?? hw.isDone ?? false,
        text: hw.text ?? hw.homework ?? hw.remark ?? '',
        remark: hw.remark ?? '',
        su: lesson?.subject ? [{ name: lesson.subject, longname: lesson.subject }] : (lesson?.su ?? hw.su ?? []),
        elementIds,
        studentId: hw.studentId ?? (elementIds.length ? elementIds[0] : (personId ?? null)),
      });
    });

    return homeworks;
  };

  return callWebUntisAPI({
    dataType: 'homework',
    getAuth,
    onAuthError,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

/**
 * Fetch absences for a student
 */
async function getAbsences({ getAuth, onAuthError, server, rangeStart, rangeEnd, personId, logger, debugApi = false, dumpRaw = false }) {
  const params = {
    startDate: formatDateYYYYMMDD(rangeStart),
    endDate: formatDateYYYYMMDD(rangeEnd),
    studentId: personId ?? -1,
    excuseStatusId: -1,
  };

  const transform = (data) => {
    const absences = [];
    let absArr = [];

    // Handle multiple response formats
    if (Array.isArray(data?.data?.absences)) {
      absArr = data.data.absences;
    } else if (Array.isArray(data?.absences)) {
      absArr = data.absences;
    } else if (Array.isArray(data?.absentLessons)) {
      absArr = data.absentLessons;
    } else if (Array.isArray(data)) {
      absArr = data;
    }

    absArr.forEach((abs) => {
      // API already returns times in HHMM format (e.g., 1350 = 13:50)
      // No conversion needed - pass through as-is
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

  return callWebUntisAPI({
    dataType: 'absences',
    getAuth,
    onAuthError,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

/**
 * Fetch messages of the day
 */
async function getMessagesOfDay({ getAuth, onAuthError, server, date, logger, debugApi = false, dumpRaw = false }) {
  // Note: messagesofday uses direct call in callWebUntisAPI, no tenantId/schoolYearId needed

  const params = {
    date: formatDateYYYYMMDD(date),
  };

  const transform = (data) => {
    // Handle multiple response formats
    if (Array.isArray(data?.data?.messagesOfDay)) {
      return data.data.messagesOfDay;
    }
    if (Array.isArray(data?.messagesOfDay)) {
      return data.messagesOfDay;
    }
    if (Array.isArray(data?.messages)) {
      return data.messages;
    }
    if (Array.isArray(data)) {
      return data;
    }
    return [];
  };

  return callWebUntisAPI({
    dataType: 'messagesofday',
    getAuth,
    onAuthError,
    server,
    params,
    logger,
    transform,
    debugApi,
    dumpRaw,
  });
}

module.exports = {
  getTimetable,
  getExams,
  getHomework,
  getAbsences,
  getMessagesOfDay,
};
