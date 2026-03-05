/**
 * Data Fetch Orchestrator
 * Orchestrates fetching of all data types from WebUntis API
 * Strategy: Timetable first (token validation), then remaining APIs in parallel
 * This prevents silent failures from expired tokens (some APIs return 200 OK with empty data)
 */

/**
 * Fetch all data types: timetable first (token validation), then others in parallel
 *
 * Strategy:
 * 1. Fetch timetable first - it reliably returns 401 on expired tokens
 * 2. If timetable succeeds, token is valid → fetch remaining APIs in parallel
 * 3. If timetable fails with 401, auth refresh is triggered → retry all
 *
 * Why this order?
 * - Timetable API returns proper 401 Unauthorized for expired tokens
 * - Other APIs (exams, homework, absences) return 200 OK with empty arrays for expired tokens
 * - This prevents silent data loss from expired tokens
 *
 * @param {Object} params - Fetch parameters
 * @param {Object} params.student - Student configuration
 * @param {Object} params.dateRanges - Pre-calculated date ranges
 * @param {Date} params.baseNow - Base date for calculations
 * @param {Array} params.restTargets - Array of REST authentication targets
 * @param {Object} params.authCtx - Authentication context
 * @param {Object} params.sessionCtx - Session context
 * @param {Object} params.logCtx - Logging context
 * @param {Object} params.flagsCtx - Flags context
 * @param {Object} params.fetchFlags - Flags indicating which data types to fetch
 * @param {Function} params.callRest - Function to call REST API
 * @param {Function} params.getTimetableViaRest - Timetable fetch function
 * @param {Function} params.getExamsViaRest - Exams fetch function
 * @param {Function} params.getHomeworkViaRest - Homework fetch function
 * @param {Function} params.getAbsencesViaRest - Absences fetch function
 * @param {Function} params.getMessagesOfDayViaRest - Messages fetch function
 * @param {Function} params.logger - Logging function
 * @param {Function} params.describeTarget - Function to describe auth target
 * @returns {Promise<Object>} Object with timetable, exams, homeworks, absences, messagesOfDay
 */
