/**
 * Data Fetch Orchestrator
 * Orchestrates parallel fetching of all data types from WebUntis API
 * using Promise.all for 2.7x performance improvement over sequential fetching
 */

/**
 * Fetch all data types in parallel using Promise.all
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

  // Build array of fetch promises - only include enabled fetches
  const fetchPromises = [];
  const fetchTypes = [];

  // DEBUG: Log rest targets
  logger('debug', null, `[orchestrateFetch] Starting parallel fetch with ${restTargets.length} REST targets`);
  logger(
    'debug',
    null,
    `[orchestrateFetch] fetchFlags: timetable=${fetchTimetable}, exams=${fetchExams}, hw=${fetchHomeworks}, abs=${fetchAbsences}, msg=${fetchMessagesOfDay}`
  );

  // Timetable
  if (fetchTimetable && dateRanges.timetable.nextDays > 0) {
    fetchTypes.push('timetable');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const result = await wrapAsync(
            () =>
              callRest(
                getTimetableViaRest,
                target,
                dateRanges.timetable.start,
                dateRanges.timetable.end,
                target.studentId,
                {
                  ...restOptions,
                  useClassTimetable: Boolean(student.useClassTimetable),
                  className,
                  classId: student.classId || null,
                  studentId: target.studentId,
                },
                Boolean(student.useClassTimetable),
                className
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
            return result;
          }
        }
        return [];
      })()
    );
  } else {
    fetchTypes.push('timetable');
    fetchPromises.push(Promise.resolve([]));
  }

  // Exams
  if (fetchExams && dateRanges.exams.nextDays > 0) {
    fetchTypes.push('exams');
    fetchPromises.push(
      (async () => {
        for (const target of restTargets) {
          const result = await wrapAsync(
            () => callRest(getExamsViaRest, target, dateRanges.exams.start, dateRanges.exams.end, target.studentId, restOptions),
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
            () => callRest(getHomeworkViaRest, target, dateRanges.homework.start, dateRanges.homework.end, target.studentId, restOptions),
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
            () => callRest(getAbsencesViaRest, target, dateRanges.absences.start, dateRanges.absences.end, target.studentId, restOptions),
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

  // Execute all fetches in parallel - this is the key performance improvement!
  logger(`⚡ Fetching ${fetchPromises.length} data types in parallel...`);
  const results = await Promise.all(fetchPromises);

  // Map results back to named object
  return {
    timetable: results[fetchTypes.indexOf('timetable')] || [],
    exams: results[fetchTypes.indexOf('exams')] || [],
    homeworks: results[fetchTypes.indexOf('homework')] || [],
    absences: results[fetchTypes.indexOf('absences')] || [],
    messagesOfDay: results[fetchTypes.indexOf('messagesOfDay')] || [],
  };
}

module.exports = {
  orchestrateFetch,
};
