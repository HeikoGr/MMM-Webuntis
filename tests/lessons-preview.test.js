const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { calculateFetchRanges } = require("../lib/webuntis/dataOrchestration");
const lessonsBackend = require("../plugins/lessons/backend");
const { loadFrontendShared, loadPlugin } = require("./helpers/fake-dom");

// 2026-10-02 is a Friday, 2026-10-03 a Saturday, 2026-10-05 a Monday.
const FRIDAY = 20261002;
const SATURDAY = 20261003;
const MONDAY = 20261005;

function dateOf(ymd, hhmm = 0, DateClass = Date) {
  return new DateClass(
    Math.floor(ymd / 10000),
    (Math.floor(ymd / 100) % 100) - 1,
    ymd % 100,
    Math.floor(hhmm / 100),
    hhmm % 100,
  );
}

function lesson(date, startTime, status = "REGULAR", subject = "Mathe") {
  return { date, startTime, endTime: startTime + 45, status, subjects: [{ name: subject, longname: subject }] };
}

/**
 * Renders the real lessons plugin with the clock frozen at `now` (YYYYMMDD + HHMM) and returns the
 * header meta and the rows as text, plus the rows' classes.
 */
function renderLessons({ now, lessons, holidays = [], lessonsConfig = {}, studentConfig = {} }) {
  const context = loadFrontendShared();
  context.MMMWebuntisFrontendShared.time.getCurrentDateContext = () => ({
    ymd: now.ymd,
    // A Date of the plugin's own realm: instanceof checks in frontendShared.js reject a foreign one.
    date: dateOf(now.ymd, now.hm, vm.runInContext("Date", context)),
  });
  const plugin = loadPlugin(context, "lessons");
  const config = {
    mode: "verbose",
    ...studentConfig,
    plugins: { lessons: { config: { nextDays: 0, dateFormat: "yyyyMMdd", ...lessonsConfig } } },
  };
  const section = plugin.create({ translate: (_key, fallback) => fallback }).render({
    students: [
      {
        student: { title: "Kind" },
        context: { config },
        data: { lessons, holidays: { ranges: holidays } },
      },
    ],
  });
  const divs = section.findAll("div");
  const header = divs.find((div) => div.className.includes("wu-row-header"))?.textContent ?? "";
  const rows = divs.filter((div) => /\blessonRow\b/.test(div.className));
  return {
    header,
    rows: rows.map((row) => row.textContent.replaceAll("\u00a0", " ").trim()),
    previewRows: rows.filter((row) => row.className.includes("lesson-preview")).length,
    dataClasses: divs.filter((div) => div.className.includes("wu-col-data")).map((div) => div.className),
    suffix: section.findAll("span").find((span) => span.className === "wu-header-meta__suffix"),
  };
}

test("on a weekend the list rolls over to Monday and marks it as preview", () => {
  const { header, rows, previewRows } = renderLessons({
    now: { ymd: SATURDAY, hm: 900 },
    lessons: [lesson(MONDAY, 750, "CANCELLED", "Latein")],
    lessonsConfig: { previewNext: true, previewFrom: "18:00" },
  });

  // previewFrom only holds back a school day; a Saturday has nothing to wait for.
  assert.match(header, /preview/);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /^20261005/);
  assert.match(rows[0], /Latein/);
  assert.equal(previewRows, 1);
});

test("the preview hint in the header has its own span for coloring", () => {
  const { suffix } = renderLessons({
    now: { ymd: SATURDAY, hm: 900 },
    lessons: [lesson(MONDAY, 750, "CANCELLED")],
    lessonsConfig: { previewNext: true },
  });

  assert.equal(suffix?.textContent, "preview");
});

test("a cancelled exam lesson is struck through as well", () => {
  const exam = { ...lesson(MONDAY, 750, "CANCELLED", "Latein"), displayIcons: ["HOMEWORK", "EXAM"] };
  const { dataClasses } = renderLessons({
    now: { ymd: SATURDAY, hm: 900 },
    lessons: [exam],
    lessonsConfig: { previewNext: true },
  });

  assert.equal(dataClasses.length, 1);
  assert.match(dataClasses[0], /\bexam\b/);
  assert.match(dataClasses[0], /\bcancelled\b/);
});

test("without previewNext the weekend stays as it is", () => {
  const { header, rows, previewRows } = renderLessons({
    now: { ymd: SATURDAY, hm: 900 },
    lessons: [lesson(MONDAY, 750, "CANCELLED")],
  });

  assert.doesNotMatch(header, /preview/);
  assert.deepEqual(rows, ["20261003weekend"]);
  assert.equal(previewRows, 0);
});