async function orchestrateFetch(params) {
  const {
    student,
    dateRanges,
    baseNow,
    restTargets,
    authCtx,
    sessionCtx,
    logCtx,
    flagsCtx,
    fetchFlags,
    callRest,
    getTimetableViaRest,
    getExamsViaRest,
    getHomeworkViaRest,
    getAbsencesViaRest,
    getMessagesOfDayViaRest,
    logger,
    className,
  } = params;

  const activeLogger = logger || logCtx?.logger;

  const warnings = params.currentFetchWarnings || new Set();
  const { wrapAsync } = require('./errorUtils');

  const { fetchTimetable, fetchExams, fetchHomeworks, fetchAbsences, fetchMessagesOfDay } = fetchFlags;

  const roleToResourceType = (role) => {
    const normalized = String(role || '')
      .trim()
      .toUpperCase();
    if (!normalized) return null;
    if (normalized.includes('TEACHER')) return 'TEACHER';
    if (normalized.includes('CLASS')) return 'CLASS';
    if (normalized.includes('LEGAL_GUARDIAN')) return 'STUDENT';
    if (normalized.includes('PUPIL')) return 'STUDENT';
    if (normalized.includes('STUDENT')) return 'STUDENT';
    return null;
  };

  const buildTargetAuthCtx = (target) => ({
    ...authCtx,
    school: target.school || authCtx.school,
    server: target.server || authCtx.server,
  });

  const shouldRunAuthCanary = !fetchTimetable && (fetchExams || fetchHomeworks || fetchAbsences || fetchMessagesOfDay);
  if (shouldRunAuthCanary && Array.isArray(restTargets) && restTargets.length > 0) {
    activeLogger?.('debug', null, '[fetch] Timetable disabled; running auth canary via timetable endpoint');
    const canaryStart = dateRanges?.timetable?.start || baseNow;
    const canaryEnd = dateRanges?.timetable?.end || baseNow;
    for (const target of restTargets) {
      const resolvedResourceType = roleToResourceType(target.role);
      const targetAuthCtx = buildTargetAuthCtx(target);
      await wrapAsync(
        () =>
          callRest(
            getTimetableViaRest,
            targetAuthCtx,
            sessionCtx,
            logCtx,
            flagsCtx,
            canaryStart,
            canaryEnd,
            target.personId,
            {
              useClassTimetable: Boolean(student.useClassTimetable),
              className,
              classId: student.classId || null,
              personId: target.personId,
              resourceType: resolvedResourceType,
            },
            Boolean(student.useClassTimetable),
            className,
            resolvedResourceType
          ),
        {
          logger: activeLogger,
          context: {
            dataType: 'timetable',
            studentTitle: student?.title || 'Student',
            server: target.server || authCtx.server,
          },
          defaultValue: null,
          warnings,
        }
      );
      break;
    }
  }

  let timetable = [];
  if (fetchTimetable && dateRanges.timetable.nextDays > 0) {
    activeLogger?.('debug', null, '🔍 Fetching timetable first (token validation)...');
    for (const target of restTargets) {
      const resolvedResourceType = roleToResourceType(target.role);
      const targetAuthCtx = buildTargetAuthCtx(target);
      const result = await wrapAsync(
        () =>
          callRest(
            getTimetableViaRest,
            targetAuthCtx,
            sessionCtx,
            logCtx,
            flagsCtx,
            dateRanges.timetable.start,
            dateRanges.timetable.end,
            target.personId,
            {
              useClassTimetable: Boolean(student.useClassTimetable),
              className,
              classId: student.classId || null,
              personId: target.personId,
              studentId: target.personId,
              resourceType: resolvedResourceType,
              role: sessionCtx?.authSession?.role || target.role,
            },
            Boolean(student.useClassTimetable),
            className,
            resolvedResourceType
          ),
        {
          logger: activeLogger,
          context: {
            dataType: 'timetable',
            studentTitle: student?.title || 'Student',
            server: target.server || authCtx.server,
          },
          defaultValue: [],
          warnings,
        }
      );
      if (result && Array.isArray(result)) {
        timetable = result;
        break;
      }
    }
  }

  const tracker = sessionCtx?.authRefreshTracker;
  const alreadyRetried = Boolean(params._retryAfterAuth);
  if (tracker?.refreshed && !alreadyRetried) {
    tracker.refreshed = false;
    if (activeLogger)
      activeLogger('warn', null, '[fetch] Auth refresh detected during timetable fetch, retrying all data types with fresh token');
    return orchestrateFetch({
      ...params,
      _retryAfterAuth: true,
    });
  }

  const fetchPromises = [];
  const fetchTypes = [];

  if (fetchExams && dateRanges.exams.nextDays > 0) {
    fetchTypes.push('exams');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const targetAuthCtx = buildTargetAuthCtx(target);
          const result = await wrapAsync(
            () =>
              callRest(
                getExamsViaRest,
                targetAuthCtx,
                sessionCtx,
                logCtx,
                flagsCtx,
                dateRanges.exams.start,
                dateRanges.exams.end,
                target.personId
              ),
            {
              logger: activeLogger,
              context: { dataType: 'exams', studentTitle: student?.title || 'Student', server: target.server || authCtx.server },
              defaultValue: [],
              warnings,
            }
          );
          if (result && Array.isArray(result)) {
            return result;
          }
        }
        return [];
      })()
    );
  } else {
    fetchTypes.push('exams');
    fetchPromises.push(Promise.resolve([]));
    activeLogger?.('debug', null, `Exams: skipped (exams.nextDays=${dateRanges.exams.nextDays})`);
  }

  if (fetchHomeworks) {
    fetchTypes.push('homework');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const targetAuthCtx = buildTargetAuthCtx(target);
          const result = await wrapAsync(
            () =>
              callRest(
                getHomeworkViaRest,
                targetAuthCtx,
                sessionCtx,
                logCtx,
                flagsCtx,
                dateRanges.homework.start,
                dateRanges.homework.end,
                target.personId
              ),
            {
              logger: activeLogger,
              context: { dataType: 'homework', studentTitle: student?.title || 'Student', server: target.server || authCtx.server },
              defaultValue: [],
              warnings,
            }
          );
          if (result && Array.isArray(result) && result.length > 0) {
            const hwNextDays = Number(student.homework?.nextDays ?? 999);
            const hwPastDays = Number(student.homework?.pastDays ?? 999);

            if (hwNextDays < 999 || hwPastDays < 999) {
              const filterStart = new Date(baseNow);
              const filterEnd = new Date(baseNow);
              filterStart.setDate(filterStart.getDate() - hwPastDays);
              filterEnd.setDate(filterEnd.getDate() + hwNextDays);

              const filterStartInt = filterStart.getFullYear() * 10000 + (filterStart.getMonth() + 1) * 100 + filterStart.getDate();
              const filterEndInt = filterEnd.getFullYear() * 10000 + (filterEnd.getMonth() + 1) * 100 + filterEnd.getDate();

              const filtered = result.filter((hw) => {
                if (!hw.dueDate) return true;
                const dueDateNum = Number(hw.dueDate);
                return dueDateNum >= filterStartInt && dueDateNum <= filterEndInt;
              });

              return filtered;
            }
          }
          return result;
        }
        return [];
      })()
    );
  } else {
    fetchTypes.push('homework');
    fetchPromises.push(Promise.resolve([]));
  }

  if (fetchAbsences) {
    fetchTypes.push('absences');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const targetAuthCtx = buildTargetAuthCtx(target);
          const result = await wrapAsync(
            () =>
              callRest(
                getAbsencesViaRest,
                targetAuthCtx,
                sessionCtx,
                logCtx,
                flagsCtx,
                dateRanges.absences.start,
                dateRanges.absences.end,
                target.personId
              ),
            {
              logger: activeLogger,
              context: { dataType: 'absences', studentTitle: student?.title || 'Student', server: target.server || authCtx.server },
              defaultValue: [],
              warnings,
            }
          );
          if (result && Array.isArray(result)) {
            return result;
          }
        }
        return [];
      })()
    );
  } else {
    fetchTypes.push('absences');
    fetchPromises.push(Promise.resolve([]));
  }

  if (fetchMessagesOfDay) {
    fetchTypes.push('messagesOfDay');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const targetAuthCtx = buildTargetAuthCtx(target);
          const result = await wrapAsync(() => callRest(getMessagesOfDayViaRest, targetAuthCtx, sessionCtx, logCtx, flagsCtx, baseNow), {
            logger: activeLogger,
            context: { dataType: 'messagesOfDay', studentTitle: student?.title || 'Student', server: target.server || authCtx.server },
            defaultValue: [],
            warnings,
          });
          if (result && Array.isArray(result)) {
            return result;
          }
        }
        return [];
      })()
    );
  } else {
    fetchTypes.push('messagesOfDay');
    fetchPromises.push(Promise.resolve([]));
  }

  if (fetchPromises.length > 0) {
    activeLogger?.('debug', null, `⚡ Fetching ${fetchPromises.length} remaining data types in parallel...`);
    const results = await Promise.all(fetchPromises);

    return {
      timetable,
      exams: results[fetchTypes.indexOf('exams')] || [],
      homeworks: results[fetchTypes.indexOf('homework')] || [],
      absences: results[fetchTypes.indexOf('absences')] || [],
      messagesOfDay: results[fetchTypes.indexOf('messagesOfDay')] || [],
    };
  }

  return {
    timetable,
    exams: [],
    homeworks: [],
    absences: [],
    messagesOfDay: [],
  };
}

module.exports = {
  orchestrateFetch,
};
