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
 * @param {Object} [params.homeworkFilter] - Homework filter window in days
 * @param {number} [params.homeworkFilter.pastDays=999] - Past days to include
 * @param {number} [params.homeworkFilter.nextDays=999] - Next days to include
 * @param {Array} params.restTargets - Array of REST authentication targets
 * @param {Object} params.contexts - Bundled execution contexts
 * @param {Object} params.contexts.authCtx - Authentication context
 * @param {Object} params.contexts.sessionCtx - Session context
 * @param {Object} params.contexts.logCtx - Logging context
 * @param {Object} params.contexts.flagsCtx - Flags context
 * @param {Object} params.fetchFlags - Flags indicating which data types to fetch
 * @param {Object} params.restFns - Bundled REST execution functions
 * @param {Function} params.restFns.callRest - Function to call REST API
 * @param {Function} params.restFns.getTimetableViaRest - Timetable fetch function
 * @param {Function} params.restFns.getExamsViaRest - Exams fetch function
 * @param {Function} params.restFns.getHomeworkViaRest - Homework fetch function
 * @param {Function} params.restFns.getAbsencesViaRest - Absences fetch function
 * @param {Function} params.restFns.getMessagesOfDayViaRest - Messages fetch function
 * @param {Function} params.logger - Logging function
 * @returns {Promise<Object>} Object with timetable, exams, homeworks, absences, messagesOfDay
 */
