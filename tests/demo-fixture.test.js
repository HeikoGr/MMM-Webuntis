const test = require("node:test");
const assert = require("node:assert/strict");

const fixture = require("../demo/fixtures/single-student-week.json");

// The backend fills in context.config (lib/demoData.js); the fixture only carries data.
test("the demo fixture has data for every widget and no config of its own", () => {
  assert.equal(fixture.context.config, undefined);
  for (const collection of ["lessons", "exams", "homework", "absences", "messages"]) {
    assert.ok(fixture.data[collection].length > 0, `fixture needs ${collection}`);
  }
});
