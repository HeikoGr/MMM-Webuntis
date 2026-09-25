const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const moduleRoot = path.join(__dirname, "..");
const fixtureDir = path.join(moduleRoot, "demo", "fixtures");
const fixtures = fs
  .readdirSync(fixtureDir)
  .filter((file) => file.endsWith(".json"))
  .map((file) => ({ file, ...JSON.parse(fs.readFileSync(path.join(fixtureDir, file), "utf8")) }));

const hasIcon = (lesson, icon) => lesson.displayIcons.includes(icon);
const subjectName = (lesson) => lesson.subjects[0]?.name;
const inRange = (fixture, ymd) => ymd >= fixture.context.range.startYmd && ymd <= fixture.context.range.endYmd;
const weekday = (ymd) => new Date(Math.floor(ymd / 10000), Math.floor((ymd % 10000) / 100) - 1, ymd % 100).getDay();

test("the demo fixtures exist", () => {
  assert.ok(fixtures.length > 0);
});

for (const fixture of fixtures) {
  // The screenshots only look right when the free texts and the data tell the same story, see
  // demo/fixtures/README.md. These checks cover what can be checked mechanically.
  test(`${fixture.file}: "today" and the lessons lie in the fixture's school week`, () => {
    const { context, data } = fixture;
    assert.ok(inRange(fixture, context.todayYmd), "todayYmd outside context.range");
    assert.equal(context.config, undefined, "context.config is filled in by the backend (lib/demoData.js)");
    const holidays = data.holidays.ranges;
    for (const lesson of data.lessons) {
      assert.ok(inRange(fixture, lesson.date), `lesson ${lesson.id} outside context.range`);
      assert.ok(![0, 6].includes(weekday(lesson.date)), `lesson ${lesson.id} on a weekend`);
      assert.ok(
        !holidays.some((h) => lesson.date >= h.startDate && lesson.date <= h.endDate),
        `lesson ${lesson.id} during ${holidays[0]?.longName}`,
      );
    }
  });

  test(`${fixture.file}: homework is due in a lesson of its subject that carries the HOMEWORK icon`, () => {
    const { lessons, homework } = fixture.data;
    for (const hw of homework) {
      const assigned = lessons.find((l) => l.id === hw.lessonId);
      assert.equal(subjectName(assigned), hw.subject.name, `homework ${hw.id} was assigned in another subject`);
      assert.ok(assigned.date < hw.dueDate, `homework ${hw.id} is due before it was assigned`);
      if (!inRange(fixture, hw.dueDate)) continue;

      const due = lessons.find((l) => l.date === hw.dueDate && subjectName(l) === hw.subject.name);
      assert.ok(due, `homework ${hw.id} is due on a day without ${hw.subject.name}`);
      assert.notEqual(due.status, "CANCELLED", `homework ${hw.id} is due in a cancelled lesson`);
      assert.ok(hasIcon(due, "HOMEWORK"), `lesson ${due.id} needs the HOMEWORK icon`);
    }
    for (const lesson of lessons.filter((l) => hasIcon(l, "HOMEWORK"))) {
      assert.ok(
        homework.some((hw) => hw.dueDate === lesson.date && hw.subject.name === subjectName(lesson)),
        `lesson ${lesson.id} has a HOMEWORK icon but no homework is due`,
      );
    }
  });

  test(`${fixture.file}: exams sit in a lesson of their subject that carries the EXAM icon`, () => {
    const { lessons, exams } = fixture.data;
    for (const exam of exams.filter((e) => inRange(fixture, e.examDate))) {
      const lesson = lessons.find((l) => l.date === exam.examDate && l.startTime === exam.startTime);
      assert.ok(lesson, `no lesson at the time of "${exam.name}"`);
      assert.equal(lesson.subjects[0].longname, exam.subject);
      assert.ok(hasIcon(lesson, "EXAM"), `lesson ${lesson.id} needs the EXAM icon`);
    }
    for (const lesson of lessons.filter((l) => hasIcon(l, "EXAM"))) {
      assert.ok(
        exams.some((e) => e.examDate === lesson.date && e.startTime === lesson.startTime),
        `lesson ${lesson.id} has an EXAM icon but no exam`,
      );
    }
  });

  test(`${fixture.file}: changed lessons name what changed and what it was before`, () => {
    for (const lesson of fixture.data.lessons) {
      const changed = new Set(lesson.changedFields);
      if (lesson.rooms.length === 0) {
        assert.ok(changed.has("room"), `lesson ${lesson.id} lost its room without a room change`);
      }
      if (changed.has("room")) assert.ok(lesson.previousRooms.length > 0, `lesson ${lesson.id}: previous room`);
      if (changed.has("teacher"))
        assert.ok(lesson.previousTeachers.length > 0, `lesson ${lesson.id}: previous teacher`);
      if (changed.size > 0) assert.equal(lesson.status, "CHANGED", `lesson ${lesson.id}`);
    }
  });

  test(`${fixture.file}: a moved lesson has its cancelled original on the same day`, () => {
    const moved = fixture.data.lessons.filter((l) => hasIcon(l, "MOVED"));
    for (const lesson of moved) {
      const counterpart = moved.find(
        (other) =>
          other !== lesson &&
          other.date === lesson.date &&
          subjectName(other) === subjectName(lesson) &&
          (other.status === "CANCELLED") !== (lesson.status === "CANCELLED"),
      );
      assert.ok(counterpart, `lesson ${lesson.id} is MOVED without a counterpart`);
    }
  });

  test(`${fixture.file}: absences point to a lesson on their day`, () => {
    for (const absence of fixture.data.absences) {
      const lesson = fixture.data.lessons.find((l) => l.id === absence.lessonId);
      assert.equal(lesson?.date, absence.date);
    }
  });
}