async function orchestrateFetch(params) {
  const { student, dateRanges, baseNow, homeworkFilter = {}, restTargets, contexts = {}, restFns = {}, fetchFlags, logger } = params;

  const { authCtx, sessionCtx, logCtx, flagsCtx } = contexts;
  const { callRest, getTimetableViaRest, getExamsViaRest, getHomeworkViaRest, getAbsencesViaRest, getMessagesOfDayViaRest } = restFns;

  const activeLogger = logger || logCtx?.logger;

  const warnings = params.currentFetchWarnings || new Set();
  const { wrapAsync } = require('./errorUtils');

  const { fetchTimetable, fetchExams, fetchHomeworks, fetchAbsences, fetchMessagesOfDay } = fetchFlags;
  const hwNextDays = Number(homeworkFilter.nextDays ?? 999);
  const hwPastDays = Number(homeworkFilter.pastDays ?? 999);
  const className = student.class || student.className || null;

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

  const callWithContext = (fn, targetAuthCtx, ...args) => callRest(fn, targetAuthCtx, sessionCtx, logCtx, flagsCtx, ...args);

  const callTargetWithWrap = async ({ target, dataType, defaultValue, execute }) => {
    const targetAuthCtx = buildTargetAuthCtx(target);
    return wrapAsync(() => execute(targetAuthCtx, target), {
      logger: activeLogger,
      context: {
        dataType,
        studentTitle: student?.title || 'Student',
        server: target.server || authCtx.server,
      },
      defaultValue,
      warnings,
    });
  };

  const fetchFromTargets = async ({ dataType, defaultValue, execute, isAcceptable, mapResult }) => {
    for (const target of restTargets) {
      const result = await callTargetWithWrap({
        target,
        dataType,
        defaultValue: null,
        execute,
      });
      const mapped = typeof mapResult === 'function' ? await mapResult(result, target) : result;
      if (isAcceptable(mapped, target)) {
        return mapped;
      }
    }
    return defaultValue;
  };

  const shouldRunAuthCanary = !fetchTimetable && (fetchExams || fetchHomeworks || fetchAbsences || fetchMessagesOfDay);
  if (shouldRunAuthCanary && Array.isArray(restTargets) && restTargets.length > 0) {
    activeLogger?.('debug', null, '[fetch] Timetable disabled; running auth canary via timetable endpoint');
    const canaryStart = dateRanges?.timetable?.start || baseNow;
    const canaryEnd = dateRanges?.timetable?.end || baseNow;
    const target = restTargets[0];
    if (target) {
      const resolvedResourceType = roleToResourceType(target.role);
      await callTargetWithWrap({
        target,
        dataType: 'timetable',
        defaultValue: null,
        execute: (targetAuthCtx) =>
          callWithContext(getTimetableViaRest, targetAuthCtx, canaryStart, canaryEnd, target.personId, {
            useClassTimetable: Boolean(student.useClassTimetable),
            className,
            classId: student.classId || null,
            personId: target.personId,
            resourceType: resolvedResourceType,
          }),
      });
    }
  }

  let timetable = [];
  if (fetchTimetable && dateRanges.timetable.nextDays > 0) {
    activeLogger?.('debug', null, '🔍 Fetching timetable first (token validation)...');
    timetable = await fetchFromTargets({
      dataType: 'timetable',
      defaultValue: [],
      execute: (targetAuthCtx, target) => {
        const resolvedResourceType = roleToResourceType(target.role);
        return callWithContext(getTimetableViaRest, targetAuthCtx, dateRanges.timetable.start, dateRanges.timetable.end, target.personId, {
          useClassTimetable: Boolean(student.useClassTimetable),
          className,
          classId: student.classId || null,
          personId: target.personId,
          studentId: target.personId,
          resourceType: resolvedResourceType,
          role: sessionCtx?.authSession?.role || target.role,
        });
      },
      isAcceptable: (result) => Boolean(result && Array.isArray(result)),
    });
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
      fetchFromTargets({
        dataType: 'exams',
        defaultValue: [],
        execute: (targetAuthCtx, target) =>
          callWithContext(getExamsViaRest, targetAuthCtx, dateRanges.exams.start, dateRanges.exams.end, target.personId),
        isAcceptable: (result) => Boolean(result && Array.isArray(result)),
      })
    );
  } else {
    fetchTypes.push('exams');
    fetchPromises.push(Promise.resolve([]));
    activeLogger?.('debug', null, `Exams: skipped (exams.nextDays=${dateRanges.exams.nextDays})`);
  }

  if (fetchHomeworks) {
    fetchTypes.push('homework');
    fetchPromises.push(
      fetchFromTargets({
        dataType: 'homework',
        defaultValue: [],
        execute: (targetAuthCtx, target) =>
          callWithContext(getHomeworkViaRest, targetAuthCtx, dateRanges.homework.start, dateRanges.homework.end, target.personId),
        mapResult: (result) => {
          if (result && Array.isArray(result) && result.length > 0) {
            if (hwNextDays < 999 || hwPastDays < 999) {
              const filterStart = new Date(baseNow);
              const filterEnd = new Date(baseNow);
              filterStart.setDate(filterStart.getDate() - hwPastDays);
              filterEnd.setDate(filterEnd.getDate() + hwNextDays);

              const filterStartInt = filterStart.getFullYear() * 10000 + (filterStart.getMonth() + 1) * 100 + filterStart.getDate();
              const filterEndInt = filterEnd.getFullYear() * 10000 + (filterEnd.getMonth() + 1) * 100 + filterEnd.getDate();

              return result.filter((hw) => {
                if (!hw.dueDate) return true;
                const dueDateNum = Number(hw.dueDate);
                return dueDateNum >= filterStartInt && dueDateNum <= filterEndInt;
              });
            }
          }
          return result;
        },
        isAcceptable: () => true,
      })
    );
  } else {
    fetchTypes.push('homework');
    fetchPromises.push(Promise.resolve([]));
  }

  if (fetchAbsences) {
    fetchTypes.push('absences');
    fetchPromises.push(
      fetchFromTargets({
        dataType: 'absences',
        defaultValue: [],
        execute: (targetAuthCtx, target) =>
          callWithContext(getAbsencesViaRest, targetAuthCtx, dateRanges.absences.start, dateRanges.absences.end, target.personId),
        isAcceptable: (result) => Boolean(result && Array.isArray(result)),
      })
    );
  } else {
    fetchTypes.push('absences');
    fetchPromises.push(Promise.resolve([]));
  }

  if (fetchMessagesOfDay) {
    fetchTypes.push('messagesOfDay');
    fetchPromises.push(
      fetchFromTargets({
        dataType: 'messagesOfDay',
        defaultValue: [],
        execute: (targetAuthCtx) => callWithContext(getMessagesOfDayViaRest, targetAuthCtx, baseNow),
        isAcceptable: (result) => Boolean(result && Array.isArray(result)),
      })
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
