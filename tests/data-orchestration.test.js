const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateFetchRanges,
  compactHolidays,
  compactTimegrid,
  extractHolidaysFromAppData,
  extractTimegridFromTimetable,
  normalizeDateToInteger,
  normalizeTimeToHHMM,
  parseHHMMStringToInteger,
  richTextToPlainText,
  sanitizeRichText,
  stripAllHtml,
} = require("../lib/webuntis/dataOrchestration");

// Local dates at noon: the suite runs in UTC and Europe/Berlin (CI), and noon keeps every
// date on its calendar day across both zones and DST changes.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
const ymd = (date) => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();

test("normalizeDateToInteger reads ISO, numeric and numeric-string dates", () => {
  assert.equal(normalizeDateToInteger("2025-12-17"), 20251217);
  assert.equal(normalizeDateToInteger("2025-1-5"), 20250105);
  assert.equal(normalizeDateToInteger(20251217), 20251217);
  assert.equal(normalizeDateToInteger("20251217"), 20251217);
});

test("normalizeDateToInteger rejects what is not a date", () => {
  for (const value of [null, undefined, "", 0, "abc", 1234, "12-34"]) {
    assert.equal(normalizeDateToInteger(value), null, String(value));
  }
});

test("parseHHMMStringToInteger accepts HH:MM only and checks the range", () => {
  assert.equal(parseHHMMStringToInteger("07:50"), 750);
  assert.equal(parseHHMMStringToInteger(" 7:5 "), 705);
  assert.equal(parseHHMMStringToInteger("00:00"), 0);
  assert.equal(parseHHMMStringToInteger("23:59"), 2359);
  for (const value of ["24:00", "12:60", "0750", "ab:cd", 750, null]) {
    assert.equal(parseHHMMStringToInteger(value), null, String(value));
  }
});

test("normalizeTimeToHHMM reads HH:MM, HHMM numbers and strings, and keeps midnight", () => {
  assert.equal(normalizeTimeToHHMM("07:50"), 750);
  assert.equal(normalizeTimeToHHMM(750), 750);
  assert.equal(normalizeTimeToHHMM("0750"), 750);
  assert.equal(normalizeTimeToHHMM(0), 0, "0 is midnight, not missing");
  assert.equal(normalizeTimeToHHMM("00:00"), 0);
  for (const value of [null, undefined, "", 2400, "2400", "abc"]) {
    assert.equal(normalizeTimeToHHMM(value), null, String(value));
  }
});

test("stripAllHtml removes every tag, decodes entities after that and keeps line breaks", () => {
  assert.equal(stripAllHtml("<b>Mathe</b> &amp; <i>Physik</i>"), "Mathe & Physik");
  assert.equal(stripAllHtml("Zeile 1<br>Zeile 2<br/>  Zeile 3"), "Zeile 1\nZeile 2\nZeile 3");
  assert.equal(stripAllHtml("Zeile 1<br>Zeile 2", false), "Zeile 1 Zeile 2");
  assert.equal(stripAllHtml('<img src=x onerror="alert(1)">Text'), "Text");
  // An encoded tag is text, not markup: it comes back as literal characters for a frontend that
  // escapes before rendering.
  assert.equal(stripAllHtml("&lt;b&gt;fett&lt;/b&gt;"), "<b>fett</b>");
  assert.equal(stripAllHtml(""), "");
  assert.equal(stripAllHtml(null), "");
});

test("sanitizeRichText keeps formatting tags, drops attributes and leaves entities encoded", () => {
  assert.equal(
    sanitizeRichText('<b onclick="x()">fett</b> und <script>bad()</script>normal'),
    "<b>fett</b> und normal",
  );
  assert.equal(sanitizeRichText("&lt;img onerror=x&gt;"), "&lt;img onerror=x&gt;");
  assert.equal(sanitizeRichText("*wichtig* _hier_"), "wichtig hier");
  assert.equal(sanitizeRichText("*wichtig*", true), "*wichtig*");
  assert.equal(sanitizeRichText("a<p>b</p>c"), "a\nb\nc");
});

test("richTextToPlainText decodes entities once every tag is gone", () => {
  assert.equal(richTextToPlainText("3&amp;4 <b>fett</b>"), "3&4 fett");
  assert.equal(richTextToPlainText("&lt;b&gt;"), "<b>");
});

test("holidays come from app/data in either shape and are compacted", () => {
  const raw = [{ id: 1, shortName: "HF", longName: "Herbstferien", start: "2026-10-26", end: "2026-10-30" }];
  const compacted = [{ id: 1, name: "HF", longName: "Herbstferien", startDate: 20261026, endDate: 20261030 }];
  assert.deepEqual(compactHolidays(raw), compacted);
  assert.deepEqual(extractHolidaysFromAppData({ holidays: raw }), compacted);
  assert.deepEqual(extractHolidaysFromAppData({ data: { holidays: raw } }), compacted);
  assert.deepEqual(extractHolidaysFromAppData(null), []);
  assert.deepEqual(extractHolidaysFromAppData({}), []);
  assert.deepEqual(compactHolidays("nope"), []);
});

test("compactTimegrid reads the app/data grid and a derived grid", () => {
  const appData = [{ timeUnits: [{ startTime: 750, endTime: 835, name: "1", extra: true }] }];
  assert.deepEqual(compactTimegrid(appData), [{ startTime: 750, endTime: 835, name: "1" }]);
  assert.deepEqual(compactTimegrid([{ startTime: "07:50", endTime: "08:35" }]), [
    { startTime: "07:50", endTime: "08:35", name: "" },
  ]);
  assert.deepEqual(compactTimegrid([{ unrelated: true }]), []);
  assert.deepEqual(compactTimegrid([]), []);
});

