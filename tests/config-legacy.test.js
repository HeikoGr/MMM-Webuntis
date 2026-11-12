const test = require("node:test");
const assert = require("node:assert/strict");
const { applyLegacyMappings, generateDeprecationWarnings } = require("../lib/configValidator");

// Old configs keep working after an update only through these mappings, so every class of mapping
// has a case: top level, all widgets, single widget, priority, special keys, deprecated keys.

test("non-objects pass through untouched", () => {
  assert.deepEqual(applyLegacyMappings(null), { normalizedConfig: null, legacyUsed: [] });
  assert.deepEqual(applyLegacyMappings("x"), { normalizedConfig: "x", legacyUsed: [] });
});

test("top-level keys are renamed and converted; a new key that is set wins", () => {
  const { normalizedConfig, legacyUsed } = applyLegacyMappings({
    fetchInterval: "60000",
    displaymode: "Lessons,Exams",
  });
  assert.equal(normalizedConfig.updateInterval, 60000);
  assert.equal(normalizedConfig.displayMode, "lessons,exams");
  assert.deepEqual(legacyUsed.sort(), ["displaymode", "fetchInterval"]);

  const kept = applyLegacyMappings({ fetchInterval: 1, updateInterval: 300000 });
  assert.equal(kept.normalizedConfig.updateInterval, 300000);
  assert.deepEqual(kept.legacyUsed, ["fetchInterval"], "still reported, so the user can clean up");
});

test("debug and enableDebug become a logLevel, an explicit logLevel wins", () => {
  assert.equal(applyLegacyMappings({ debug: true }).normalizedConfig.logLevel, "debug");
  assert.equal(applyLegacyMappings({ debug: false }).normalizedConfig.logLevel, "info", "false means not silenced");
  const enable = applyLegacyMappings({ enableDebug: true });
  assert.equal(enable.normalizedConfig.logLevel, "debug");
  assert.deepEqual(enable.legacyUsed, ["enableDebug"]);
  assert.equal(applyLegacyMappings({ debug: true, logLevel: "warn" }).normalizedConfig.logLevel, "warn");
  assert.equal(applyLegacyMappings({ debug: "yes" }).normalizedConfig.logLevel, undefined, "only booleans map");
});

test("daysToShow reaches every widget, pastDaysToShow only the ones with a past", () => {
  const { normalizedConfig } = applyLegacyMappings({ daysToShow: "5", pastDaysToShow: 2, grid: { nextDays: 3 } });
  assert.equal(normalizedConfig.grid.nextDays, 3, "the widget's own value wins");
  for (const widget of ["lessons", "exams", "homework", "absences", "messagesofday"]) {
    assert.equal(normalizedConfig[widget].nextDays, 5, widget);
  }
  assert.equal(normalizedConfig.lessons.pastDays, 2);
  assert.equal(normalizedConfig.absences.pastDays, 2);
  assert.equal(normalizedConfig.exams.pastDays, undefined);
});

test("a widget-specific legacy key beats the global one", () => {
  const { normalizedConfig } = applyLegacyMappings({ daysToShow: 5, examsDaysAhead: 30, mergeGapMin: "15" });
  assert.equal(normalizedConfig.exams.nextDays, 30);
  assert.equal(normalizedConfig.lessons.nextDays, 5);
  assert.equal(normalizedConfig.grid.mergeGap, 15);
});

test("a global dateFormat fills every widget that has none", () => {
  const { normalizedConfig } = applyLegacyMappings({ dateFormat: "dd.MM.", exams: { dateFormat: "EEE" } });
  assert.equal(normalizedConfig.exams.dateFormat, "EEE");
  assert.equal(normalizedConfig.lessons.dateFormat, "dd.MM.");
  assert.equal(normalizedConfig.homework.dateFormat, "dd.MM.");
});

test("removed keys are reported without being mapped; empty values are not reported", () => {
  const { normalizedConfig, legacyUsed } = applyLegacyMappings({ showExams: false, fetchHomeworks: "" });
  assert.deepEqual(legacyUsed, ["showExams"]);
  assert.equal(normalizedConfig.displayMode, undefined);
});

test("deprecation warnings name the new key", () => {
  assert.deepEqual(generateDeprecationWarnings(["fetchInterval", "examsDaysAhead", "showRegularLessons"]), [
    'DEPRECATED: "fetchInterval" → Use "updateInterval" instead',
    'DEPRECATED: "examsDaysAhead" → Use "exams.nextDays" instead',
    'DEPRECATED: "showRegularLessons" → Use "lessons.showRegular" instead',
  ]);
  assert.deepEqual(generateDeprecationWarnings(["somethingElse"]), [
    'DEPRECATED: "somethingElse" is no longer supported',
  ]);
});

test("the warning for a global dateFormat points to the per-widget option", () => {
  const [warning] = generateDeprecationWarnings(["dateFormat"]);
  assert.notEqual(warning, 'DEPRECATED: "dateFormat" → Use "dateFormat" instead');
  assert.match(warning, /lessons\.dateFormat/);
});

test("every mapped legacy key gets a warning that names a different key", () => {
  // Collect the keys through the mapper itself, so a new mapping cannot go without a warning.
  const sample = {
    fetchInterval: 1,
    days: 1,
    displaymode: "lessons",
    debug: true,
    daysToShow: 1,
    pastDaysToShow: 1,
    mergeGapMin: 1,
    mergeGapMinutes: 1,
    maxGridLessons: 1,
    showRegularLessons: true,
    showSubstitutionText: true,
    examsDays: 1,
    examsDaysAhead: 1,
    daysAhead: 1,
    showExamSubject: true,
    showExamTeacher: true,
    examDateFormat: "x",
    examsDaysBehind: 1,
    homeworkDateFormat: "x",
    absencesPastDays: 1,
    absencesFutureDays: 1,
    dateFormat: "x",
  };
  const { legacyUsed } = applyLegacyMappings(sample);
  assert.equal(legacyUsed.length, Object.keys(sample).length);
  for (const warning of generateDeprecationWarnings(legacyUsed)) {
    const [, from, to] = warning.match(/^DEPRECATED: "([^"]+)" → Use "([^"]+)" instead$/) || [];
    assert.ok(from && to, warning);
    assert.notEqual(from, to, warning);
  }
});
