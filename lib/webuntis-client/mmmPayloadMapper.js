const { buildGotDataPayload } = require('./payloadBuilder');

function mapBundleToMmmPayload(bundle, deps = {}) {
  const { compactTimegrid, checkEmptyDataWarning, mmLog, cleanupOldDebugDumps } = deps;

  if (!bundle || !bundle.coreData) return null;

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
