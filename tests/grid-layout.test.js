const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFrontendShared, loadPlugin } = require("./helpers/fake-dom");

// The layout arithmetic of the grid plugin (createGridLayout in plugins/grid/frontend.js), without
// a DOM. The rendered result is covered by the golden master of the demo screenshots.

const layout = loadPlugin(loadFrontendShared(), "grid").layout;
// Objects from the plugin's realm have other prototypes; compare their JSON form.
const deepEqual = (actual, expected, ...message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, ...message);

const hm = (text) => {
  const [h, m] = String(text).split(":").map(Number);
  return h * 60 + m;
};
const ctx = { _toMinutes: (value) => (value === undefined || value === null ? null : hm(value)) };
const lesson = (dateStr, start, end, extra = {}) => ({
  dateStr,
  startMin: hm(start),
  endMin: hm(end),
  status: "REGULAR",
  ...extra,
});
// Dates come from the plugin's realm; compare them as YYYYMMDD strings.
const keys = (dates) => dates.map((date) => layout.formatDateKey(date));

const units = [
  { name: "1", startMin: hm("07:50"), endMin: hm("08:35") },
  { name: "2", startMin: hm("08:40"), endMin: hm("09:25") },
  { name: "3", startMin: hm("09:40"), endMin: hm("10:25") },
];

test("the time range follows the time units and grows for lessons outside them", () => {
  deepEqual(layout.calculateTimeRange([], units, ctx), { allStart: hm("07:50"), allEnd: hm("10:25") });
  const late = [{ startTime: "13:00", endTime: "14:30" }];
  deepEqual(layout.calculateTimeRange(late, units, ctx), { allStart: hm("07:50"), allEnd: hm("14:30") });
  // A lesson of twelve hours or more is a data error and does not stretch the grid.
  const broken = [{ startTime: "00:00", endTime: "23:00" }];
  deepEqual(layout.calculateTimeRange(broken, units, ctx), { allStart: hm("07:50"), allEnd: hm("10:25") });
});

test("without time units the range comes from the lessons, otherwise 7:00 to 17:00", () => {
  const lessons = [
    { startTime: "08:00", endTime: "09:30" },
    { startTime: "11:00", endTime: "12:00" },
  ];
  deepEqual(layout.calculateTimeRange(lessons, [], ctx), { allStart: hm("08:00"), allEnd: hm("12:00") });
  deepEqual(layout.calculateTimeRange([], [], ctx), { allStart: hm("07:00"), allEnd: hm("17:00") });
});

test("maxLessons cuts the range at the start of the next period", () => {
  const allStart = hm("07:50");
  const allEnd = hm("10:25");
  assert.equal(layout.applyMaxLessonsLimit(allStart, allEnd, 2, units), hm("09:40"));
  assert.equal(layout.applyMaxLessonsLimit(allStart, allEnd, 3, units), allEnd, "the last period ends the grid");
  assert.equal(layout.applyMaxLessonsLimit(allStart, allEnd, 0, units), allEnd, "0 means no limit");
});

test("the line under a period sits at the start of the next one", () => {
  deepEqual(layout.getTimeUnitBounds(units, 0), { startMin: hm("07:50"), lineMin: hm("08:40") });
  deepEqual(layout.getTimeUnitBounds(units, 2), { startMin: hm("09:40"), lineMin: hm("10:25") });
  deepEqual(layout.getTimeUnitBounds(units, 5), { startMin: null, lineMin: null });
});

test("a block is clipped to the visible range and keeps a minimum height", () => {
  const range = [hm("08:00"), hm("10:00"), 120, 240]; // allStart, allEnd, totalMinutes, totalHeight
  deepEqual(layout.getVisibleTimeBlockPlacement(hm("07:30"), hm("08:30"), ...range), {
    visibleStart: hm("08:00"),
    visibleEnd: hm("08:30"),
    topPx: 0,
    heightPx: 60,
  });
  assert.equal(
    layout.getVisibleTimeBlockPlacement(hm("08:00"), hm("08:02"), ...range, { minHeightPx: 10 }).heightPx,
    10,
  );
  assert.equal(layout.getVisibleTimeBlockPlacement(hm("10:00"), hm("11:00"), ...range), null);
  assert.equal(layout.getVisibleTimeBlockPlacement("x", hm("09:00"), ...range), null);
});

test("overlapping lessons form one group per day, chains included; supervisions stay alone", () => {
  const a = lesson("20261005", "08:00", "09:00");
  const b = lesson("20261005", "08:30", "09:30");
  const c = lesson("20261005", "09:15", "10:00");
  const d = lesson("20261005", "11:00", "12:00");
  const watch = lesson("20261005", "09:00", "09:15", { displayIcons: ["BREAK_SUPERVISION"] });
  const otherDay = lesson("20261006", "08:00", "09:00");
  const groups = [...layout.groupLessonsByTimeSlot([d, c, watch, b, a, otherDay]).values()];
  deepEqual(groups, [[a, b, c], [d], [watch], [otherDay]]);
});

