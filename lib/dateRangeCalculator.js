/**
 * Date Range Calculator
 * Calculates date ranges for all data types (timetable, exams, homework, absences)
 * based on student and module configuration.
 */

/**
 * Calculate date ranges for all data types based on student config
 * @param {Object} student - Student config object
 * @param {Object} config - Module config object
 * @param {Date} baseNow - Base date for calculations
 * @param {boolean} wantsGridWidget - Whether grid widget is enabled
 * @param {boolean} fetchExams - Whether exams should be fetched
 * @param {boolean} fetchAbsences - Whether absences should be fetched
 * @returns {Object} Date ranges for timetable, exams, homework, absences
 */
function calculateFetchRanges(student, config, baseNow, wantsGridWidget, fetchExams, fetchAbsences) {
    const pastDaysValue = Number(student.pastDays ?? 0);
    const nextDaysValue = Number(student.nextDays ?? 2);

    // For timetable/grid, also check grid-specific nextDays/pastDays
    let gridNextDays = nextDaysValue;
    let gridPastDays = pastDaysValue;
    if (wantsGridWidget) {
        const gridNext = Number(student.grid?.nextDays ?? 0);
        const gridPast = Number(student.grid?.pastDays ?? 0);
        gridNextDays = Math.max(0, Number.isFinite(gridNext) ? gridNext : 0, Number.isFinite(nextDaysValue) ? nextDaysValue : 0);
        gridPastDays = Math.max(0, Number.isFinite(gridPast) ? gridPast : 0, Number.isFinite(pastDaysValue) ? pastDaysValue : 0);
    } else {
        gridNextDays = Math.max(0, Number.isFinite(nextDaysValue) ? nextDaysValue : 0);
        gridPastDays = Math.max(0, Number.isFinite(pastDaysValue) ? pastDaysValue : 0);
    }

    const timetableStart = new Date(baseNow);
    const timetableEnd = new Date(baseNow);
    timetableStart.setDate(timetableStart.getDate() - gridPastDays);
    timetableEnd.setDate(timetableEnd.getDate() - gridPastDays + Math.floor(gridNextDays));

    // Exams range
    const examsNextDays = student.exams?.nextDays ?? student.examsDaysAhead ?? student.exams?.daysAhead ?? 0;
    let validatedExamsDays = examsNextDays;
    if (validatedExamsDays < 1 || validatedExamsDays > 360 || isNaN(validatedExamsDays)) {
        validatedExamsDays = 30;
    }
    const examsStart = new Date(baseNow);
    const examsEnd = new Date(baseNow);
    examsStart.setDate(examsStart.getDate() - (student.pastDays ?? 0));
    examsEnd.setDate(examsEnd.getDate() + validatedExamsDays);

    // Absences range
    const absPast = Number.isFinite(Number(student.absences?.pastDays ?? student.absencesPastDays))
        ? Number(student.absences?.pastDays ?? student.absencesPastDays)
        : 0;
    const absFuture = Number.isFinite(Number(student.absences?.nextDays ?? student.absencesFutureDays))
        ? Number(student.absences?.nextDays ?? student.absencesFutureDays)
        : 0;
    const absencesStart = new Date(baseNow);
    const absencesEnd = new Date(baseNow);
    absencesStart.setDate(absencesStart.getDate() - absPast);
    absencesEnd.setDate(absencesEnd.getDate() + absFuture);

    // Homework range (calculate maximum range across all widgets)
    const allRanges = [
        { pastDays: gridPastDays, futureDays: gridNextDays },
        fetchExams && examsNextDays > 0 ? { pastDays: student.exams?.pastDays ?? student.pastDays ?? 0, futureDays: examsNextDays } : null,
        fetchAbsences && (absPast > 0 || absFuture > 0) ? { pastDays: absPast, futureDays: absFuture } : null,
    ].filter(Boolean);

    let maxPastDays = 0;
    let maxFutureDays = 0;
    allRanges.forEach((range) => {
        maxPastDays = Math.max(maxPastDays, range.pastDays || 0);
        maxFutureDays = Math.max(maxFutureDays, range.futureDays || 0);
    });
    if (maxFutureDays === 0) {
        maxFutureDays = 28; // Default homework lookahead
    }

    const homeworkStart = new Date(baseNow);
    const homeworkEnd = new Date(baseNow);
    homeworkStart.setDate(homeworkStart.getDate() - maxPastDays);
    homeworkEnd.setDate(homeworkEnd.getDate() + maxFutureDays);

    return {
        timetable: { start: timetableStart, end: timetableEnd, pastDays: gridPastDays, nextDays: gridNextDays },
        exams: { start: examsStart, end: examsEnd, nextDays: validatedExamsDays },
        homework: { start: homeworkStart, end: homeworkEnd, pastDays: maxPastDays, futureDays: maxFutureDays },
        absences: { start: absencesStart, end: absencesEnd, pastDays: absPast, futureDays: absFuture },
    };
}

module.exports = {
    calculateFetchRanges,
};
