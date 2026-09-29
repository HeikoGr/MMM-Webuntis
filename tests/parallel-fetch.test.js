const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const { orchestrateFetch } = require("../lib/webuntis/dataFetchOrchestrator");

function loadNodeHelper() {
  const originalLoad = Module._load;
  const helperPath = require.resolve("../node_helper");
  delete require.cache[helperPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "node_helper") return { create: (definition) => definition };
    if (request === "logger") return { debug() {}, info() {}, warn() {}, error() {} };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../node_helper");
  } finally {
    Module._load = originalLoad;
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A helper whose account login succeeds and whose per-student fetch is the given function. */
function createGroupHelper(fetchStudent) {
  const helper = loadNodeHelper();
  helper._mmLog = () => {};
  helper._ensureRuntime();
  helper._authService.getAuth = async () => ({
    token: "t",
    cookieString: "c",
    tenantId: 1,
    schoolYearId: 2,
    personId: 3,
    appData: {},
  });
  helper._fetchStudentPayload = async ({ student }) => fetchStudent(student);
  const config = helper.prepareConfig({
    id: "m",
    username: "parent",
    password: "pw",
    school: "s",
    server: "x.webuntis.com",
    students: [1, 2, 3, 4, 5].map((studentId) => ({ title: `Kid ${studentId}`, studentId })),
  });
  return { helper, config };
}

test("the students of an account fetch side by side, at most three at a time, in configuration order", async () => {
  const events = [];
  let active = 0;
  let maxActive = 0;
  const { helper, config } = createGroupHelper(async (student) => {
    events.push(`start ${student.title}`);
    active += 1;
    maxActive = Math.max(maxActive, active);
    // Later students finish first, so an unordered result would show.
    await delay(40 - student.studentId * 5);
    active -= 1;
    events.push(`end ${student.title}`);
    return { title: student.title };
  });

  try {
    const { payloads, failed } = await helper._processGroup("parent:x", config.students, "m", config);

    assert.deepEqual(
      payloads.map((payload) => payload.title),
      ["Kid 1", "Kid 2", "Kid 3", "Kid 4", "Kid 5"],
    );
    assert.equal(failed, 0);
    assert.deepEqual(events.slice(0, 3), ["start Kid 1", "start Kid 2", "start Kid 3"], "no student waits for another");
    assert.equal(maxActive, 3, "at most three students at a time");
  } finally {
    helper.stop();
  }
});

test("two students of an account fetch at the same time", async () => {
  let active = 0;
  let maxActive = 0;
  const { helper, config } = createGroupHelper(async (student) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(20);
    active -= 1;
    return { title: student.title };
  });

  try {
    const { payloads } = await helper._processGroup("parent:x", config.students.slice(0, 2), "m", config);
    assert.deepEqual(
      payloads.map((payload) => payload.title),
      ["Kid 1", "Kid 2"],
    );
    assert.equal(maxActive, 2);
  } finally {
    helper.stop();
  }
});

test("a failing student becomes an error payload and does not stop its siblings", async () => {
  const { helper, config } = createGroupHelper(async (student) => {
    if (student.studentId === 3) throw new Error("boom");
    return { title: student.title };
  });

  try {
    const { payloads, failed } = await helper._processGroup("parent:x", config.students, "m", config);

    assert.equal(payloads.length, 5);
    assert.equal(failed, 1);
    assert.equal(payloads[2].context.student.title, "Kid 3");
    assert.equal(payloads[2].state.warnings.length > 0, true);
  } finally {
    helper.stop();
  }
});

/** orchestrateFetch with recorded call order; `verified` says whether a sibling vouched for the token. */
async function runOrchestrator({ verified, refreshDuringTimetable = false }) {
  const events = [];
  const call =
    (name, ms, value = []) =>
    async () => {
      events.push(`start ${name}`);
      await delay(ms);
      events.push(`end ${name}`);
      return value;
    };
  const tracker = { refreshed: false };
  const range = { start: "2026-09-28", end: "2026-10-02", nextDays: 5 };
  const timetable = call("timetable", 30);
  const params = {
    student: { title: "Kid" },
    dateRanges: { timetable: range, exams: range, homework: range, absences: range },
    baseNow: new Date("2026-09-29T10:00:00Z"),
    restTargets: [{ role: "STUDENT", personId: 1 }],
    fetchFlags: { fetchTimetable: true, fetchExams: true, fetchHomeworks: true, fetchAbsences: true },
    contexts: {
      authCtx: {
        cacheKey: "parent:x",
        authService: {
          wasTimetableRecentlyVerified: () => verified,
          markTimetableVerified() {},
        },
      },
      sessionCtx: { authRefreshTracker: tracker },
      logCtx: {},
      flagsCtx: {},
    },
    restFns: {
      callRest: async (fn) => fn(),
      getTimetableViaRest: async () => {
        const result = await timetable();
        if (refreshDuringTimetable) tracker.refreshed = true;
        refreshDuringTimetable = false;
        return result;
      },
      getExamsViaRest: call("exams", 5),
      getHomeworkViaRest: call("homework", 5),
      getAbsencesViaRest: call("absences", 5),
      getMessagesOfDayViaRest: call("messages", 5),
    },
  };
  const result = await orchestrateFetch(params);
  return { events, result };
}

test("without a recent verification the timetable goes first, the other endpoints follow", async () => {
  const { events } = await runOrchestrator({ verified: false });

  const timetableEnd = events.indexOf("end timetable");
  assert.ok(timetableEnd >= 0);
  assert.equal(
    events.slice(0, timetableEnd).some((event) => event.startsWith("start ") && event !== "start timetable"),
    false,
    "nothing else starts before the timetable answered",
  );
  assert.ok(events.includes("start exams"));
});

test("with a recently verified token every endpoint starts together with the timetable", async () => {
  const { events, result } = await runOrchestrator({ verified: true });

  const timetableEnd = events.indexOf("end timetable");
  for (const name of ["exams", "homework", "absences"]) {
    assert.ok(events.indexOf(`start ${name}`) < timetableEnd, `${name} starts before the timetable ends`);
  }
  assert.deepEqual(Object.keys(result).sort(), ["absences", "exams", "homeworks", "messagesOfDay", "timetable"]);
});

test("an auth refresh during the timetable call still repeats the whole fetch", async () => {
  const { events } = await runOrchestrator({ verified: true, refreshDuringTimetable: true });

  assert.equal(events.filter((event) => event === "start timetable").length, 2, "the timetable ran again");
  assert.equal(events.filter((event) => event === "start exams").length, 2, "and so did the other endpoints");
  const firstRoundEnd = events.indexOf("end exams");
  const secondTimetableStart = events.lastIndexOf("start timetable");
  assert.ok(firstRoundEnd < secondTimetableStart, "the requests of the old token finished before the retry");
});
