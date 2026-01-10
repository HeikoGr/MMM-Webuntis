/**
 * WebUntis API Service
 * Unified service for all WebUntis REST API calls
 * Consolidates timetable, exams, homework, absences, and messages of day fetching
 */

const restClient = require('./restClient');

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
 * Generic WebUntis API call
 *
 * @param {Object} config - Configuration object
 * @param {string} config.dataType - Type of data to fetch ('timetable'|'exams'|'homework'|'absences'|'messagesofday')
 * @param {Function} config.getAuth - Function to get authentication (token, cookies, tenantId, schoolYearId)
 * @param {string} config.server - WebUntis server hostname
 * @param {Object} config.params - Query parameters
 * @param {Function} config.logger - Logger function
 * @param {Function} config.transform - Transform function for response data
 * @returns {Promise<any>} Transformed response data
 */
async function callWebUntisAPI({ dataType, getAuth, server, params, logger, transform, debugApi = false }) {
  const endpoint = ENDPOINTS[dataType];
  if (!endpoint) {
    throw new Error(`Unknown dataType: ${dataType}`);
  }

  const logPrefix = `[${dataType}]`;
  if (logger) logger('debug', null, `${logPrefix} Fetching via REST API`);

  try {
    const auth = await getAuth();
    const { token, cookieString, tenantId, schoolYearId } = auth;

    const data = await restClient.callRestAPI({
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

    const result = transform ? transform(data) : data;
    if (logger) logger('debug', null, `${logPrefix} Returned ${Array.isArray(result) ? result.length : '?'} items`);
    return result;
  } catch (error) {
    if (logger) logger('error', null, `${logPrefix} Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Fetch timetable (lessons) for a student or class
 */
async function getTimetable({
  getAuth,
  server,
  rangeStart,
  rangeEnd,
  studentId,
  useClassTimetable = false,
  classId = null,
  logger,
  mapStatusToCode,
  debugApi = false,
}) {
  const resourceType = useClassTimetable ? 'CLASS' : 'STUDENT';
  const resourceId = useClassTimetable ? classId : studentId;

  if (!resourceId) {
    throw new Error(`Missing ${resourceType} id for timetable request`);
  }

  const params = {
    start: restClient.formatDateForAPI(rangeStart),
    end: restClient.formatDateForAPI(rangeEnd),
    resourceType,
    resources: String(resourceId),
    timetableType: 'STANDARD',
  };

  const transform = (resp) => {
    const lessons = [];
    if (resp?.days && Array.isArray(resp.days)) {
      resp.days.forEach((day) => {
        if (day.gridEntries && Array.isArray(day.gridEntries)) {
          day.gridEntries.forEach((entry) => {
            const lesson = {
              id: entry.ids?.[0] ?? null,
              date: day.date ? day.date.split('T')[0] : '',
              startTime: entry.duration?.start ? entry.duration.start.split('T')[1] : '',
              endTime: entry.duration?.end ? entry.duration.end.split('T')[1] : '',
              su: entry.position2?.[0]?.current
                ? [
                    {
                      name: entry.position2[0].current.shortName,
                      longname: entry.position2[0].current.longName,
                    },
                  ]
                : [],
              te: entry.position1?.[0]?.current
                ? [
                    {
                      name: entry.position1[0].current.shortName,
                      longname: entry.position1[0].current.longName,
                    },
                  ]
                : [],
              ro: entry.position3?.[0]?.current
                ? [
                    {
                      name: entry.position3[0].current.shortName,
                      longname: entry.position3[0].current.longName,
                    },
                  ]
                : [],
              code: mapStatusToCode ? mapStatusToCode(entry.status, entry.substitutionText) : '',
              substText: entry.substitutionText || '',
              lstext: entry.lessonInfo || '',
              activityType: entry.type || 'NORMAL_TEACHING_PERIOD',
              lessonText: entry.lessonText || '',
              status: entry.status || 'REGULAR',
              statusDetail: entry.statusDetail || null,
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
    server,
    params,
    logger,
    transform,
    debugApi,
  });
}

/**
 * Fetch exams for a student
 */
async function getExams({
  getAuth,
  server,
  rangeStart,
  rangeEnd,
  studentId,
  logger,
  normalizeDate,
  normalizeTime,
  sanitizeHtml,
  debugApi = false,
}) {
  const params = {
    startDate: formatDateYYYYMMDD(rangeStart),
    endDate: formatDateYYYYMMDD(rangeEnd),
    studentId: studentId ?? -1,
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
      const isAssignedToStudent =
        studentId && Array.isArray(exam.assignedStudents) && exam.assignedStudents.some((s) => s.id === studentId);

      if (!studentId || isAssignedToStudent) {
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
    server,
    params,
    logger,
    transform,
    debugApi,
  });
}

/**
 * Fetch homework for a student
 */
async function getHomework({ getAuth, server, rangeStart, rangeEnd, studentId, logger, debugApi = false }) {
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

      // Filter by studentId if provided
      if (Number.isFinite(Number(studentId)) && Number(studentId) !== -1) {
        const matchesByElement = Array.isArray(elementIds) && elementIds.some((e) => Number(e) === Number(studentId));
        const matchesByField = hw.studentId && Number(hw.studentId) === Number(studentId);
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
        studentId: hw.studentId ?? (elementIds.length ? elementIds[0] : (studentId ?? null)),
      });
    });

    return homeworks;
  };

  return callWebUntisAPI({
    dataType: 'homework',
    getAuth,
    server,
    params,
    logger,
    transform,
    debugApi,
  });
}

/**
 * Fetch absences for a student
 */
async function getAbsences({ getAuth, server, rangeStart, rangeEnd, studentId, logger, debugApi = false }) {
  const params = {
    startDate: formatDateYYYYMMDD(rangeStart),
    endDate: formatDateYYYYMMDD(rangeEnd),
    studentId: studentId ?? -1,
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
      absences.push({
        date: abs.date ?? abs.startDate ?? abs.absenceDate ?? abs.day ?? null,
        startTime: abs.startTime ?? abs.start ?? null,
        endTime: abs.endTime ?? abs.end ?? null,
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
    server,
    params,
    logger,
    transform,
    debugApi,
  });
}

/**
 * Fetch messages of the day
 */
async function getMessagesOfDay({ getAuth, server, date, logger, debugApi = false }) {
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
    server,
    params,
    logger,
    transform,
    debugApi,
  });
}

module.exports = {
  getTimetable,
  getExams,
  getHomework,
  getAbsences,
  getMessagesOfDay,
};
