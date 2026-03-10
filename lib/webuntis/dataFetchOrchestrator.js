/**
 * Data Fetch Orchestrator
 * Orchestrates fetching of all data types from WebUntis API
 * Strategy: Timetable first (token validation), then remaining APIs in parallel
 * This prevents silent failures from expired tokens (some APIs return 200 OK with empty data)
 */

const ROLE_TO_RESOURCE_TYPE = new Map([
  ['TEACHER', 'TEACHER'],
  ['ROLE_TEACHER', 'TEACHER'],
  ['CLASS', 'CLASS'],
  ['ROLE_CLASS', 'CLASS'],
  ['LEGAL_GUARDIAN', 'STUDENT'],
  ['ROLE_LEGAL_GUARDIAN', 'STUDENT'],
  ['GUARDIAN', 'STUDENT'],
  ['PARENT', 'STUDENT'],
  ['ELTERN', 'STUDENT'],
  ['PUPIL', 'STUDENT'],
  ['STUDENT', 'STUDENT'],
  ['ROLE_STUDENT', 'STUDENT'],
]);

const { wrapAsync } = require('./errorUtils');

function roleToResourceType(role) {
  const normalized = String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  return ROLE_TO_RESOURCE_TYPE.get(normalized) || null;
}

function getEmptyFetchResult(timetable = []) {
  return {
    timetable,
    exams: [],
    homeworks: [],
    absences: [],
    messagesOfDay: [],
  };
}

function filterHomeworkByWindow(result, { hwNextDays, hwPastDays, baseNow }) {
  if (!Array.isArray(result) || result.length === 0) return result;
  if (hwNextDays >= 999 && hwPastDays >= 999) return result;

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

async function fetchTimetableFirst({ fetchTimetable, dateRanges, activeLogger, fetchFromTargets, buildTimetableRequest }) {
  if (!fetchTimetable || dateRanges.timetable.nextDays <= 0) {
    return [];
  }

  activeLogger?.('debug', null, '🔍 Fetching timetable first (token validation)...');
  return fetchFromTargets({
    dataType: 'timetable',
    defaultValue: [],
    execute: buildTimetableRequest,
    isAcceptable: (result) => Boolean(result && Array.isArray(result)),
  });
}

async function runAuthRefreshRetry({ tracker, alreadyRetried, activeLogger, params }) {
  if (!tracker?.refreshed || alreadyRetried) {
    return null;
  }

  tracker.refreshed = false;
  activeLogger?.('warn', null, '[fetch] Auth refresh detected during timetable fetch, retrying all data types with fresh token');
  return orchestrateFetch({
    ...params,
    _retryAfterAuth: true,
  });
}

async function fetchRemainingData({ fetchPlans, activeLogger, timetable }) {
  if (fetchPlans.length === 0) {
    return getEmptyFetchResult(timetable);
  }

  activeLogger?.('debug', null, `⚡ Fetching ${fetchPlans.length} remaining data types in parallel...`);
  const results = await Promise.all(fetchPlans.map((plan) => plan.promise));

  return {
    timetable,
    exams: results[fetchPlans.findIndex((plan) => plan.type === 'exams')] || [],
    homeworks: results[fetchPlans.findIndex((plan) => plan.type === 'homework')] || [],
    absences: results[fetchPlans.findIndex((plan) => plan.type === 'absences')] || [],
    messagesOfDay: results[fetchPlans.findIndex((plan) => plan.type === 'messagesOfDay')] || [],
  };
}

function validateFetchParams(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('orchestrateFetch requires a params object');
  }
  if (!params.student || typeof params.student !== 'object') {
    throw new Error('orchestrateFetch requires params.student');
  }
  if (!params.dateRanges || typeof params.dateRanges !== 'object') {
    throw new Error('orchestrateFetch requires params.dateRanges');
  }
  if (!params.fetchFlags || typeof params.fetchFlags !== 'object') {
    throw new Error('orchestrateFetch requires params.fetchFlags');
  }
}