test("extractTimegridFromTimetable sorts periods and closes the last one", () => {
  const grid = extractTimegridFromTimetable([
    { startTime: "09:40", endTime: "10:25" },
    { startTime: "07:50", endTime: "08:35" },
    { startTime: "07:50", endTime: "08:35" },
    { startTime: "08:40", endTime: "09:25" },
  ]);
  assert.deepEqual(grid, [
    { startTime: "07:50", endTime: "08:40", name: "1" },
    { startTime: "08:40", endTime: "09:40", name: "2" },
    { startTime: "09:40", endTime: "10:25", name: "3" },
  ]);
  // Without an end time the last period lasts 45 minutes, across the hour.
  assert.deepEqual(extractTimegridFromTimetable([{ startTime: "13:30" }]), [
    { startTime: "13:30", endTime: "14:15", name: "1" },
  ]);
  assert.deepEqual(extractTimegridFromTimetable([{ subject: "no time" }]), []);
  assert.deepEqual(extractTimegridFromTimetable(null), []);
});

test("calculateFetchRanges needs a valid base date", () => {
  assert.throws(() => calculateFetchRanges({}), /valid baseNow/);
  assert.throws(() => calculateFetchRanges({ baseNow: new Date("invalid") }), /valid baseNow/);
});

test("calculateFetchRanges: the timetable end is exclusive and crosses the year", () => {
  const ranges = calculateFetchRanges({
    baseNow: at(2026, 12, 30),
    fetchPlan: { wantsLessonsWidget: true },
    days: { lessonsNextDays: 3, globalNextDays: 0 },
  });
  assert.equal(ranges.timetable.nextDays, 3);
  assert.equal(ymd(ranges.timetable.start), 20261230);
  assert.equal(ymd(ranges.timetable.end), 20270103, "last day 2027-01-02, exclusive end one day later");
});

test("calculateFetchRanges counts calendar days across the end of daylight saving time", () => {
  // 2026-10-25 is the night the clocks go back in Europe/Berlin.
  const ranges = calculateFetchRanges({
    baseNow: at(2026, 10, 24),
    fetchPlan: { wantsLessonsWidget: true },
    days: { lessonsNextDays: 2, globalNextDays: 0 },
  });
  assert.equal(ymd(ranges.timetable.end), 20261027);
});

test("calculateFetchRanges: hideWeekends counts weekdays, the calendar range grows", () => {
  // Friday 2026-10-02 plus two school days is Tuesday: four calendar days.
  const ranges = calculateFetchRanges({
    baseNow: at(2026, 10, 2),
    fetchPlan: { wantsLessonsWidget: true },
    days: { lessonsNextDays: 2, globalNextDays: 0 },
    options: { lessonsHideWeekends: true },
  });
  assert.equal(ranges.timetable.nextDays, 4);
});

test("calculateFetchRanges: the grid week view reaches Friday, from Saturday the next one", () => {
  const range = (baseNow, debugDateEnabled = false) =>
    calculateFetchRanges({
      baseNow,
      fetchPlan: { wantsGridWidget: true },
      days: { gridNextDays: 0, globalNextDays: 0 },
      options: { gridWeekView: true, debugDateEnabled },
    }).timetable.nextDays;
  assert.equal(range(at(2026, 10, 5)), 4, "Monday to Friday");
  assert.equal(range(at(2026, 10, 3)), 6, "Saturday shows the coming week");
  assert.equal(range(at(2026, 10, 2, 17)), 7, "Friday afternoon shows the coming week");
  assert.equal(range(at(2026, 10, 2, 17), true), 0, "a debugDate keeps the current week");
});

test("calculateFetchRanges: exams fall back to three weeks outside 1..360 days", () => {
  const exams = (examsNextDays) =>
    calculateFetchRanges({ baseNow: at(2026, 10, 5), days: { examsNextDays } }).exams.nextDays;
  assert.equal(exams(0), 21);
  assert.equal(exams(400), 21);
  assert.equal(exams("abc"), 21);
  assert.equal(exams(30), 30);
});

test("calculateFetchRanges: homework covers every range in use, at least four weeks", () => {
  const homework = (input) => calculateFetchRanges({ baseNow: at(2026, 10, 5), ...input }).homework;
  assert.equal(homework({}).futureDays, 28, "default four weeks");
  assert.equal(homework({ days: { homeworkNextDays: 3 } }).futureDays, 3, "an own value wins");
  assert.equal(
    homework({ fetchPlan: { fetchExams: true }, days: { examsNextDays: 40 } }).futureDays,
    40,
    "exam range is wider",
  );
  assert.deepEqual(
    (({ pastDays, futureDays }) => ({ pastDays, futureDays }))(
      homework({ fetchPlan: { fetchAbsences: true }, days: { absencesPastDays: 14, absencesNextDays: 2 } }),
    ),
    { pastDays: 14, futureDays: 28 },
  );
});

test("calculateFetchRanges: absences ignore values that are not numbers", () => {
  const ranges = calculateFetchRanges({
    baseNow: at(2026, 10, 5),
    days: { absencesPastDays: "x", absencesNextDays: 3 },
  });
  assert.equal(ranges.absences.pastDays, 0);
  assert.equal(ranges.absences.futureDays, 3);
});