test("a change still to come keeps today, the last one gone rolls over", () => {
  const options = {
    lessons: [lesson(FRIDAY, 1000, "CANCELLED", "Chemie"), lesson(MONDAY, 750, "CANCELLED", "Latein")],
    lessonsConfig: { previewNext: true },
  };

  const before = renderLessons({ now: { ymd: FRIDAY, hm: 930 }, ...options });
  assert.equal(before.rows.length, 1);
  assert.match(before.rows[0], /^20261002.*Chemie/);
  assert.doesNotMatch(before.header, /preview/);

  const after = renderLessons({ now: { ymd: FRIDAY, hm: 1001 }, ...options });
  assert.equal(after.rows.length, 1);
  assert.match(after.rows[0], /^20261005.*Latein/);
  assert.match(after.header, /preview/);
});

test("debug mode keeping past lessons does not hold the rollover back", () => {
  const { rows } = renderLessons({
    now: { ymd: FRIDAY, hm: 1100 },
    lessons: [lesson(FRIDAY, 1000, "CANCELLED", "Chemie"), lesson(MONDAY, 750, "CANCELLED", "Latein")],
    lessonsConfig: { previewNext: true },
    studentConfig: { logLevel: "debug" },
  });

  assert.equal(rows.length, 1);
  assert.match(rows[0], /Latein/);
});

test("previewFrom holds a finished school day back until its time", () => {
  const options = {
    lessons: [lesson(FRIDAY, 800, "CANCELLED", "Chemie"), lesson(MONDAY, 750, "CANCELLED", "Latein")],
    lessonsConfig: { previewNext: true, previewFrom: "14:00" },
  };

  // Before 14:00 today is shown as without previewNext: its only change has passed, so "nothing".
  const early = renderLessons({ now: { ymd: FRIDAY, hm: 1330 }, ...options });
  assert.doesNotMatch(early.header, /preview/);
  assert.equal(early.previewRows, 0);

  const late = renderLessons({ now: { ymd: FRIDAY, hm: 1400 }, ...options });
  assert.match(late.header, /preview/);
  assert.match(late.rows[0], /Latein/);
});

test("a preview day without changes says so", () => {
  const { rows, previewRows } = renderLessons({
    now: { ymd: SATURDAY, hm: 900 },
    lessons: [lesson(MONDAY, 750), lesson(MONDAY, 850)],
    lessonsConfig: { previewNext: true },
  });

  assert.deepEqual(rows, ["20261005no changes"]);
  assert.equal(previewRows, 1);
});

test("the preview skips holidays to the first school day after them", () => {
  const { rows } = renderLessons({
    now: { ymd: FRIDAY, hm: 1500 },
    lessons: [lesson(20261012, 750, "CANCELLED", "Latein")],
    holidays: [{ name: "Herbst", longName: "Herbstferien", startDate: MONDAY, endDate: 20261009 }],
    lessonsConfig: { previewNext: true },
  });

  assert.equal(rows.length, 1);
  assert.match(rows[0], /^20261012.*Latein/);
});

test("with previewNext the timetable is fetched up to the next school day", () => {
  const fetch = (options) =>
    calculateFetchRanges({
      baseNow: dateOf(FRIDAY, 1200),
      fetchPlan: { wantsLessonsWidget: true },
      days: { lessonsNextDays: 0, globalNextDays: 0 },
      options,
    }).timetable.nextDays;

  assert.equal(fetch({}), 0);
  assert.equal(fetch({ lessonsPreviewNext: true }), 3); // Friday -> Monday
  const holidays = [{ startDate: MONDAY, endDate: 20261009 }];
  assert.equal(fetch({ lessonsPreviewNext: true, holidays }), 10); // past the holiday week
  // A break longer than the lookahead gets no preview and no wider fetch.
  assert.equal(fetch({ lessonsPreviewNext: true, holidays: [{ startDate: MONDAY, endDate: 20261130 }] }), 0);
});

test("previewNext and previewFrom are validated", () => {
  const { validateConfig } = lessonsBackend.setup();
  assert.deepEqual(validateConfig({ previewNext: true, previewFrom: "14:00" }), []);
  assert.deepEqual(validateConfig({ previewNext: false, previewFrom: "" }), []);

  const messages = validateConfig({ previewNext: "yes", previewFrom: "25:00" }).map((issue) => issue.message);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /previewNext/);
  assert.match(messages[1], /previewFrom/);
});