function buildOrchestratorContext(params) {
  const { student, dateRanges, baseNow, homeworkFilter = {}, restTargets, contexts = {}, restFns = {}, fetchFlags, logger } = params;

  const { authCtx, sessionCtx, logCtx, flagsCtx } = contexts;
  const { callRest, getTimetableViaRest, getExamsViaRest, getHomeworkViaRest, getAbsencesViaRest, getMessagesOfDayViaRest } = restFns;

  return {
    student,
    dateRanges,
    baseNow,
    restTargets,
    fetchFlags,
    contexts: { authCtx, sessionCtx, logCtx, flagsCtx },
    restFns: {
      callRest,
      getTimetableViaRest,
      getExamsViaRest,
      getHomeworkViaRest,
      getAbsencesViaRest,
      getMessagesOfDayViaRest,
    },
    activeLogger: logger || logCtx?.logger,
    warnings: params.currentFetchWarnings || new Set(),
    hwNextDays: Number(homeworkFilter.nextDays ?? 999),
    hwPastDays: Number(homeworkFilter.pastDays ?? 999),
    className: student.class || student.className || null,
  };
}

function buildTargetHelpers(ctx) {
  const { student, restTargets, contexts, restFns, activeLogger, warnings } = ctx;
  const { authCtx, sessionCtx, logCtx, flagsCtx } = contexts;
  const { callRest } = restFns;

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
    if (!Array.isArray(restTargets) || restTargets.length === 0) {
      return defaultValue;
    }

    for (const target of restTargets) {
      const result = await callTargetWithWrap({
        target,
        dataType,
        defaultValue: null,
        execute,
      });

      const mapped = await wrapAsync(async () => (typeof mapResult === 'function' ? await mapResult(result, target) : result), {
        logger: activeLogger,
        context: {
          dataType,
          studentTitle: student?.title || 'Student',
          server: target.server || authCtx.server,
        },
        defaultValue: null,
        warnings,
      });

      if (mapped == null) continue;
      if (isAcceptable(mapped, target)) return mapped;
    }

    return defaultValue;
  };

  return {
    callWithContext,
    callTargetWithWrap,
    fetchFromTargets,
  };
}

async function runAuthCanaryIfNeeded(ctx, helpers) {
  const { student, dateRanges, baseNow, restTargets, fetchFlags, activeLogger } = ctx;
  const { getTimetableViaRest } = ctx.restFns;
  const { fetchTimetable, fetchExams, fetchHomeworks, fetchAbsences, fetchMessagesOfDay } = fetchFlags;

  const shouldRunAuthCanary = !fetchTimetable && (fetchExams || fetchHomeworks || fetchAbsences || fetchMessagesOfDay);
  if (!shouldRunAuthCanary || !Array.isArray(restTargets) || restTargets.length === 0) {
    return;
  }

  activeLogger?.('debug', null, '[fetch] Timetable disabled; running auth canary via timetable endpoint');
  const canaryStart = dateRanges?.timetable?.start || baseNow;
  const canaryEnd = dateRanges?.timetable?.end || baseNow;
  const target = restTargets[0];
  if (!target) return;

  const resolvedResourceType = roleToResourceType(target.role);
  await helpers.callTargetWithWrap({
    target,
    dataType: 'timetable',
    defaultValue: null,
    execute: (targetAuthCtx) =>
      helpers.callWithContext(getTimetableViaRest, targetAuthCtx, canaryStart, canaryEnd, target.personId, {
        useClassTimetable: Boolean(student.useClassTimetable),
        className: ctx.className,
        classId: student.classId || null,
        personId: target.personId,
        resourceType: resolvedResourceType,
      }),
  });
}