test("the demo fixtures together have data for every widget", () => {
  for (const collection of ["lessons", "exams", "homework", "absences", "messages"]) {
    assert.ok(
      fixtures.some((fixture) => fixture.data[collection].length > 0),
      `no fixture has ${collection}`,
    );
  }
});

test("the demo fixtures share one school week and never double-book a teacher or room", () => {
  assert.equal(new Set(fixtures.map((f) => f.context.todayYmd)).size, 1, "fixtures disagree on today");

  const busy = [];
  for (const fixture of fixtures) {
    for (const lesson of fixture.data.lessons.filter((l) => l.status !== "CANCELLED")) {
      const resources = [
        ...lesson.teachers.map((t) => `teacher ${t.longname}`),
        ...lesson.rooms.map((r) => `room ${r.name}`),
      ];
      for (const resource of resources) {
        const clash = busy.find(
          (b) =>
            b.resource === resource &&
            b.date === lesson.date &&
            b.startTime < lesson.endTime &&
            lesson.startTime < b.endTime,
        );
        assert.ok(!clash, `${resource} is double-booked: ${clash?.where} and ${fixture.file} lesson ${lesson.id}`);
        busy.push({
          resource,
          date: lesson.date,
          startTime: lesson.startTime,
          endTime: lesson.endTime,
          where: `${fixture.file} lesson ${lesson.id}`,
        });
      }
    }
  }
});

test("the screenshot setup freezes the clock on the fixtures' today", () => {
  const { todayYmd } = fixtures[0].context;
  const iso = `${String(todayYmd).slice(0, 4)}-${String(todayYmd).slice(4, 6)}-${String(todayYmd).slice(6)}`;
  const script = fs.readFileSync(path.join(moduleRoot, "scripts", "take-screenshots.mjs"), "utf8");
  const screenshotConfig = require("../demo/screenshots/config.js");

  assert.match(script, new RegExp(`SHOT_TIME \\|\\| "${iso}T`));
  assert.equal(screenshotConfig.modules[0].config.debugDate, iso);
});