test("a cancelled lesson with an additional one becomes a split view", () => {
  const cancelled = lesson("20261005", "08:00", "08:45", { status: "CANCELLED" });
  const added = lesson("20261005", "08:00", "08:45", { status: "ADDITIONAL" });
  const result = layout.classifyLessonRenderGroup([cancelled, added]);
  assert.equal(result.isSplitView, true);
  assert.equal(result.shouldUseSplitView, true);
  assert.equal(result.isTickerGroup, false);
});

test("parallel planned lessons become a ticker, which beats the split view", () => {
  const first = lesson("20261005", "08:00", "08:45");
  const second = lesson("20261005", "08:00", "08:45", { status: "CANCELLED" });
  const added = lesson("20261005", "08:00", "08:45", { status: "ADDITIONAL" });
  const result = layout.classifyLessonRenderGroup([first, second, added]);
  assert.equal(result.isTickerGroup, true);
  assert.equal(result.isSplitView, true);
  assert.equal(result.shouldUseSplitView, false);
});

test("a double period with a shorter lesson inside is laid out side by side", () => {
  const double = lesson("20261005", "08:00", "09:30", { status: "SUBSTITUTION", classes: [{ name: "5a" }] });
  const inner = lesson("20261005", "08:45", "09:30", { status: "SUBSTITUTION", classes: [{ name: "5a" }] });
  const result = layout.classifyLessonRenderGroup([double, inner]);
  assert.equal(result.isSpanSplitLayout, true);
  deepEqual(result.spanningLessons, [double]);
  deepEqual(result.subPeriodLessons, [inner]);
});

test("cancelled lessons are paired with their replacements and leave the ticker", () => {
  const cancelledA = lesson("20261005", "08:00", "08:45", { status: "CANCELLED" });
  const cancelledB = lesson("20261005", "08:00", "08:45", { status: "CANCELLED" });
  const replacement = lesson("20261005", "08:00", "08:45", { status: "ADDITIONAL", id: 7 });
  const unrelated = lesson("20261005", "08:00", "08:45");
  const pairs = layout.pairCancelledWithReplacements({
    hasSplitView: true,
    cancelledLessons: [cancelledA, cancelledB],
    replacements: [replacement],
  });
  assert.equal(pairs.length, 1, "same replacements, one pair");
  deepEqual(pairs[0].cancelledLessons, [cancelledA, cancelledB]);

  const groups = new Map([
    ["paired", [cancelledA, cancelledB, replacement]],
    ["mixed", [cancelledA, unrelated]],
  ]);
  layout.removePairedLessons(groups, pairs);
  deepEqual([...groups.entries()], [["mixed", [unrelated]]]);
  deepEqual(layout.pairCancelledWithReplacements({ hasSplitView: false }), []);
});

test("a lesson is past once its day is over or it ended today", () => {
  assert.equal(layout.calcIsPast(20261004, hm("15:00"), 20261005, hm("08:00")), true);
  assert.equal(layout.calcIsPast(20261005, hm("08:00"), 20261005, hm("08:00")), true);
  assert.equal(layout.calcIsPast(20261005, hm("08:45"), 20261005, hm("08:00")), false);
  assert.equal(layout.calcIsPast(20261006, hm("08:45"), 20261005, hm("23:00")), false);
});

test("the rolling view skips weekends without lessons and makes up for them", () => {
  const friday = new Date(2026, 9, 2);
  const config = { pastDays: 1, daysToShow: 2, hideWeekends: true };
  deepEqual(keys(layout.buildRollingDisplayDates(friday, config, () => false)), [
    "20261001",
    "20261002",
    "20261005",
    "20261006",
  ]);
  const saturdayLessons = (key) => key === "20261003";
  deepEqual(keys(layout.buildRollingDisplayDates(friday, config, saturdayLessons)), [
    "20261001",
    "20261002",
    "20261003",
    "20261005",
  ]);
  // A Sunday as today is skipped; one more future day takes its place.
  const sunday = new Date(2026, 9, 4);
  deepEqual(keys(layout.buildRollingDisplayDates(sunday, { ...config, pastDays: 0 }, () => false)), [
    "20261005",
    "20261006",
    "20261007",
  ]);
  deepEqual(keys(layout.buildRollingDisplayDates(sunday, { pastDays: 0, daysToShow: 1 }, () => false)), [
    "20261004",
    "20261005",
  ]);
});

test("rolling range and pixel scale read the config defensively", () => {
  deepEqual(layout.rollingRange("3", 2), { daysToShow: 3, pastDays: 2, startOffset: -2, totalDisplayDays: 6 });
  deepEqual(layout.rollingRange(0, 0), { daysToShow: 0, pastDays: 0, startOffset: 0, totalDisplayDays: 1 });
  assert.equal(layout.resolvePxPerMinute("1.2"), 1.2);
  for (const value of [undefined, null, 0, -1, "abc"])
    assert.equal(layout.resolvePxPerMinute(value), 0.8, String(value));
});
