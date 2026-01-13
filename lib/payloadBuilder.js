/**
 * Payload Builder
 * Constructs the GOT_DATA payload from fetched data with compacting,
 * holiday mapping, warning collection, and debug dumping
 */

const fs = require('fs');
const path = require('path');
const { compactArray, schemas } = require('./payloadCompactor');

/**
 * Build GOT_DATA payload from fetched and compacted data
 * @param {Object} params - Build parameters
 * @param {Object} params.student - Student configuration
 * @param {Array} params.grid - Timegrid data
 * @param {Array} params.timetable - Timetable lessons
 * @param {Array} params.rawExams - Raw exams data
 * @param {Array} params.hwResult - Homework results
 * @param {Array} params.rawAbsences - Raw absences data
 * @param {Array} params.rawMessagesOfDay - Raw messages data
 * @param {Array} params.compactHolidays - Pre-compacted holidays
 * @param {boolean} params.fetchHomeworks - Whether homework was fetched
 * @param {boolean} params.fetchAbsences - Whether absences were fetched
 * @param {boolean} params.fetchMessagesOfDay - Whether messages were fetched
 * @param {Object} params.dateRanges - Pre-calculated date ranges
 * @param {number} params.todayYmd - Today's date as YYYYMMDD integer
 * @param {boolean} params.fetchTimetable - Whether timetable was fetched
 * @param {Object|null} params.activeHoliday - Active holiday for today (if any)
 * @param {Object} params.moduleConfig - Module configuration (for warnings and debug)
 * @param {Function} params.compactTimegrid - Function to compact timegrid
 * @param {Function} params.checkEmptyDataWarning - Function to check for empty data warnings
 * @param {Function} params.mmLog - Logging function
 * @param {Function} params.cleanupOldDebugDumps - Function to cleanup old debug dumps
 * @returns {Object} Complete payload ready for frontend
 */
function buildGotDataPayload(params) {
    const {
        student,
        grid,
        timetable,
        rawExams,
        hwResult,
        rawAbsences,
        rawMessagesOfDay,
        compactHolidays,
        fetchHomeworks,
        fetchAbsences,
        fetchMessagesOfDay,
        dateRanges,
        todayYmd,
        fetchTimetable,
        activeHoliday,
        moduleConfig,
        compactTimegrid,
        checkEmptyDataWarning,
        mmLog,
        cleanupOldDebugDumps,
    } = params;

    // Compact payload to reduce memory
    const compactGrid = compactTimegrid(grid);
    const compactTimetable = compactArray(timetable, schemas.lesson);
    const compactExams = compactArray(rawExams, schemas.exam);
    const compactHomeworks = fetchHomeworks ? compactArray(hwResult, schemas.homework) : [];
    const compactAbsences = fetchAbsences ? compactArray(rawAbsences, schemas.absence) : [];
    const compactMessagesOfDay = fetchMessagesOfDay ? compactArray(rawMessagesOfDay, schemas.message) : [];

    // Build holidayByDate mapping
    const toYmd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rangeStartYmd = toYmd(dateRanges.timetable.start);
    const rangeEndYmd = toYmd(dateRanges.timetable.end);
    const holidayByDate = (() => {
        if (!Array.isArray(compactHolidays) || compactHolidays.length === 0) return {};
        const map = {};
        for (let ymd = rangeStartYmd; ymd <= rangeEndYmd;) {
            const holiday = compactHolidays.find((h) => Number(h.startDate) <= ymd && ymd <= Number(h.endDate));
            if (holiday) map[ymd] = holiday;
            const year = Math.floor(ymd / 10000);
            const month = Math.floor((ymd % 10000) / 100) - 1;
            const day = ymd % 100;
            const tmp = new Date(year, month, day);
            tmp.setDate(tmp.getDate() + 1);
            ymd = tmp.getFullYear() * 10000 + (tmp.getMonth() + 1) * 100 + tmp.getDate();
        }
        return map;
    })();

    // Build payload
    const payload = {
        title: student.title,
        studentId: student.studentId,
        config: student,
        timeUnits: compactGrid,
        timetableRange: compactTimetable,
        exams: compactExams,
        homeworks: compactHomeworks,
        absences: compactAbsences,
        messagesOfDay: compactMessagesOfDay,
        holidays: compactHolidays,
        holidayByDate,
        currentHoliday: activeHoliday,
        absencesUnavailable: false,
    };

    // Collect warnings - need a shared warnings set from caller
    let warnings = [];
    const addWarning = (msg) => {
        if (!msg) return;
        // Use module-level currentFetchWarnings set to dedupe across students
        if (!moduleConfig._currentFetchWarnings) moduleConfig._currentFetchWarnings = new Set();
        if (!moduleConfig._currentFetchWarnings.has(msg)) {
            warnings.push(msg);
            moduleConfig._currentFetchWarnings.add(msg);
        }
    };

    if (moduleConfig && Array.isArray(moduleConfig.__warnings)) {
        moduleConfig.__warnings.forEach(addWarning);
    }
    if (payload && payload.config && Array.isArray(payload.config.__warnings)) {
        payload.config.__warnings.forEach(addWarning);
    }

    // Add empty data warnings (skip during holidays)
    if (!activeHoliday && timetable.length === 0 && fetchTimetable && student.daysToShow > 0) {
        const emptyWarn = checkEmptyDataWarning(timetable, 'lessons', student.title, true);
        addWarning(emptyWarn);
    }
    if (activeHoliday) {
        mmLog('debug', student, `Skipping empty lessons warning: "${activeHoliday.longName || activeHoliday.name}" (today=${todayYmd})`);
    }

    payload._warnings = Array.from(new Set(warnings));

    // Optional debug dump
    try {
        if (moduleConfig && moduleConfig.dumpBackendPayloads) {
            const dumpDir = path.join(__dirname, '..', 'debug_dumps');
            if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
            cleanupOldDebugDumps(dumpDir, 10);
            const safeTitle = (student && student.title ? student.title : 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
            const fname = `${Date.now()}_${safeTitle}_api.json`;
            const target = path.join(dumpDir, fname);
            fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
            mmLog('debug', student, `Wrote debug payload to ${path.join('debug_dumps', fname)}`, 'debug');
        }
    } catch (err) {
        mmLog('error', student, `Failed to write debug payload: ${err && err.message ? err.message : err}`, 'debug');
    }

    mmLog(
        'debug',
        student,
        `✓ Final payload: ${compactTimetable.length} timetable, ${compactExams.length} exams, ${compactHomeworks.length} homework, ${compactAbsences.length} absences, ${compactMessagesOfDay.length} messages (after compacting)\n`
    );

    return payload;
}

module.exports = {
    buildGotDataPayload,
};