async function fetchTimetablePhase(ctx, helpers) {
  const { student, dateRanges, fetchFlags, contexts, activeLogger } = ctx;
  const { getTimetableViaRest } = ctx.restFns;

  const buildTimetableRequest = (targetAuthCtx, target) => {
    const resolvedResourceType = roleToResourceType(target.role);
    return helpers.callWithContext(
      getTimetableViaRest,
      targetAuthCtx,
      dateRanges.timetable.start,
      dateRanges.timetable.end,
      target.personId,
      {
        useClassTimetable: Boolean(student.useClassTimetable),
        className: ctx.className,
        classId: student.classId || null,
        personId: target.personId,
        studentId: target.personId,
        resourceType: resolvedResourceType,
        role: contexts.sessionCtx?.authSession?.role || target.role,
      }
    );
  };

  return fetchTimetableFirst({
    fetchTimetable: fetchFlags.fetchTimetable,
    dateRanges,
    activeLogger,
    fetchFromTargets: helpers.fetchFromTargets,
    buildTimetableRequest,
  });
}

function buildParallelFetchPlans(ctx, helpers) {
  const { dateRanges, baseNow, fetchFlags, hwNextDays, hwPastDays, activeLogger } = ctx;
  const { getExamsViaRest, getHomeworkViaRest, getAbsencesViaRest, getMessagesOfDayViaRest } = ctx.restFns;
  const { fetchExams, fetchHomeworks, fetchAbsences, fetchMessagesOfDay } = fetchFlags;

  const fetchPlans = [];

  if (fetchExams && dateRanges.exams.nextDays > 0) {
    fetchPlans.push({
      type: 'exams',
      promise: helpers.fetchFromTargets({
        dataType: 'exams',
        defaultValue: [],
        execute: (targetAuthCtx, target) =>
          helpers.callWithContext(getExamsViaRest, targetAuthCtx, dateRanges.exams.start, dateRanges.exams.end, target.personId),
        isAcceptable: (result) => Boolean(result && Array.isArray(result)),
      }),
    });
  } else {
    activeLogger?.('debug', null, `Exams: skipped (exams.nextDays=${dateRanges.exams.nextDays})`);
  }

  if (fetchHomeworks) {
    fetchPlans.push({
      type: 'homework',
      promise: helpers.fetchFromTargets({
        dataType: 'homework',
        defaultValue: [],
        execute: (targetAuthCtx, target) =>
          helpers.callWithContext(getHomeworkViaRest, targetAuthCtx, dateRanges.homework.start, dateRanges.homework.end, target.personId),
        mapResult: (result) => filterHomeworkByWindow(result, { hwNextDays, hwPastDays, baseNow }),
        isAcceptable: () => true,
      }),
    });
  }

  if (fetchAbsences) {
    fetchPlans.push({
      type: 'absences',
      promise: helpers.fetchFromTargets({
        dataType: 'absences',
        defaultValue: [],
        execute: (targetAuthCtx, target) =>
          helpers.callWithContext(getAbsencesViaRest, targetAuthCtx, dateRanges.absences.start, dateRanges.absences.end, target.personId),
        isAcceptable: (result) => Boolean(result && Array.isArray(result)),
      }),
    });
  }

  if (fetchMessagesOfDay) {
    fetchPlans.push({
      type: 'messagesOfDay',
      promise: helpers.fetchFromTargets({
        dataType: 'messagesOfDay',
        defaultValue: [],
        execute: (targetAuthCtx) => helpers.callWithContext(getMessagesOfDayViaRest, targetAuthCtx, baseNow),
        isAcceptable: (result) => Boolean(result && Array.isArray(result)),
      }),
    });
  }

  return fetchPlans;
}

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
  validateFetchParams(params);

  const ctx = buildOrchestratorContext(params);
  const helpers = buildTargetHelpers(ctx);

  await runAuthCanaryIfNeeded(ctx, helpers);

  const timetable = await fetchTimetablePhase(ctx, helpers);

  const tracker = ctx.contexts.sessionCtx?.authRefreshTracker;
  const alreadyRetried = Boolean(params._retryAfterAuth);
  const retryResult = await runAuthRefreshRetry({
    tracker,
    alreadyRetried,
    activeLogger: ctx.activeLogger,
    params,
  });
  if (retryResult) {
    return retryResult;
  }

  const fetchPlans = buildParallelFetchPlans(ctx, helpers);

  return fetchRemainingData({
    fetchPlans,
    activeLogger: ctx.activeLogger,
    timetable,
  });
}

module.exports = {
  orchestrateFetch,
};
