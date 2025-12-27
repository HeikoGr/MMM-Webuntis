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
  const legacyUsed = [];

  const mark = (k) => {
    try {
      if (k && !legacyUsed.includes(k)) legacyUsed.push(k);
    } catch {
      // ignore
    }
  };

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
    mark('config.dateFormat');
    if (!out.lessons.dateFormat) out.lessons.dateFormat = out.dateFormat;
    if (!out.grid.dateFormat) out.grid.dateFormat = out.dateFormat;
    if (!out.exams.dateFormat) out.exams.dateFormat = out.dateFormat;
    if (!out.homework.dateFormat) out.homework.dateFormat = out.dateFormat;
    if (!out.absences.dateFormat) out.absences.dateFormat = out.dateFormat;
  }
  if (out.homeworkDateFormat && !out.homework.dateFormat) {
    out.homework.dateFormat = out.homeworkDateFormat;
    mark('config.homeworkDateFormat');
  }
  if (out.examDateFormat && !out.exams.dateFormat) {
    out.exams.dateFormat = out.examDateFormat;
    mark('config.examDateFormat');
  }

  // Map lessons-related legacy keys into lessons namespace
  if (out.showStartTime !== undefined && out.lessons.showStartTime === undefined) {
    out.lessons.showStartTime = out.showStartTime;
    mark('config.showStartTime');
  }
  if (out.showRegularLessons !== undefined && out.lessons.showRegular === undefined) {
    out.lessons.showRegular = out.showRegularLessons;
    mark('config.showRegularLessons');
  }
  if (out.showRegular !== undefined && out.lessons.showRegular === undefined) {
    out.lessons.showRegular = out.showRegular;
    mark('config.showRegular');
  }
  if (out.useShortSubject !== undefined && out.lessons.useShortSubject === undefined) {
    out.lessons.useShortSubject = out.useShortSubject;
    mark('config.useShortSubject');
  }
  if (out.showTeacherMode !== undefined && out.lessons.showTeacherMode === undefined) {
    out.lessons.showTeacherMode = out.showTeacherMode;
    mark('config.showTeacherMode');
  }
  if (out.showSubstitutionText !== undefined && out.lessons.showSubstitution === undefined) {
    out.lessons.showSubstitution = out.showSubstitutionText;
    mark('config.showSubstitutionText');
  }
  if (out.showSubstitution !== undefined && out.lessons.showSubstitution === undefined) {
    out.lessons.showSubstitution = out.showSubstitution;
    mark('config.showSubstitution');
  }

  // Map grid legacy options
  if (out.mergeGapMinutes !== undefined && out.grid.mergeGap === undefined) {
    out.grid.mergeGap = out.mergeGapMinutes;
    mark('config.mergeGapMinutes');
  }
  if (out.mergeGap !== undefined && out.grid.mergeGap === undefined) {
    out.grid.mergeGap = out.mergeGap;
    mark('config.mergeGap');
  }
  if (out.maxGridLessons !== undefined && out.grid.maxLessons === undefined) {
    out.grid.maxLessons = out.maxGridLessons;
    mark('config.maxGridLessons');
  }
  if (out.maxLessons !== undefined && out.grid.maxLessons === undefined) {
    out.grid.maxLessons = out.maxLessons;
    mark('config.maxLessons');
  }
  if (out.showNowLine !== undefined && out.grid.showNowLine === undefined) {
    out.grid.showNowLine = out.showNowLine;
    mark('config.showNowLine');
  }

  // Map exams
  if (out.examsDaysAhead !== undefined && out.exams.daysAhead === undefined) {
    out.exams.daysAhead = out.examsDaysAhead;
    mark('config.examsDaysAhead');
  }
  if (out.daysAhead !== undefined && out.exams.daysAhead === undefined) {
    out.exams.daysAhead = out.daysAhead;
    mark('config.daysAhead');
  }
  if (out.showExamSubject !== undefined && out.exams.showSubject === undefined) {
    out.exams.showSubject = out.showExamSubject;
    mark('config.showExamSubject');
  }
  if (out.showSubject !== undefined && out.exams.showSubject === undefined) {
    out.exams.showSubject = out.showSubject;
    mark('config.showSubject');
  }
  if (out.showExamTeacher !== undefined && out.exams.showTeacher === undefined) {
    out.exams.showTeacher = out.showExamTeacher;
    mark('config.showExamTeacher');
  }
  if (out.showTeacher !== undefined && out.exams.showTeacher === undefined) {
    out.exams.showTeacher = out.showTeacher;
    mark('config.showTeacher');
  }

  // Map absences
  if (out.absencesPastDays !== undefined && out.absences.pastDays === undefined) {
    out.absences.pastDays = out.absencesPastDays;
    mark('config.absencesPastDays');
  }
  if (out.pastDays !== undefined && out.absences.pastDays === undefined) {
    out.absences.pastDays = out.pastDays;
    mark('config.pastDays');
  }
  if (out.absencesFutureDays !== undefined && out.absences.futureDays === undefined) {
    out.absences.futureDays = out.absencesFutureDays;
    mark('config.absencesFutureDays');
  }
  if (out.futureDays !== undefined && out.absences.futureDays === undefined) {
    out.absences.futureDays = out.futureDays;
    mark('config.futureDays');
  }

  // Remove no-op temporary mappings
  // Collect a short list of other known legacy top-level keys that should be noted
  const topLevelLegacyKeys = ['fetchInterval', 'days', 'examsDays', 'mergeGapMin', 'debug', 'enableDebug', 'displaymode'];
  for (const k of topLevelLegacyKeys) {
    if (cfg[k] !== undefined && cfg[k] !== null && cfg[k] !== '') mark(`config.${k}`);
  }

  // Note: we intentionally DO NOT delete legacy keys from the output to preserve traceability.

  // Attach recorded legacy keys for callers to surface warnings
  try {
    out.__legacyUsed = Array.from(new Set(legacyUsed));
  } catch {
    out.__legacyUsed = [];
  }

  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { normalizeConfig };
}
// eslint-disable-next-line no-undef
if (typeof window !== 'undefined' && window !== null) {
  // eslint-disable-next-line no-undef
  window.MMMWebuntisLegacyConfig = { normalizeConfig };
}
