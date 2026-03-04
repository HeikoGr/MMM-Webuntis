const { buildGotDataPayload } = require('./payloadBuilder');

function mapBundleToMmmPayload(bundle, deps = {}) {
  const { compactTimegrid, checkEmptyDataWarning, mmLog, cleanupOldDebugDumps } = deps;

  if (!bundle) return null;

  const {
    identifier,
    sessionKey,
    student,
    config,
    compactHolidays,
    dateRanges,
    todayYmd,
    activeHoliday,
    fetchTimetable,
    fetchFlags,
    fetchHomeworks,
    fetchAbsences,
    fetchMessagesOfDay,
    currentFetchWarnings,
    apiStatus,
    data,
  } = bundle;

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
    fetchHomeworks,
    fetchAbsences,
    fetchMessagesOfDay,
    dateRanges,
    todayYmd,
    fetchTimetable,
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
