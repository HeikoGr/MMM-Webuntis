/*
 * Legacy config mapper
 *
 * Exported function `normalizeConfig(cfg)` accepts a module config object and
 * returns a new object where legacy keys (dateFormats, dateFormat, homeworkDateFormat, examDateFormat,
 * module-level showStartTime, etc.) are mapped into widget-specific namespaces.
 *
 * This file intentionally lives outside `node_helper.js` to keep legacy mapping
 * logic separate and reusable both in frontend and backend.
 */

function normalizeConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const out = { ...cfg };

    // Ensure widget namespaces
    out.lessons = { ...(out.lessons || {}) };
    out.grid = { ...(out.grid || {}) };
    out.exams = { ...(out.exams || {}) };
    out.homework = { ...(out.homework || {}) };
    out.absences = { ...(out.absences || {}) };
    out.messagesofday = { ...(out.messagesofday || {}) };

    // Map dateFormats.* -> widget.dateFormat
    const df = out.dateFormats || {};
    if (df.lessons && !out.lessons.dateFormat) out.lessons.dateFormat = df.lessons;
    if (df.grid && !out.grid.dateFormat) out.grid.dateFormat = df.grid;
    if (df.exams && !out.exams.dateFormat) out.exams.dateFormat = df.exams;
    if (df.homework && !out.homework.dateFormat) out.homework.dateFormat = df.homework;
    if (df.absences && !out.absences.dateFormat) out.absences.dateFormat = df.absences;
    if (df.default) {
        if (!out.lessons.dateFormat) out.lessons.dateFormat = df.default;
        if (!out.grid.dateFormat) out.grid.dateFormat = df.default;
        if (!out.exams.dateFormat) out.exams.dateFormat = df.default;
        if (!out.homework.dateFormat) out.homework.dateFormat = df.default;
        if (!out.absences.dateFormat) out.absences.dateFormat = df.default;
    }

    // Legacy single-value date keys
    if (out.dateFormat) {
        if (!out.lessons.dateFormat) out.lessons.dateFormat = out.dateFormat;
        if (!out.grid.dateFormat) out.grid.dateFormat = out.dateFormat;
        if (!out.exams.dateFormat) out.exams.dateFormat = out.dateFormat;
        if (!out.homework.dateFormat) out.homework.dateFormat = out.dateFormat;
        if (!out.absences.dateFormat) out.absences.dateFormat = out.dateFormat;
    }
    if (out.homeworkDateFormat && !out.homework.dateFormat) out.homework.dateFormat = out.homeworkDateFormat;
    if (out.examDateFormat && !out.exams.dateFormat) out.exams.dateFormat = out.examDateFormat;

    // Map lessons-related legacy keys into lessons namespace
    if (out.showStartTime !== undefined && out.lessons.showStartTime === undefined) out.lessons.showStartTime = out.showStartTime;
    if (out.showRegularLessons !== undefined && out.lessons.showRegularLessons === undefined)
        out.lessons.showRegularLessons = out.showRegularLessons;
    if (out.useShortSubject !== undefined && out.lessons.useShortSubject === undefined) out.lessons.useShortSubject = out.useShortSubject;
    if (out.showTeacherMode !== undefined && out.lessons.showTeacherMode === undefined) out.lessons.showTeacherMode = out.showTeacherMode;
    if (out.showSubstitutionText !== undefined && out.lessons.showSubstitutionText === undefined)
        out.lessons.showSubstitutionText = out.showSubstitutionText;

    // Map grid legacy options
    if (out.mergeGapMinutes !== undefined && out.grid.mergeGapMinutes === undefined) out.grid.mergeGapMinutes = out.mergeGapMinutes;
    if (out.maxGridLessons !== undefined && out.grid.maxGridLessons === undefined) out.grid.maxGridLessons = out.maxGridLessons;
    if (out.showNowLine !== undefined && out.grid.showNowLine === undefined) out.grid.showNowLine = out.showNowLine;

    // Map exams
    if (out.examsDaysAhead !== undefined && out.exams.examsDaysAhead === undefined) out.exams.examsDaysAhead = out.examsDaysAhead;
    if (out.showExamSubject !== undefined && out.exams.showExamSubject === undefined) out.exams.showExamSubject = out.showExamSubject;
    if (out.showExamTeacher !== undefined && out.exams.showExamTeacher === undefined) out.exams.showExamTeacher = out.showExamTeacher;

    // Map absences
    if (out.absencesPastDays !== undefined && out.absences.absencesPastDays === undefined)
        out.absences.absencesPastDays = out.absencesPastDays;
    if (out.absencesFutureDays !== undefined && out.absences.absencesFutureDays === undefined)
        out.absences.absencesFutureDays = out.absencesFutureDays;

    // Remove no-op temporary mappings
    // Note: we intentionally DO NOT delete legacy keys from the output to preserve traceability.

    return out;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeConfig };
if (typeof window !== 'undefined') window.MMMWebuntisLegacyConfig = { normalizeConfig };
