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
 * @param {Object} params.restOptions - REST API options
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
    restOptions,
    authRefreshTracker,
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

  // Optional warnings Set passed from caller for per-fetch deduplication
  const warnings = params.currentFetchWarnings || new Set();
  const { wrapAsync } = require('./errorUtils');

  const { fetchTimetable, fetchExams, fetchHomeworks, fetchAbsences, fetchMessagesOfDay } = fetchFlags;

  // ===== STEP 1: Fetch timetable FIRST (token validation canary) =====
  // Timetable reliably returns 401 on expired tokens, unlike other APIs
  // which may return 200 OK with empty arrays, leading to silent data loss
  let timetable = [];
  if (fetchTimetable && dateRanges.timetable.nextDays > 0) {
    logger(`🔍 Fetching timetable first (token validation)...`);
    for (const target of restTargets) {
      const result = await wrapAsync(
        () =>
          callRest(
            getTimetableViaRest,
            target,
            dateRanges.timetable.start,
            dateRanges.timetable.end,
            target.personId,
            {
              ...restOptions,
              useClassTimetable: Boolean(student.useClassTimetable),
              className,
              classId: student.classId || null,
              personId: target.personId,
            },
            Boolean(student.useClassTimetable),
            className,
            target.role === 'TEACHER' ? 'TEACHER' : null
          ),
        {
          logger,
          context: {
            dataType: 'timetable',
            studentTitle: student?.title || 'Student',
            server: target.server,
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

  // If auth refresh was triggered during timetable fetch, retry all data types with fresh token
  const tracker = authRefreshTracker || restOptions?.authRefreshTracker;
  const alreadyRetried = Boolean(restOptions?._retryAfterAuth);
  if (tracker?.refreshed && !alreadyRetried) {
    tracker.refreshed = false;
    if (logger) logger('warn', null, '[fetch] Auth refresh detected during timetable fetch, retrying all data types with fresh token');
    return orchestrateFetch({
      ...params,
      restOptions: { ...restOptions, _retryAfterAuth: true },
      authRefreshTracker: tracker,
    });
  }

  // ===== STEP 2: Fetch remaining data types IN PARALLEL (token is now validated) =====
  // Build array of fetch promises for remaining data types
  const fetchPromises = [];
  const fetchTypes = [];

  // Exams
  if (fetchExams && dateRanges.exams.nextDays > 0) {
    fetchTypes.push('exams');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const result = await wrapAsync(
            () => callRest(getExamsViaRest, target, dateRanges.exams.start, dateRanges.exams.end, target.personId, restOptions),
            {
              logger,
              context: { dataType: 'exams', studentTitle: student?.title || 'Student', server: target.server },
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
    logger(`Exams: skipped (exams.nextDays=${dateRanges.exams.nextDays})`);
  }

  // Homework
  if (fetchHomeworks) {
    fetchTypes.push('homework');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const result = await wrapAsync(
            () => callRest(getHomeworkViaRest, target, dateRanges.homework.start, dateRanges.homework.end, target.personId, restOptions),
            {
              logger,
              context: { dataType: 'homework', studentTitle: student?.title || 'Student', server: target.server },
              defaultValue: [],
              warnings,
            }
          );
          // Filter homework by dueDate based on homework widget config
          if (result && Array.isArray(result) && result.length > 0) {
            const hwNextDays = Number(student.homework?.nextDays ?? student.homework?.daysAhead ?? 999);
            const hwPastDays = Number(student.homework?.pastDays ?? 999);

            // Only filter if explicitly configured
            if (hwNextDays < 999 || hwPastDays < 999) {
              const filterStart = new Date(baseNow);
              const filterEnd = new Date(baseNow);
              filterStart.setDate(filterStart.getDate() - hwPastDays);
              filterEnd.setDate(filterEnd.getDate() + hwNextDays);

              // Convert filter dates to YYYYMMDD integers for comparison (timezone-safe)
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

  // Absences
  if (fetchAbsences) {
    fetchTypes.push('absences');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const result = await wrapAsync(
            () => callRest(getAbsencesViaRest, target, dateRanges.absences.start, dateRanges.absences.end, target.personId, restOptions),
            {
              logger,
              context: { dataType: 'absences', studentTitle: student?.title || 'Student', server: target.server },
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

  // MessagesOfDay
  if (fetchMessagesOfDay) {
    fetchTypes.push('messagesOfDay');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const result = await wrapAsync(() => callRest(getMessagesOfDayViaRest, target, baseNow, restOptions), {
            logger,
            context: { dataType: 'messagesOfDay', studentTitle: student?.title || 'Student', server: target.server },
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

  // Execute remaining fetches in parallel (token already validated by timetable)
  if (fetchPromises.length > 0) {
    logger(`⚡ Fetching ${fetchPromises.length} remaining data types in parallel...`);
    const results = await Promise.all(fetchPromises);

    // Map results back to named object
    return {
      timetable,
      exams: results[fetchTypes.indexOf('exams')] || [],
      homeworks: results[fetchTypes.indexOf('homework')] || [],
      absences: results[fetchTypes.indexOf('absences')] || [],
      messagesOfDay: results[fetchTypes.indexOf('messagesOfDay')] || [],
    };
  }

  // No remaining fetches - return only timetable
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
