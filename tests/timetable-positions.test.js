/**
 * Mapping of the WebUntis timetable positions (position1-7) to the lesson fields.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const restClient = require("../lib/webuntis/restClient");
const { getTimetable } = require("../lib/webuntis/webuntisApiService");

async function fetchLesson(t, gridEntry) {
  const originalCall = restClient.callRestAPI;
  restClient.callRestAPI = async () => ({
    status: 200,
    data: {
      days: [{ date: "2026-10-05T00:00:00", status: "REGULAR", gridEntries: [{ status: "CHANGED", ...gridEntry }] }],
    },
  });
  t.after(() => {
    restClient.callRestAPI = originalCall;
  });

  const result = await getTimetable({
    authContext: { getAuth: async () => ({ token: "t", cookieString: "", tenantId: 1, schoolYearId: 1 }) },
    server: "x.webuntis.com",
    rangeStart: new Date(2026, 9, 5),
    rangeEnd: new Date(2026, 9, 5),
    personId: 1,
  });
  return result.data[0];
}

test("a teacher removed without replacement is reported as previous teacher", async (t) => {
  const lesson = await fetchLesson(t, {
    position1: [{ current: null, removed: { type: "TEACHER", shortName: "Reg", longName: "Regular" } }],
    position2: [{ current: { type: "SUBJECT", shortName: "M", longName: "Mathematik" }, removed: null }],
  });

  assert.deepEqual(lesson.teachers, []);
  assert.deepEqual(lesson.previousTeachers, [{ name: "Reg", longname: "Regular" }]);
  assert.deepEqual(lesson.changedFields, ["teacher"]);
});

test("a removed class is reported as changed field", async (t) => {
  const lesson = await fetchLesson(t, {
    position4: [
      { current: null, removed: { type: "CLASS", shortName: "5a", longName: "Klasse 5a" } },
      { current: { type: "CLASS", shortName: "5b", longName: "Klasse 5b" }, removed: null },
    ],
  });

  assert.deepEqual(lesson.classes, [{ name: "5b", longname: "Klasse 5b" }]);
  assert.deepEqual(lesson.changedFields, ["class"]);
});

test("a replaced room keeps the current and the previous room", async (t) => {
  const lesson = await fetchLesson(t, {
    position3: [
      {
        current: { type: "ROOM", shortName: "1.13", longName: "Musik 2" },
        removed: { type: "ROOM", shortName: "2.01", longName: "Musik 1" },
      },
    ],
  });

  assert.deepEqual(lesson.rooms, [{ name: "1.13", longname: "Musik 2" }]);
  assert.deepEqual(lesson.previousRooms, [{ name: "2.01", longname: "Musik 1" }]);
  assert.deepEqual(lesson.changedFields, ["room"]);
});

test("unchanged positions do not report changed fields", async (t) => {
  const lesson = await fetchLesson(t, {
    position1: [{ current: { type: "TEACHER", shortName: "Smi", longName: "Smith" }, removed: null }],
    position3: [{ current: { type: "ROOM", shortName: "3.16", longName: "LA 316" } }],
  });

  assert.deepEqual(lesson.teachers, [{ name: "Smi", longname: "Smith" }]);
  assert.deepEqual(lesson.rooms, [{ name: "3.16", longname: "LA 316" }]);
  assert.deepEqual(lesson.changedFields, []);
});
