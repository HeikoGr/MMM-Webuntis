const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const runtimeUtils = require("../lib/runtime-utils");
const { richTextToPlainText, sanitizeRichText } = require("../lib/webuntis/dataOrchestration");
const singleStudentWeekFixture = require("../demo/fixtures/single-student-week.json");

/**
 * Load the browser-side shared frontend API under minimal DOM stubs.
 *
 * Globals are restored afterwards so the node-side tests stay unaffected.
 *
 * @returns {Object} window.MMMWebuntisFrontendShared
 */
function loadFrontendShared() {
  const previousWindow = global.window;
  const previousDocument = global.document;

  global.window = {};
  global.document = { createElement: () => ({ style: {}, appendChild() {} }) };

  const sharedPath = require.resolve("../lib/frontendShared");
  delete require.cache[sharedPath];
  require(sharedPath);
  const shared = global.window.MMMWebuntisFrontendShared;

  global.window = previousWindow;
  global.document = previousDocument;

  return shared;
}

/**
 * Load the frontend module definition object passed to Module.register(),
 * under minimal Module/document stubs, without executing MagicMirror itself.
 *
 * @returns {Object} the module definition object (methods callable as `def.method(...)`)
 */
function loadFrontendModule() {
  const previousModule = global.Module;
  const previousDocument = global.document;

  let captured = null;
  global.Module = {
    register: (_name, definition) => {
      captured = definition;
    },
  };
  global.document = { createElement: () => ({ style: {}, classList: { add() {} }, appendChild() {} }) };

  const modulePath = require.resolve("../MMM-Webuntis");
  delete require.cache[modulePath];
  require(modulePath);

  global.Module = previousModule;
  global.document = previousDocument;

  return captured;
}

function loadNodeHelper() {
  const originalLoad = Module._load;
  const helperPath = require.resolve("../node_helper");
  delete require.cache[helperPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "node_helper") {
      return { create: (definition) => definition };
    }
    if (request === "logger") {
      return { debug() {}, info() {}, warn() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require("../node_helper");
  } finally {
    Module._load = originalLoad;
  }
}

const helper = loadNodeHelper();
const { ApiStatusTracker, getTransientBackoffMs, extractHttpStatus } = require("../lib/apiStatusTracker");
const warningUtils = require("../lib/warningUtils");
const { getCredentialKey } = require("../lib/authSession");
const { buildFetchFlags } = require("../lib/moduleConfig");
const { buildStudentErrorPayload } = require("../lib/mmm-adapter/mmmPayloadMapper");
const { calculateBaseNow } = require("../lib/webuntisClient");

test("sanitizeRichText preserves the formatting whitelist and removes unsafe markup", () => {
  const result = sanitizeRichText(
    '<p>Hello <strong onclick="alert(1)">World</strong><br><script>alert(1)</script><img src=x></p>',
  );

  assert.equal(result, "Hello <strong>World</strong>");
});

test("sanitizeRichText keeps Markdown markers only when requested", () => {
  assert.equal(sanitizeRichText("A *marked* _text_"), "A marked text");
  assert.equal(sanitizeRichText("A *marked* _text_", true), "A *marked* _text_");
});

test("richTextToPlainText decodes HTML entities instead of leaving them literal (issue #88)", () => {
  assert.equal(richTextToPlainText("Aufgabe 3&amp;4 schriftlich"), "Aufgabe 3&4 schriftlich");
  assert.equal(richTextToPlainText("&auml;&ouml;&uuml;&szlig; &#228;"), "äöüß ä");
  assert.equal(richTextToPlainText("<b>Wichtig</b><br>morgen"), "Wichtig\nmorgen");
});

test("sanitizeRichText never turns encoded markup into live HTML", () => {
  // WebUntis stores literally typed markup entity-encoded; decoding it after the sanitizer ran
  // made the messages-of-day widget execute it.
  assert.equal(
    sanitizeRichText("&lt;img src=x onerror=alert(1)&gt; &amp; <b>fett</b>"),
    "&lt;img src=x onerror=alert(1)&gt; &amp; <b>fett</b>",
  );
  assert.equal(richTextToPlainText("&lt;img src=x onerror=alert(1)&gt;"), "<img src=x onerror=alert(1)>");
});

test("single-student-week fixture matches the canonical V3 payload shape", () => {
  const { data, state } = singleStudentWeekFixture;

  assert.deepEqual(Object.keys(data).sort(), [
    "absences",
    "dayNotices",
    "exams",
    "holidays",
    "homework",
    "lessons",
    "messages",
    "timeUnits",
  ]);
  assert.deepEqual(state.warningMeta, []);
  assert.equal(data.holidays.current, null);

  for (const lesson of data.lessons) {
    assert.equal(Array.isArray(lesson.displayIcons), true);
    assert.equal("activityType" in lesson, false);
    assert.equal("statusDetail" in lesson, false);
  }

  for (const exam of data.exams) {
    assert.equal("endTime" in exam, true);
  }

  for (const homework of data.homework) {
    for (const field of ["id", "lid", "lessonId", "studentId", "elementIds", "completed", "remark"]) {
      assert.equal(field in homework, true);
    }
  }

  for (const absence of data.absences) {
    assert.equal("student" in absence, true);
    assert.equal("lessonId" in absence, true);
  }
});

test("mergeGroupWarningsIntoPayload deduplicates warnings and upgrades generic metadata", () => {
  const payload = {
    state: {
      warnings: ["auth warning"],
      warningMeta: [{ message: "auth warning", kind: "generic", severity: "warning" }],
    },
  };

  const result = warningUtils.mergeGroupWarningsIntoPayload(
    payload,
    ["auth warning", "config warning"],
    new Map([
      ["auth warning", { kind: "auth", severity: "critical" }],
      ["config warning", { kind: "config", severity: "warning" }],
    ]),
  );

  assert.deepEqual(result.state.warnings, ["auth warning", "config warning"]);
  assert.deepEqual(result.state.warningMeta, [
    { message: "auth warning", kind: "auth", severity: "critical" },
    { message: "config warning", kind: "config", severity: "warning" },
  ]);
});

test("buildStudentErrorPayload returns empty API snapshot and fallback warning metadata", () => {
  const payload = buildStudentErrorPayload({
    identifier: "module-1",
    student: { title: "Student A" },
    config: { displayMode: "lessons" },
    fetchFlags: { fetchTimetable: true },
    apiStatus: {},
    warnings: ["plain warning"],
    warningMetaByMessage: new Map(),
    warningFallbackMeta: { kind: "generic", severity: "warning" },
  });

  assert.equal(payload.contractVersion, 3);
  assert.equal(payload.id, "module-1");
  assert.equal(payload.context.student.title, "Student A");
  assert.deepEqual(payload.data.lessons, []);
  assert.equal(payload.state.fetch.timetable, true);

  assert.deepEqual(payload.state.api, {
    timetable: null,
    exams: null,
    homework: null,
    absences: null,
    messages: null,
  });
  assert.deepEqual(payload.state.warningMeta, [{ message: "plain warning", kind: "generic", severity: "warning" }]);
});

test("createGroupWarningCollector stores one warning entry per message", () => {
  const collector = warningUtils.createGroupWarningCollector();

  collector.addGroupWarning("network issue", { kind: "network", severity: "critical" });
  collector.addGroupWarning("network issue", { kind: "config", severity: "warning" });
  collector.addGroupWarning("config issue");

  assert.deepEqual(collector.groupWarnings, ["network issue", "config issue"]);
  assert.deepEqual(collector.groupWarningMetaByMessage.get("network issue"), {
    kind: "network",
    severity: "critical",
  });
  assert.deepEqual(collector.groupWarningMetaByMessage.get("config issue"), {
    kind: "generic",
    severity: "warning",
  });
});

const { parseCliArgs } = require("../scripts/node_helper_wrapper");

function parseCli(argline) {
  return parseCliArgs(["node", "node_helper_wrapper.js", ...argline.split(" ").filter(Boolean)], 2);
}

test("parseCliArgs does not mistake a flag value for the positional config path", () => {
  // Regression: `auth` used to be picked up as the positional command and reused as --config,
  // which made every documented `--action <x>` invocation fail with "Config file not found".
  const { flags, command } = parseCli("--action auth --verbose");

  assert.equal(flags.action, "auth");
  assert.equal(flags.verbose, true);
  assert.equal(command, null);
});

test("parseCliArgs handles every invocation documented in the CLI help", () => {
  const cases = [
    ["--student 0", { student: "0" }],
    ["--student 1 --verbose", { student: "1", verbose: true }],
    ["--action exams", { action: "exams" }],
    ["--action lessons,grid", { action: "lessons,grid" }],
    ["--action homework --verbose", { action: "homework", verbose: true }],
    ["--dump --verbose", { dump: true, verbose: true }],
    ["--config ./custom-config.js --student 1", { config: "./custom-config.js", student: "1" }],
    ["--all --action auth --verbose", { all: true, action: "auth", verbose: true }],
  ];

  for (const [argline, expected] of cases) {
    const { flags, command } = parseCli(argline);
    assert.deepEqual(flags, expected, `flags mismatch for "${argline}"`);
    assert.equal(command, null, `"${argline}" must not produce a positional command`);
  }
});

test("parseCliArgs supports short, bundled, and =-style flags", () => {
  assert.deepEqual(parseCli("-a auth -v").flags, { a: "auth", v: true });
  assert.deepEqual(parseCli("-vd").flags, { v: true, d: true });
  assert.deepEqual(parseCli("--action=auth --config=./c.js").flags, { action: "auth", config: "./c.js" });

  // A boolean long flag must not swallow the next flag.
  assert.deepEqual(parseCli("--verbose --action auth").flags, { verbose: true, action: "auth" });

  // A value flag at the end of the line degrades to boolean instead of consuming undefined.
  assert.deepEqual(parseCli("--action").flags, { action: true });
});

test("parseCliArgs still accepts a bare config path as positional command", () => {
  const { flags, command } = parseCli("./config/config.js --verbose");

  assert.equal(command, "./config/config.js");
  assert.equal(flags.verbose, true);
});

test("collectCapabilities prefers the backend hook and falls back to the manifest", () => {
  const { collectCapabilities, buildFetchFlagsFromCapabilities } = require("../lib/pluginCapabilityResolver");

  const records = [
    // No backend instance: manifest capabilities are used.
    { manifest: { id: "exams", capabilities: ["exams", "studentContext"] }, instance: null },
    // Backend hook overrides the manifest and may depend on plugin config.
    {
      manifest: { id: "grid", capabilities: ["lessons"] },
      instance: {
        getCapabilities: (pluginConfig) =>
          pluginConfig?.showAbsences ? ["lessons", "timeUnits", "absences"] : ["lessons", "timeUnits"],
      },
    },
  ];

  const withoutAbsences = collectCapabilities(records, { getPluginConfig: () => ({}) });
  assert.deepEqual(withoutAbsences, ["exams", "lessons", "studentContext", "timeUnits"]);

  const withAbsences = collectCapabilities(records, {
    getPluginConfig: (id) => (id === "grid" ? { showAbsences: true } : {}),
  });
  assert.equal(withAbsences.includes("absences"), true);
  assert.equal(buildFetchFlagsFromCapabilities(withAbsences).fetchAbsences, true);

  // Unknown capability names are dropped rather than silently forwarded as fetch flags.
  const bogus = collectCapabilities(
    [{ manifest: { id: "x", capabilities: ["lessons", "notACapability"] }, instance: null }],
    {},
  );
  assert.deepEqual(bogus, ["lessons"]);
});

test("buildFetchFlags derives fetch flags from active plugin capabilities", () => {
  helper._mmLog = () => {};
  helper._pluginHost = {
    plugins: [
      { manifest: { id: "exams", capabilities: ["exams", "studentContext"] }, instance: null },
      { manifest: { id: "homework", capabilities: ["homework"] }, instance: null },
    ],
  };

  const flags = buildFetchFlags(
    { plugins: { exams: { enabled: true }, homework: { enabled: false } } },
    helper._pluginHost,
  );

  assert.equal(flags.fetchExams, true);
  assert.equal(flags.wantsExamsWidget, true);
  assert.equal(flags.fetchHomeworks, false, "disabled plugin must not pull its endpoint");
  assert.equal(flags.wantsHomeworkWidget, false);
});

test("frontendShared exposes the namespaces backing pluginContext", () => {
  const shared = loadFrontendShared();

  // Regression: pluginContext.dom/time/formatting used to be handed to plugins as empty objects
  // while docs/PLUGINS.md documented them as provided.
  const expected = {
    dom: [
      "addFullRow",
      "addHeader",
      "addRow",
      "createContainer",
      "createElement",
      "el",
      "headerTitleNodes",
      "iconSpan",
      "multilineNodes",
      "richTextNodes",
    ],
    time: ["DEFAULT_TIMEZONE", "currentTimeAsHHMM", "getCurrentDateContext", "toMinutesSinceMidnight"],
    formatting: ["formatDisplayDate", "formatDisplayTime", "formatYmd"],
  };

  for (const [namespace, keys] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(shared[namespace]).sort(), keys, `${namespace} namespace mismatch`);

    for (const key of keys) {
      assert.notEqual(shared[namespace][key], undefined, `${namespace}.${key} must be defined`);
    }
  }

  // util keeps exposing everything so existing plugin code stays working.
  assert.equal(typeof shared.util.formatDisplayDate, "function");
  assert.equal(typeof shared.util.resolveWidgetHelpers, "function");
  assert.equal(typeof shared.util.buildHolidayMapFromRanges, "function");
  assert.equal(typeof shared.util.buildDayNoticeMap, "function");
});

test("shared date map builders replace the former per-plugin copies", () => {
  const shared = loadFrontendShared();

  const holidayMap = shared.util.buildHolidayMapFromRanges([
    { startDate: 20260302, endDate: 20260304, name: "Spring" },
  ]);
  assert.deepEqual(Object.keys(holidayMap), ["20260302", "20260303", "20260304"]);
  assert.equal(holidayMap[20260303].name, "Spring");

  // Malformed ranges are skipped rather than throwing or producing endless loops.
  assert.deepEqual(shared.util.buildHolidayMapFromRanges([{ startDate: "x", endDate: 20260304 }]), {});
  assert.deepEqual(shared.util.buildHolidayMapFromRanges([]), {});

  const noticeMap = shared.util.buildDayNoticeMap([{ date: 20260302, text: "a" }, { date: 0 }, {}]);
  assert.deepEqual(Object.keys(noticeMap), ["20260302"]);
});

test("empty-day notices keep translations that equal their key and fall back to English", () => {
  const shared = loadFrontendShared();
  const english = { weekend: "weekend", "no-lessons": "no lessons" };
  const ctx = { translate: (key, _replacements, fallback = key) => english[key] ?? fallback };

  // 2026-10-03 is a Saturday, 2026-10-05 a Monday without lessons.
  assert.equal(shared.util.getEmptyDayState(ctx, "Avery", 20261003).label, "weekend");
  assert.equal(shared.util.getEmptyDayState(ctx, "Avery", 20261005).label, "no lessons");
  assert.equal(
    shared.util.getEmptyDayState({ translate: (_key, _replacements, fallback) => fallback }, "Avery", 20261003).label,
    "weekend",
  );
});

test("findPeriodIndex assigns lessons outside a period to the next one", () => {
  const { findPeriodIndex } = loadFrontendShared().util;
  // 08:00-08:45, 08:50-09:35, 09:45-10:30 (the last one without an explicit end)
  const periods = [{ startMin: 480, endMin: 525 }, { startMin: 530, endMin: 575 }, { startMin: 585 }];

  assert.equal(findPeriodIndex(480, periods), 0, "start of a period");
  assert.equal(findPeriodIndex(540, periods), 1, "inside a period");
  // Regression: a lesson starting in a break matched no period and was hidden by grid.maxLessons.
  assert.equal(findPeriodIndex(527, periods), 1, "in the break before period 2");
  assert.equal(findPeriodIndex(450, periods), 0, "before the first period");
  assert.equal(findPeriodIndex(600, periods), 2, "inside the open-ended last period");
  assert.equal(findPeriodIndex(700, periods), 2, "after the last period");
  assert.equal(findPeriodIndex(500, []), -1, "no periods");
});

test("frontendShared namespace members are callable", () => {
  const shared = loadFrontendShared();

  assert.equal(shared.formatting.formatYmd(20260302), "02.03.2026");
  assert.equal(shared.time.currentTimeAsHHMM(new Date(2026, 0, 1, 13, 50)), 1350);
  assert.equal(shared.time.toMinutesSinceMidnight("13:50"), 830);
  assert.equal(shared.time.DEFAULT_TIMEZONE, "Europe/Berlin");
});

let tracker;
function seedApiStatus() {
  tracker = new ApiStatusTracker({ logger: () => {} });
  return "mirror:session";
}

function failEndpoint(sessionKey, endpoint, status, times = 1) {
  for (let i = 0; i < times; i++) {
    tracker.recordError(sessionKey, endpoint, { status });
  }
}

function ageRecord(sessionKey, endpoint, ms) {
  tracker._bySession.get(sessionKey)[endpoint].recordedAt -= ms;
}

test("shouldSkipApi keeps retrying isolated 5xx blips", () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, "homework", 500, 1);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), false);

  failEndpoint(sessionKey, "homework", 500, 1);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), false, "two failures must not open the breaker");
});

test("shouldSkipApi backs off after repeated 5xx and escalates the window", () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, "homework", 500, 3);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), true, "third failure opens the breaker");

  // Still inside the first 15min window.
  ageRecord(sessionKey, "homework", 10 * 60 * 1000);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), true);

  // Window elapsed - one probe is allowed through.
  ageRecord(sessionKey, "homework", 6 * 60 * 1000);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), false);

  // Probe fails again -> escalate to the 1h step.
  failEndpoint(sessionKey, "homework", 500, 1);
  ageRecord(sessionKey, "homework", 30 * 60 * 1000);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), true, "30min must not clear the 1h step");

  ageRecord(sessionKey, "homework", 31 * 60 * 1000);
  assert.equal(tracker.shouldSkip(sessionKey, "homework"), false);
});

test("getTransientBackoffMs caps the escalation", () => {
  assert.equal(getTransientBackoffMs(2), 0);
  assert.equal(getTransientBackoffMs(3), 15 * 60 * 1000);
  assert.equal(getTransientBackoffMs(4), 60 * 60 * 1000);
  assert.equal(getTransientBackoffMs(5), 6 * 60 * 60 * 1000);
  assert.equal(getTransientBackoffMs(50), 6 * 60 * 60 * 1000, "capped at the last step");
});

test("recordApiStatusFromError counts only consecutive failures", () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, "homework", 500, 2);
  assert.equal(tracker.getRecords(sessionKey).homework.failureCount, 2);

  // A success in between must restart the streak.
  tracker.recordStatus(sessionKey, "homework", 200);
  assert.equal(typeof tracker.getRecords(sessionKey).homework.lastSuccessAt, "number");
  failEndpoint(sessionKey, "homework", 500, 1);
  assert.equal(tracker.getRecords(sessionKey).homework.failureCount, 1);
  assert.equal(
    typeof tracker.getRecords(sessionKey).homework.lastSuccessAt,
    "number",
    "last success survives later failures",
  );
});

test("shouldSkipApi still treats permanent errors as permanent", () => {
  const sessionKey = seedApiStatus();

  // A single 403 skips immediately - no threshold, unlike transient errors.
  failEndpoint(sessionKey, "timetable", 403, 1);
  assert.equal(tracker.shouldSkip(sessionKey, "timetable"), true);

  // ...but is re-probed after the 24h license window.
  ageRecord(sessionKey, "timetable", 25 * 60 * 60 * 1000);
  assert.equal(tracker.shouldSkip(sessionKey, "timetable"), false);
  assert.equal("timetable" in tracker.getRecords(sessionKey), false, "expired record is cleared");
});

test("shouldSkipApi never skips an endpoint whose last call succeeded", () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, "exams", 500, 5);
  assert.equal(tracker.shouldSkip(sessionKey, "exams"), true);

  tracker.recordStatus(sessionKey, "exams", 200);
  assert.equal(tracker.shouldSkip(sessionKey, "exams"), false);
});

test("getCurrentDateContext keeps wall clock time while overriding debug date", () => {
  const now = new Date(Date.UTC(2026, 4, 12, 14, 37, 22, 15));
  const result = runtimeUtils.getCurrentDateContext(
    {
      debugDate: "2026-03-02",
      timezone: "UTC",
    },
    {
      now,
      defaultTimezone: "UTC",
    },
  );

  assert.equal(result.isDebug, true);
  assert.equal(result.ymd, 20260302);
  assert.equal(result.isoDate, "2026-03-02");
  assert.equal(result.date.getHours(), 14);
  assert.equal(result.date.getMinutes(), 37);
  assert.equal(result.date.getSeconds(), 22);
});

/**
 * The configured timezone is the school's, and it has to win over whatever clock the host runs.
 *
 * These cases only bite when `config.timezone` differs from the host zone. `getTimeZoneDate` once
 * computed the conversion via Intl and then cancelled it out again, which made it an identity
 * function - invisible on a UTC host, two hours wrong on the Raspberry Pi the module ships to.
 * Run the suite under `TZ=Europe/Berlin` as well; CI does.
 */
const wallClock = (date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

test("getCurrentDateContext resolves the school wall clock regardless of the host timezone", () => {
  const now = new Date(Date.UTC(2026, 4, 12, 14, 37, 0)); // 16:37 in Berlin (CEST, UTC+2)
  const result = runtimeUtils.getCurrentDateContext(
    { timezone: "Europe/Berlin" },
    { now, defaultTimezone: "Europe/Berlin" },
  );

  assert.equal(wallClock(result.date), "16:37");
  assert.equal(result.ymd, 20260512);
  assert.equal(result.isDebug, false);
});

test("getCurrentDateContext applies the winter offset outside daylight saving time", () => {
  const now = new Date(Date.UTC(2026, 0, 15, 14, 30, 0)); // 15:30 in Berlin (CET, UTC+1)
  const result = runtimeUtils.getCurrentDateContext(
    { timezone: "Europe/Berlin" },
    { now, defaultTimezone: "Europe/Berlin" },
  );

  assert.equal(wallClock(result.date), "15:30");
  assert.equal(result.ymd, 20260115);
});

test("getCurrentDateContext rolls over the day at local midnight, not at UTC midnight", () => {
  const now = new Date(Date.UTC(2026, 7, 14, 22, 30, 0)); // 00:30 on the 15th in Berlin
  const result = runtimeUtils.getCurrentDateContext(
    { timezone: "Europe/Berlin" },
    { now, defaultTimezone: "Europe/Berlin" },
  );

  assert.equal(result.ymd, 20260815, "the timetable must already show the new day");
  assert.equal(result.isoDate, "2026-08-15");
  assert.equal(wallClock(result.date), "00:30");
});

test("getCurrentDateContext honours a timezone behind UTC", () => {
  const now = new Date(Date.UTC(2026, 0, 15, 14, 30, 0)); // 09:30 in New York (EST, UTC-5)
  const result = runtimeUtils.getCurrentDateContext(
    { timezone: "America/New_York" },
    { now, defaultTimezone: "Europe/Berlin" },
  );

  assert.equal(wallClock(result.date), "09:30");
  assert.equal(result.ymd, 20260115);
});

test("getCurrentDateContext keeps the school wall clock when debugDate crosses a DST boundary", () => {
  // Real date is in CEST (UTC+2), the debug date is in CET (UTC+1). The wall clock must survive
  // the jump untouched - only the day changes.
  const now = new Date(Date.UTC(2026, 4, 12, 14, 37, 22, 15));
  const result = runtimeUtils.getCurrentDateContext(
    { debugDate: "2026-03-02", timezone: "Europe/Berlin" },
    { now, defaultTimezone: "Europe/Berlin" },
  );

  assert.equal(result.isDebug, true);
  assert.equal(result.ymd, 20260302);
  assert.equal(wallClock(result.date), "16:37");
  assert.equal(result.date.getSeconds(), 22);
  assert.equal(result.date.getMilliseconds(), 15, "milliseconds survive the Intl round trip");
});

test("_calculateBaseNow uses normalized debug date context", () => {
  const baseNow = calculateBaseNow({ debugDate: "20260302", timezone: "UTC" });

  assert.equal(baseNow.getFullYear(), 2026);
  assert.equal(baseNow.getMonth(), 2);
  assert.equal(baseNow.getDate(), 2);
});

const frontend = loadFrontendModule();

test("_shouldPreserveData keeps stale data while a collection is unavailable, never on ok", () => {
  // No previous data: nothing to preserve, even if the fetch failed.
  assert.equal(frontend._shouldPreserveData([], [], { status: "unavailable" }), false);

  // Previous data + empty result + collection disabled (not fetched) -> preserve.
  assert.equal(frontend._shouldPreserveData([], ["old"], { status: "disabled" }), true);

  // Previous data + empty result + ok -> the class really emptied out, don't preserve.
  assert.equal(frontend._shouldPreserveData([], ["old"], { status: "ok" }), false);

  // Previous data + empty result + unavailable -> preserve.
  assert.equal(frontend._shouldPreserveData([], ["old"], { status: "unavailable", httpStatus: 500 }), true);

  // Fresh data always wins, whatever the state says.
  assert.equal(frontend._shouldPreserveData(["new"], ["old"], { status: "unavailable" }), false);

  // Missing state (should not happen with a synchronous deploy) is treated as ok.
  assert.equal(frontend._shouldPreserveData([], ["old"], undefined), false);
});

test("_processPayloadData flags a collection unavailable and keeps stale data on later failures", () => {
  frontend.timeUnitsByStudent = {};
  frontend.timetableByStudent = {};
  frontend.dayNoticesByStudent = {};
  frontend.dayNoticeMapByStudent = {};
  frontend.periodNamesByStudent = {};
  frontend.preprocessedByStudent = {};
  frontend.examsByStudent = {};
  frontend.homeworksByStudent = {};
  frontend.absencesByStudent = {};
  frontend.messagesOfDayByStudent = {};
  frontend.holidaysByStudent = {};
  frontend.holidayMapByStudent = {};
  frontend.collectionStateByStudent = {};
  frontend._log = () => {};
  frontend._buildDayNoticeMap = () => ({});
  frontend._buildHolidayMapFromRanges = () => ({});
  frontend._toMinutes = () => 0;

  const failed = { status: "unavailable", httpStatus: 401, lastSuccessAt: null };
  const ok = { status: "ok", httpStatus: 200, lastSuccessAt: "2026-09-18T10:00:00.000Z" };
  const collections = (lessons) => ({
    lessons,
    exams: ok,
    homework: ok,
    absences: ok,
    messages: { status: "disabled" },
  });

  // First payload fails: nothing to show, collection flagged unavailable (not stale).
  frontend._processPayloadData("A", { data: { lessons: [] }, state: { collections: collections(failed) } });
  assert.deepEqual(frontend.timetableByStudent.A, []);
  assert.equal(frontend.collectionStateByStudent.A.lessons.status, "unavailable");
  assert.equal(frontend.collectionStateByStudent.A.lessons.stale, false);

  // Then data arrives.
  frontend._processPayloadData("A", {
    data: { lessons: [{ date: 20260918, startTime: 800 }] },
    state: { collections: collections(ok) },
  });
  assert.equal(frontend.timetableByStudent.A.length, 1);
  assert.equal(frontend.collectionStateByStudent.A.lessons.status, "ok");

  // A later failure keeps the old lessons and marks them stale.
  frontend._processPayloadData("A", { data: { lessons: [] }, state: { collections: collections(failed) } });
  assert.equal(frontend.timetableByStudent.A.length, 1);
  assert.equal(frontend.collectionStateByStudent.A.lessons.status, "unavailable");
  assert.equal(frontend.collectionStateByStudent.A.lessons.stale, true);

  // A confirmed empty result replaces them.
  frontend._processPayloadData("A", { data: { lessons: [] }, state: { collections: collections(ok) } });
  assert.deepEqual(frontend.timetableByStudent.A, []);
});

test("_normalizeRuntimeWarnings drops recovered no_data warnings but keeps config warnings", () => {
  const warningsList = ["no lessons found", "bad config value", "generic api warning"];
  const warningMeta = [
    { message: "no lessons found", kind: "no_data", dataType: "lessons" },
    { message: "bad config value", kind: "config" },
  ];

  // Lessons data has since recovered -> the no_data warning is dropped; config warning always stays;
  // the untagged warning falls back to API-health, and no APIs were reported fetched -> kept.
  const recovered = frontend._normalizeRuntimeWarnings(warningsList, {
    effectiveData: { lessons: [{ id: 1 }] },
    warningMeta,
  });
  assert.deepEqual(recovered, ["bad config value", "generic api warning"]);

  // All fetched APIs are healthy -> the untagged generic warning is dropped too.
  const healthy = frontend._normalizeRuntimeWarnings(warningsList, {
    effectiveData: { lessons: [] },
    warningMeta,
    apiStatus: { timetable: 200 },
    fetchFlags: { timetable: true },
  });
  assert.deepEqual(healthy, ["no lessons found", "bad config value"]);
});

test("_getDisplayWidgets resolves the legacy displayMode string into canonical widget ids", () => {
  frontend.config = { displayMode: "homework, absences" };
  frontend.defaults = { displayMode: "lessons, exams" };
  frontend._pluginRegistryById = null;

  assert.deepEqual(frontend._getDisplayWidgets(), ["homework", "absences"]);
});

test('_getDisplayWidgets treats the "list" alias as lessons+exams', () => {
  frontend.config = { displayMode: "list" };
  frontend.defaults = { displayMode: "lessons, exams" };
  frontend._pluginRegistryById = null;

  assert.deepEqual(frontend._getDisplayWidgets(), ["lessons", "exams"]);
});

// ---------------------------------------------------------------------------
// Session handling: shared credentials, login redirects, expired-session bodies
// ---------------------------------------------------------------------------

function withStubbedFetch(handler, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => handler(String(url), options);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = originalFetch;
    });
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("_getCredentialKey is the same for every session and instance using the same account", () => {
  const parent = { username: "parent", password: "x", school: "school", server: "srv.webuntis.com" };
  const student = { title: "A", studentId: 1 };
  const keyA = getCredentialKey(student, { ...parent, carouselId: "wu1" });
  const keyB = getCredentialKey(student, { ...parent, carouselId: "wu2" });
  assert.equal(keyA, keyB);
  assert.equal(keyA, "parent:parent@srv.webuntis.com/school");
  assert.equal(getCredentialKey({ qrcode: "untis://x" }, parent), "qrcode:untis://x");
  assert.equal(getCredentialKey(student, { ...parent, qrcode: "untis://p" }), "qrcode:untis://p");
});

test("_extractHttpStatus never records a rejected login or expired session as success", () => {
  const loginRejected = Object.assign(new Error("bad credentials"), {
    code: "AUTH_FAILED",
    isAuthError: true,
    httpStatus: 200,
  });
  const redirected = Object.assign(new Error("login page"), {
    code: "SESSION_EXPIRED",
    isAuthError: true,
    status: 302,
  });
  assert.equal(extractHttpStatus(loginRejected), 401);
  assert.equal(extractHttpStatus(redirected), 401);
  assert.equal(extractHttpStatus(Object.assign(new Error("x"), { status: 503 })), 503);
  assert.equal(extractHttpStatus(new Error("no status")), 0);

  const meta = warningUtils.classifyWarningMetaFromError(loginRejected);
  assert.equal(meta.kind, "auth");
  assert.equal(meta.severity, "critical");
});

test("convertRestErrorToWarning produces a warning for login failures reported inside a 200 body", () => {
  const { convertRestErrorToWarning } = require("../lib/webuntis/errorHandler");
  const loginRejected = Object.assign(new Error("Credentials authentication failed: 200 - bad credentials"), {
    code: "AUTH_FAILED",
    isAuthError: true,
    httpStatus: 200,
  });
  const text = convertRestErrorToWarning(loginRejected, { studentTitle: "A", dataType: "timetable" });
  assert.match(text, /Authentication failed while fetching timetable for "A"/);

  const expired = Object.assign(new Error("login page"), { code: "SESSION_EXPIRED", isAuthError: true, status: 302 });
  assert.match(convertRestErrorToWarning(expired, { studentTitle: "A" }), /session expired/);

  const invalid = Object.assign(new Error("timetable response has no days[]"), { code: "INVALID_RESPONSE" });
  assert.match(convertRestErrorToWarning(invalid, { studentTitle: "A", dataType: "timetable" }), /unusable response/);
});

test("fetchClient surfaces the WebUntis login redirect as SESSION_EXPIRED instead of following it", async () => {
  const fetchClient = require("../lib/webuntis/fetchClient");
  await withStubbedFetch(
    (_url, options) => {
      assert.equal(options.redirect, "manual");
      return new Response(null, { status: 302, headers: { location: "https://srv/WebUntis/index.do" } });
    },
    async () => {
      await assert.rejects(fetchClient.request({ url: "https://srv/WebUntis/api/exams" }), (err) => {
        assert.equal(err.code, "SESSION_EXPIRED");
        assert.equal(err.isAuthError, true);
        assert.equal(err.status, 302);
        return true;
      });
      await assert.rejects(
        fetchClient.get("https://srv/WebUntis/api/token/new"),
        (err) => err.code === "SESSION_EXPIRED",
      );
    },
  );

  await withStubbedFetch(
    () => new Response("<html>maintenance</html>", { status: 503, headers: { "content-type": "text/html" } }),
    async () => {
      await assert.rejects(fetchClient.request({ url: "https://srv/x" }), (err) => {
        assert.equal(err.status, 503);
        assert.equal(err.body, "<html>maintenance</html>");
        return true;
      });
    },
  );
});

test("restClient treats a 200 login-state or HTML body as an expired session", async () => {
  const restClient = require("../lib/webuntis/restClient");
  const base = { server: "srv", path: "/WebUntis/api/exams", token: "t", cookies: "JSESSIONID=x" };

  await withStubbedFetch(
    () => jsonResponse({ loginError: "", state: "LOGIN_ERROR" }),
    () =>
      assert.rejects(restClient.callRestAPI(base), (err) => err.code === "SESSION_EXPIRED" && err.isAuthError === true),
  );
  await withStubbedFetch(
    () => new Response("<!DOCTYPE html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    () => assert.rejects(restClient.callRestAPI(base), (err) => err.code === "SESSION_EXPIRED"),
  );
  await withStubbedFetch(
    () => jsonResponse({ data: { exams: [] } }),
    async () => {
      const result = await restClient.callRestAPI(base);
      assert.deepEqual(result, { data: { data: { exams: [] } }, status: 200 });
    },
  );
});

test("getTimetable rejects a 200 body without days[] and retries once after an auth error", async () => {
  const api = require("../lib/webuntis/webuntisApiService");
  const range = { rangeStart: new Date("2026-09-18"), rangeEnd: new Date("2026-09-19") };
  const auth = { token: "t", cookieString: "JSESSIONID=x", tenantId: 1, schoolYearId: 1 };

  await withStubbedFetch(
    () => jsonResponse({}),
    () =>
      assert.rejects(
        api.getTimetable({ authContext: { getAuth: async () => auth }, server: "srv", personId: 1, ...range }),
        (err) => err.code === "INVALID_RESPONSE",
      ),
  );

  let calls = 0;
  let authErrors = 0;
  await withStubbedFetch(
    () => {
      calls += 1;
      if (calls === 1) return jsonResponse({ errorCode: "UNAUTHORIZED" }, 401);
      return jsonResponse({ days: [{ date: "2026-09-18", status: "NO_DATA", gridEntries: [] }] });
    },
    async () => {
      const result = await api.getTimetable({
        authContext: {
          getAuth: async () => auth,
          onAuthError: async () => {
            authErrors += 1;
          },
        },
        server: "srv",
        personId: 1,
        ...range,
      });
      assert.equal(authErrors, 1);
      assert.equal(calls, 2);
      assert.equal(result.status, 200);
      assert.equal(result.data.length, 0);
      assert.deepEqual(result.data.dayNotices, [{ date: "2026-09-18", kind: "no-data", status: "NO_DATA" }]);
    },
  );
});

test("instances with the same account reuse a fresh response instead of fetching again", async () => {
  const api = require("../lib/webuntis/webuntisApiService");
  const { createResponseCache, maxAgeFor } = require("../lib/webuntis/responseCache");
  const range = { rangeStart: new Date("2026-09-18"), rangeEnd: new Date("2026-09-19") };
  const auth = { token: "t", cookieString: "JSESSIONID=x", tenantId: 1, schoolYearId: 1 };
  let clock = 0;
  const store = createResponseCache({ now: () => clock });
  const contextFor = (scope, maxAgeMs = 60_000) => ({
    getAuth: async () => auth,
    responseCache: { store, scope, maxAgeMs },
  });

  let calls = 0;
  let fail = false;
  await withStubbedFetch(
    () => {
      calls += 1;
      if (fail) return jsonResponse({ errorCode: "SERVER" }, 500);
      return jsonResponse({ days: [{ date: "2026-09-18", status: "REGULAR", gridEntries: [] }] });
    },
    async () => {
      const fetchAs = (scope, personId = 1, maxAgeMs) =>
        api.getTimetable({ authContext: contextFor(scope, maxAgeMs), server: "srv", personId, ...range });

      await fetchAs("parent:a@srv/school");
      const reused = await fetchAs("parent:a@srv/school");
      assert.equal(calls, 1, "the second instance of the account is served from the cache");
      assert.equal(reused.status, 200);

      await fetchAs("parent:a@srv/school", 2);
      assert.equal(calls, 2, "another student is another request");
      await fetchAs("parent:b@srv/school");
      assert.equal(calls, 3, "another account never shares an entry");

      clock += 30_000;
      await fetchAs("parent:a@srv/school", 1, 20_000);
      assert.equal(calls, 4, "a caller with a shorter maximum age fetches again");

      clock += 60_000;
      fail = true;
      await assert.rejects(fetchAs("parent:a@srv/school"));
      await assert.rejects(fetchAs("parent:a@srv/school"));
      assert.ok(calls > 5, "a failed response is not cached");
    },
  );

  assert.equal(maxAgeFor({ updateInterval: 5 * 60 * 1000 }), 4 * 60 * 1000);
  assert.equal(maxAgeFor({ updateInterval: 60 * 1000 }), 48 * 1000, "80% of a short interval");
  assert.equal(maxAgeFor({ updateInterval: 60 * 60 * 1000 }), 4 * 60 * 1000, "capped");
  assert.equal(maxAgeFor({}), 0);
});

test("AuthService.logoutAll logs every cached session out and clears the cache", async () => {
  const AuthService = require("../lib/webuntis/authService");
  const service = new AuthService({ logger: () => {} });
  const loggedOut = [];
  service.httpClient.logout = async (server, school, cookies) => {
    loggedOut.push(`${school}@${server}:${cookies}`);
  };
  service._authCache.set("parent:a@srv/school", {
    server: "srv",
    school: "school",
    cookieString: "JSESSIONID=1",
    expiresAt: Date.now() + 60000,
  });
  service._authCache.set("qrcode:x", {
    server: "srv",
    school: "school",
    cookieString: "JSESSIONID=2",
    expiresAt: Date.now() + 60000,
  });
  service._authCache.set("broken", { expiresAt: Date.now() });

  const count = await service.logoutAll();
  assert.equal(count, 2);
  assert.deepEqual(loggedOut.sort(), ["school@srv:JSESSIONID=1", "school@srv:JSESSIONID=2"]);
  assert.equal(service._authCache.size, 0);
});

test('getEmptyDayState reports "unavailable" only when the lessons collection failed without stale data', () => {
  const getEmptyDayState = loadFrontendShared().util.getEmptyDayState;
  const monday = new Date(2026, 8, 21); // 2026-09-21, a Monday
  const baseCtx = { translate: (key) => key, holidayMapByStudent: {}, dayNoticeMapByStudent: {} };

  assert.equal(getEmptyDayState(baseCtx, "A", monday).type, "no-lessons");

  const unavailableCtx = {
    ...baseCtx,
    collectionStateByStudent: { A: { lessons: { status: "unavailable", stale: false } } },
  };
  const state = getEmptyDayState(unavailableCtx, "A", monday);
  assert.equal(state.type, "unavailable");
  assert.equal(state.noticeType, "unavailable");

  // Stale data on display: days without lessons in that data are still "no lessons".
  const staleCtx = { ...baseCtx, collectionStateByStudent: { A: { lessons: { status: "unavailable", stale: true } } } };
  assert.equal(getEmptyDayState(staleCtx, "A", monday).type, "no-lessons");

  // Weekend, holiday and locked days keep their meaning even when data is unavailable.
  assert.equal(getEmptyDayState(unavailableCtx, "A", new Date(2026, 8, 19)).type, "weekend");
  const lockedCtx = {
    ...unavailableCtx,
    dayNoticeMapByStudent: { A: { 20260921: { kind: "timetable-restricted", status: "NOT_ALLOWED" } } },
  };
  assert.equal(getEmptyDayState(lockedCtx, "A", monday).type, "timetable-restricted");

  // WebUntis' NO_DATA marks a server-confirmed lesson-free day.
  const noDataCtx = { ...baseCtx, dayNoticeMapByStudent: { A: { 20260921: { kind: "no-data", status: "NO_DATA" } } } };
  const confirmed = getEmptyDayState(noDataCtx, "A", monday);
  assert.equal(confirmed.type, "no-lessons");
  assert.equal(confirmed.confirmed, true);
});

test("AuthService logs exactly one info line per real login and one per invalidation", async () => {
  const { AuthService } = require("../lib/webuntisClient");
  const lines = [];
  const service = new AuthService({ logger: (level, message) => lines.push({ level, message }) });

  const cacheKey = "test:rest";
  const authResult = {
    token: "t",
    cookieString: "c",
    tenantId: 1,
    schoolYearId: 2,
    personId: 3,
    role: "STUDENT",
    appData: {},
  };
  service._performAuth = async () => {
    service._authCache.set(cacheKey, {
      ...authResult,
      school: "s",
      server: "srv",
      expiresAt: Date.now() + 14 * 60 * 1000,
      lastCookieValidation: Date.now(),
    });
    return authResult;
  };

  const infoLines = () => lines.filter((entry) => entry.level === "info").map((entry) => entry.message);
  const credentials = { school: "s", username: "u", password: "p", server: "srv", options: { cacheKey } };

  await service.getAuth(credentials);
  assert.equal(infoLines().length, 1);
  assert.match(infoLines()[0], /REST auth: .*logging in/);

  // Cache hit: no second login, and therefore no second info line.
  await service.getAuth(credentials);
  assert.equal(infoLines().length, 1);

  assert.equal(service.invalidateCache(cacheKey), true);
  assert.equal(infoLines().length, 2);
  assert.match(infoLines()[1], /Invalidating expired token cache/);

  // Invalidating an unknown key is a no-op and stays silent at info level.
  assert.equal(service.invalidateCache("unknown"), false);
  assert.equal(infoLines().length, 2);
});

test("a request that hits its own timeout raises an error coded ETIMEDOUT", async () => {
  const fetchClient = require("../lib/webuntis/fetchClient");
  const { convertRestErrorToWarning } = require("../lib/webuntis/errorHandler");
  const { isNetworkError } = warningUtils;

  const previousFetch = global.fetch;
  global.fetch = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const abortError = new Error("This operation was aborted");
        abortError.name = "AbortError";
        reject(abortError);
      });
    });

  try {
    const err = await fetchClient.get("https://example.invalid", { timeout: 5 }).then(
      () => null,
      (error) => error,
    );

    assert.equal(err.code, "ETIMEDOUT");
    assert.equal(err.cause.name, "AbortError");
    assert.equal(isNetworkError(err), true);
    assert.match(convertRestErrorToWarning(err, { studentTitle: "A", server: "srv" }), /timeout/i);
    assert.deepEqual(warningUtils.classifyWarningMetaFromError(err), {
      kind: "network",
      severity: "critical",
      status: null,
      code: "ETIMEDOUT",
    });
  } finally {
    global.fetch = previousFetch;
  }
});

test("a cached login lives until the token's exp, not a fixed 14 minutes", () => {
  const { AuthService } = require("../lib/webuntisClient");
  const service = new AuthService({ logger: () => {} });
  const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString("base64")}.s`;

  const exp = Math.floor(Date.now() / 1000) + 3 * 60 * 60;
  assert.equal(service._tokenExpiresAt(jwt({ exp })), exp * 1000);

  // No usable exp: the assumed lifetime applies.
  for (const token of [jwt({ person_id: 1 }), "not-a-jwt", null]) {
    const expiresAt = service._tokenExpiresAt(token);
    assert.ok(Math.abs(expiresAt - (Date.now() + 14 * 60 * 1000)) < 1000);
  }

  service._cacheAuthResult("key", { token: jwt({ exp }) });
  assert.equal(service._authCache.get("key").expiresAt, exp * 1000);
});

test("a token with more than the safety buffer left is reused, one about to expire is not", async () => {
  const { AuthService } = require("../lib/webuntisClient");
  const service = new AuthService({ logger: () => {} });
  const cacheKey = "test:rest";
  const entry = {
    token: "t",
    cookieString: "c",
    tenantId: 1,
    schoolYearId: 2,
    personId: 3,
    school: "s",
    server: "srv",
    appData: {},
  };
  let logins = 0;
  service._performAuth = async () => {
    logins += 1;
    return entry;
  };
  const getAuth = () =>
    service.getAuth({ username: "u", password: "p", school: "s", server: "srv", options: { cacheKey } });

  // Five minutes left: the old 5-minute buffer forced a login here, every second fetch.
  service._authCache.set(cacheKey, { ...entry, expiresAt: Date.now() + 5 * 60 * 1000 });
  await getAuth();
  assert.equal(logins, 0);

  service._authCache.set(cacheKey, { ...entry, expiresAt: Date.now() + 30 * 1000 });
  await getAuth();
  assert.equal(logins, 1);
});

test("an empty REST target list surfaces its diagnosis as a config warning", () => {
  const { WebUntisClient } = require("../lib/webuntisClient");
  const client = new WebUntisClient({ mmLog: () => {} });

  // Parent credentials without studentId: the classic cause of an empty target list.
  const message = client._logEmptyTargets(
    { title: "A" },
    { username: "parent", password: "pw" },
    { user: { students: [] } },
  );
  assert.match(message, /No REST targets built/);
  assert.match(message, /student\.studentId is missing/);

  const collector = warningUtils.createWarningCollector();
  collector.addWarning(message, { kind: "config", severity: "warning" });
  const payload = { state: {} };
  collector.flushToPayload(payload);

  assert.deepEqual(payload.state.warnings, [message]);
  assert.equal(payload.state.warningMeta[0].kind, "config");
  assert.equal(payload.state.warningMeta[0].severity, "warning");
});

test("CONFIGURE carries the full config with the identifier and no session id", () => {
  const sent = [];
  frontend.identifier = "module_1_MMM-Webuntis";
  frontend._log = () => {};
  frontend._isDemoModeEnabled = () => false;
  frontend.defaults = { backgroundRefresh: true, debugDate: null };
  frontend.config = { username: "parent", password: "secret", students: [{ title: "A" }] };
  frontend.transport = { sendRequest: (action, data) => sent.push({ action, data }) };

  frontend._sendConfigure();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].action, "CONFIGURE");
  const { config } = sent[0].data;
  assert.equal(config.id, "module_1_MMM-Webuntis");
  assert.equal(config.password, "secret");
  assert.deepEqual(config.students, [{ title: "A" }]);
  assert.equal("sessionId" in config, false);
});

test("INIT_REQUIRED for every instance ('*') sends CONFIGURE once and reports the session state", () => {
  const sent = [];
  const reports = [];
  frontend.identifier = "module_1_MMM-Webuntis";
  frontend.notifications = { EVENT: "MMM-Webuntis_EVENT" };
  frontend._log = () => {};
  frontend.lifecycle = { reportSessionState: (reason) => reports.push(reason) };
  frontend._sendConfigure = () => sent.push("CONFIGURE");

  frontend.socketNotificationReceived("MMM-Webuntis_EVENT", { action: "INIT_REQUIRED", identifier: "*" });
  frontend.socketNotificationReceived("MMM-Webuntis_EVENT", {
    action: "INIT_REQUIRED",
    identifier: frontend.identifier,
  });
  frontend.socketNotificationReceived("MMM-Webuntis_EVENT", { action: "INIT_REQUIRED", identifier: "other" });

  assert.deepEqual(sent, ["CONFIGURE", "CONFIGURE"]);
  assert.deepEqual(reports, ["init-required", "init-required"]);
});

test("DATA with two students applies both and renders once", () => {
  const view = loadFrontendModule();
  view._log = () => {};
  const applied = [];
  let renders = 0;
  view._handleGotData = (payload) => {
    applied.push(payload.context.student.title);
    return true;
  };
  view._updateRuntimeWarnings = () => false;
  view.lifecycle = { render: () => renders++ };

  view._handleData({ students: [{ context: { student: { title: "A" } } }, { context: { student: { title: "B" } } }] });

  assert.deepEqual(applied, ["A", "B"]);
  assert.equal(renders, 1);
});

test("DATA without any change does not render, and its module warnings replace the old ones", () => {
  const view = loadFrontendModule();
  view._log = () => {};
  view.runtimeWarningsByStudent = { __module__: new Set(["discovery failed"]) };
  let renders = 0;
  view.lifecycle = { render: () => renders++ };

  view._handleData({ students: [], warnings: ["discovery failed"] });
  assert.equal(renders, 0);

  view._handleData({ students: [], warnings: [] });
  assert.equal(renders, 1);
  assert.deepEqual(view._getRuntimeWarnings(), []);
});

test("CONFIG_INVALID shows every validation error as a critical warning", () => {
  const view = loadFrontendModule();
  view._log = () => {};
  view.lifecycle = { render() {} };
  view.moduleWarningsSet = new Set();
  view.moduleWarningMetaByMessage = new Map();

  view._handleConfigInvalid({ message: "a\nb", details: { errors: ["a", "b"], warnings: ["w"] } });

  assert.deepEqual([...view.moduleWarningsSet], ["a", "b", "w"]);
  assert.equal(view._isCriticalModuleWarning("a"), true);
  assert.equal(view._isCriticalModuleWarning("w"), false);

  const split = loadFrontendModule();
  split._log = () => {};
  split.lifecycle = { render() {} };
  split._handleConfigInvalid({ message: "x\ny" });
  assert.deepEqual([...split.moduleWarningsSet], ["x", "y"]);
});

test("the visible tick renders when the day changed, and the backend owns the fetch schedule", () => {
  const view = loadFrontendModule();
  let options;
  let renders = 0;
  view.shared = {
    createLifecycle: (given) => {
      options = given;
      return { render: () => renders++ };
    },
  };
  view.config = {};
  view._log = () => {};
  view.getCurrentDateContext = () => ({ ymd: 20261001, isDebug: false });
  view._currentTodayYmd = 20260930;

  view._createLifecycle();

  assert.equal(options.updateInterval, 0);
  assert.equal("onFetch" in options, false);
  assert.equal(options.visibleTickInterval, 60 * 1000);
  options.onVisibleTick();
  assert.equal(view._currentTodayYmd, 20261001);
  assert.equal(renders, 1);
  options.onVisibleTick();
  assert.equal(renders, 1, "no render without a day change");
});

// ---------------------------------------------------------------------------------------------
// excludeLessons / addLessons (issue #91)
// ---------------------------------------------------------------------------------------------

const lessonAdjustments = require("../lib/mmm-adapter/lessonAdjustments");
const { mapBundleToMmmPayload } = require("../lib/mmm-adapter/mmmPayloadMapper");
const { validateConfig } = require("../lib/configValidator");

const makeLesson = (subject, extra = {}) => ({
  date: 20260922,
  startTime: 800,
  endTime: 845,
  subjects: [{ name: subject.slice(0, 3), longname: subject }],
  studentGroups: [],
  lessonText: "",
  ...extra,
});

test("filterExcludedLessons matches substrings case-insensitively and /regex/ entries", () => {
  const lessons = [
    makeLesson("Mathematik"),
    makeLesson("Förderunterricht"),
    makeLesson("AG Chor"),
    makeLesson("AG"),
    makeLesson("Deutsch", { lessonText: "Förderstunde Lesen" }),
    makeLesson("Englisch", { studentGroups: [{ name: "E_Förd", longname: "Englisch Förder" }] }),
  ];

  const bySubstring = lessonAdjustments.filterExcludedLessons(lessons, ["förder"]);
  assert.deepEqual(
    bySubstring.map((l) => l.subjects[0].longname),
    ["Mathematik", "AG Chor", "AG"],
  );

  const byRegex = lessonAdjustments.filterExcludedLessons(lessons, ["/^ag$/i"]);
  assert.deepEqual(
    byRegex.map((l) => l.subjects[0].longname),
    ["Mathematik", "Förderunterricht", "AG Chor", "Deutsch", "Englisch"],
  );

  assert.equal(lessonAdjustments.filterExcludedLessons(lessons, ["", 42, "/[/"]).length, lessons.length);
});

test("buildCustomLessons expands weekdays inside the range and respects from/until and holidays", () => {
  // 2026-09-21 is a Monday
  const lessons = lessonAdjustments.buildCustomLessons(
    [
      { weekday: "tue", startTime: "15:30", endTime: "16:15", subject: "Geige", room: "Musikschule" },
      { weekday: ["mo", 4], startTime: "16:00", endTime: "17:00", subject: "Fußball", from: "2026-09-24" },
      {
        date: "2026-09-23",
        startTime: "14:00",
        endTime: "15:00",
        subject: "Nachhilfe",
        teacher: "Hr. Maier",
        text: "Mathe",
      },
      { weekday: "fri", startTime: "14:00", endTime: "15:00", subject: "Schwimmen" },
      { weekday: "fri", startTime: "14:00", endTime: "15:00", subject: "Chor", showInHolidays: true },
      { date: "2026-12-01", startTime: "14:00", endTime: "15:00", subject: "Out of range" },
      { weekday: "xyz", startTime: "14:00", endTime: "15:00", subject: "Invalid" },
    ],
    {
      startYmd: 20260921,
      endYmd: 20261004,
      holidays: [{ startDate: 20260925, endDate: 20260925 }],
    },
  );

  const summary = lessons.map((l) => `${l.date} ${l.startTime} ${l.subjects[0].longname}`);
  assert.deepEqual(summary, [
    "20260922 1530 Geige",
    "20260929 1530 Geige",
    "20260924 1600 Fußball",
    "20260928 1600 Fußball",
    "20261001 1600 Fußball",
    "20260923 1400 Nachhilfe",
    "20261002 1400 Schwimmen",
    "20260925 1400 Chor",
    "20261002 1400 Chor",
  ]);

  const nachhilfe = lessons.find((l) => l.subjects[0].longname === "Nachhilfe");
  assert.deepEqual(nachhilfe.teachers, [{ name: "Hr. Maier", longname: "Hr. Maier" }]);
  assert.equal(nachhilfe.lessonText, "Mathe");
  assert.equal(nachhilfe.status, "REGULAR");
  assert.equal(nachhilfe.id, "custom-2-20260923");
});

test("validateConfig warns about invalid excludeLessons/addLessons entries without failing", () => {
  const result = validateConfig({
    username: "u",
    password: "p",
    school: "s",
    server: "x.webuntis.com",
    excludeLessons: ["AG", "/[/"],
    addLessons: [
      { weekday: "tue", startTime: "15:30", endTime: "16:15", subject: "Geige" },
      { weekday: "tue", date: "2026-09-22", startTime: "15:30", endTime: "16:15", subject: "Both" },
      { weekday: "tue", startTime: "16:30", endTime: "16:15", subject: "Backwards" },
    ],
    students: [{ title: "A", addLessons: "nope" }],
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, [
    'excludeLessons[1]: must be a non-empty string or a valid "/regex/" – entry ignored',
    'addLessons[1]: needs either "weekday" or "date" – entry ignored',
    'addLessons[2]: "endTime" must be after "startTime" – entry ignored',
    "students[0].addLessons must be an array of lesson objects – option ignored",
  ]);
});

test("DATA_UPDATE payload applies excludeLessons and addLessons (student overrides module)", () => {
  const bundle = (student) => ({
    identifier: "mod1",
    sessionKey: "mod1:sess1",
    student,
    config: { excludeLessons: ["Förder"], addLessons: [] },
    compactHolidays: [],
    coreData: {
      dateRanges: { timetable: { start: new Date(2026, 8, 21), end: new Date(2026, 8, 25) } },
      todayYmd: 20260921,
      activeHoliday: null,
      fetchFlags: { fetchTimetable: true },
      apiStatus: { timetable: 200 },
      apiRecords: {},
      configWarnings: [],
      data: {
        grid: [],
        timetable: [
          { ...makeLesson("Förderunterricht"), id: 1, startTime: 1000 },
          { ...makeLesson("Mathematik"), id: 2, startTime: 800 },
        ],
        rawExams: [],
        hwResult: [],
        rawAbsences: [],
        rawMessagesOfDay: [],
      },
    },
  });

  const moduleLevel = mapBundleToMmmPayload(bundle({ title: "A" }), { mmLog: () => {} });
  assert.deepEqual(
    moduleLevel.data.lessons.map((l) => l.subjects[0].longname),
    ["Mathematik"],
  );

  const studentLevel = mapBundleToMmmPayload(
    bundle({
      title: "B",
      excludeLessons: [],
      addLessons: [{ weekday: "mon", startTime: "07:00", endTime: "07:45", subject: "Frühsport" }],
    }),
    { mmLog: () => {} },
  );
  assert.deepEqual(
    studentLevel.data.lessons.map((l) => `${l.date} ${l.startTime} ${l.subjects[0].longname}`),
    ["20260921 700 Frühsport", "20260922 800 Mathematik", "20260922 1000 Förderunterricht"],
  );
});

test("excludeLessons also hides homework and exams of the excluded subjects", () => {
  const payload = mapBundleToMmmPayload(
    {
      identifier: "mod1",
      sessionKey: "mod1:sess1",
      student: { title: "A" },
      config: { excludeLessons: ["Förder"] },
      compactHolidays: [],
      coreData: {
        dateRanges: { timetable: { start: new Date(2026, 8, 21), end: new Date(2026, 8, 25) } },
        todayYmd: 20260921,
        activeHoliday: null,
        fetchFlags: { fetchTimetable: true, fetchExams: true, fetchHomeworks: true },
        apiStatus: {},
        apiRecords: {},
        configWarnings: [],
        data: {
          grid: [],
          timetable: [],
          rawExams: [
            { examDate: 20260923, subject: "Förderunterricht", name: "Test" },
            { examDate: 20260924, subject: "Mathematik", name: "Klassenarbeit" },
          ],
          hwResult: [
            { id: 1, dueDate: 20260923, subject: { name: "FÖ", longname: "Förderunterricht" }, text: "Blatt 1" },
            { id: 2, dueDate: 20260923, subject: { name: "M", longname: "Mathematik" }, text: "S. 12" },
          ],
          rawAbsences: [],
          rawMessagesOfDay: [],
        },
      },
    },
    { mmLog: () => {} },
  );

  assert.deepEqual(
    payload.data.exams.map((e) => e.subject),
    ["Mathematik"],
  );
  assert.deepEqual(
    payload.data.homework.map((h) => h.subject.longname),
    ["Mathematik"],
  );
});

test("addLessons stops before the exclusive timetable end date", () => {
  const payload = mapBundleToMmmPayload(
    {
      identifier: "mod1",
      sessionKey: "mod1:sess1",
      student: { title: "A", addLessons: [{ weekday: [1, 5], startTime: "15:00", endTime: "16:00", subject: "Chor" }] },
      config: {},
      compactHolidays: [],
      coreData: {
        // Mon 2026-09-21 .. Fri 2026-09-25 exclusive (the API end date is exclusive)
        dateRanges: { timetable: { start: new Date(2026, 8, 21), end: new Date(2026, 8, 25) } },
        todayYmd: 20260921,
        activeHoliday: null,
        fetchFlags: { fetchTimetable: true },
        apiStatus: {},
        apiRecords: {},
        configWarnings: [],
        data: { grid: [], timetable: [], rawExams: [], hwResult: [], rawAbsences: [], rawMessagesOfDay: [] },
      },
    },
    { mmLog: () => {} },
  );

  assert.deepEqual(
    payload.data.lessons.map((l) => l.date),
    [20260921],
  );
});

test("validateConfig rejects addLessons entries whose from date is after until", () => {
  const { warnings } = validateConfig({
    username: "u",
    password: "p",
    school: "s",
    server: "x.webuntis.com",
    addLessons: [
      {
        weekday: "mon",
        startTime: "15:00",
        endTime: "16:00",
        subject: "Chor",
        from: "2026-10-01",
        until: "2026-09-01",
      },
    ],
  });
  assert.deepEqual(warnings, ['addLessons[0]: "from" must not be after "until" – entry ignored']);
});

test("demo mode does not ask for students or credentials", () => {
  const warned = [];
  const demo = loadFrontendModule();
  demo._log = () => {};
  demo._upsertModuleWarnings = (warnings) => warned.push(...warnings);

  demo.config = { demoDataFile: "demo/fixtures/single-student-week.json" };
  demo._validateAndWarnConfig({ students: [] });
  assert.deepEqual(warned, []);

  demo.config = {};
  demo._validateAndWarnConfig({ students: [] });
  assert.match(warned[0], /No students configured/);
});

test("demo mode serves the fixtures through CONFIGURE and DATA without logging in", async () => {
  const demoHelper = loadNodeHelper();
  demoHelper._mmLog = () => {};
  const emitted = [];
  demoHelper.sendSocketNotification = (_name, payload) => emitted.push(payload);

  try {
    demoHelper.socketNotificationReceived("MMM-Webuntis_REQUEST", {
      action: "CONFIGURE",
      identifier: "demo-module",
      requestId: "r1",
      data: {
        config: {
          id: "demo-module",
          demoDataFile: "demo/fixtures/single-student-week.json",
          debugDate: "2026-09-30",
          mode: "compact",
          displayMode: "grid",
          grid: { weekView: true },
          students: [],
        },
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.deepEqual(
      emitted.map((event) => event.action),
      ["CONFIGURED", "DATA"],
    );
    assert.equal(
      emitted[0].data.plugins.some((plugin) => plugin.id === "grid"),
      true,
    );
    const { students, allFailed } = emitted[1].data;
    assert.equal(allFailed, false);
    assert.equal(students.length, 1);
    const avery = students[0];
    assert.equal(avery.context.student.title, "Avery Finch");
    assert.equal(avery.context.config.mode, "compact", "module config reaches the widgets");
    assert.equal(avery.context.config.debugDate, "2026-09-30");
    assert.equal(avery.context.config.plugins.grid.config.weekView, true);
    assert.equal("__initWarnings" in avery.context.config, false);
    assert.ok(avery.data.lessons.length > 0);
  } finally {
    demoHelper.stop();
  }
});

test("prepareConfig throws CONFIG_INVALID with every error in details", () => {
  const configHelper = loadNodeHelper();
  configHelper._mmLog = () => {};
  try {
    assert.throws(
      () => configHelper.prepareConfig({ id: "x", demoDataFile: "demo/fixtures/missing.json", students: [] }),
      (error) => {
        assert.equal(error.code, "CONFIG_INVALID");
        assert.match(error.details.errors.join(" "), /demoDataFile/);
        assert.equal(error.message, error.details.errors.join("\n"));
        return true;
      },
    );
  } finally {
    configHelper.stop();
  }
});

test("instances of one account fetch one after another, even when several wait at once", async () => {
  const serialHelper = loadNodeHelper();
  serialHelper._mmLog = () => {};
  serialHelper._ensureRuntime();
  const student = { title: "Kid", username: "parent", password: "pw", school: "s", server: "x.webuntis.com" };
  const config = { students: [student], _moduleDefaultsMerged: true };

  let active = 0;
  let maxActive = 0;
  let runs = 0;
  serialHelper._processGroup = async () => {
    active += 1;
    runs += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
    return { payloads: [{}], failed: 0 };
  };

  try {
    await Promise.all(["a", "b", "c"].map((identifier) => serialHelper.fetchInstance({ identifier, config })));

    assert.equal(runs, 3);
    assert.equal(maxActive, 1, "two waiting instances must not start together once the first finished");
    assert.equal(serialHelper._pendingFetchByCredKey.size, 0);
  } finally {
    serialHelper.stop();
  }
});

test("fetchInstance reports allFailed for a failed login and for no students", async () => {
  const failHelper = loadNodeHelper();
  failHelper._mmLog = () => {};
  failHelper._ensureRuntime();
  failHelper._processGroup = async (_credKey, students) => ({
    payloads: students.map(() => ({})),
    failed: students.length,
  });
  const student = { title: "Kid", username: "parent", password: "pw", school: "s", server: "x.webuntis.com" };

  try {
    const failed = await failHelper.fetchInstance({
      identifier: "m",
      config: { students: [student], _moduleDefaultsMerged: true },
    });
    assert.equal(failed.allFailed, true);
    assert.equal(failed.students.length, 1);

    const none = await failHelper.fetchInstance({
      identifier: "m",
      config: { students: [], _moduleDefaultsMerged: true },
    });
    assert.equal(none.allFailed, true);
  } finally {
    failHelper.stop();
  }
});

test("a failed student discovery comes back as a warning and is retried by the next fetch", async () => {
  const discoveryHelper = loadNodeHelper();
  discoveryHelper._mmLog = () => {};
  discoveryHelper._ensureRuntime();
  let logins = 0;
  discoveryHelper._authService.getAuth = async () => {
    logins += 1;
    throw new Error("unreachable");
  };
  const config = { username: "parent", password: "pw", school: "s", server: "127.0.0.1:9", students: [] };

  try {
    for (const expected of [1, 2]) {
      const result = await discoveryHelper.fetchInstance({ identifier: "m", config });
      assert.equal(result.allFailed, true);
      assert.match(result.warnings.join(" "), /Auto student discovery failed/);
      assert.equal(logins, expected, "every fetch tries the discovery again");
    }
  } finally {
    discoveryHelper.stop();
  }
});

test("each instance logs at its own logLevel, not the one of the last CONFIGURE", async () => {
  const lines = [];
  const originalLoad = Module._load;
  const helperPath = require.resolve("../node_helper");
  delete require.cache[helperPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "node_helper") return { create: (definition) => definition };
    if (request === "logger") {
      const capture = (level) => (message) => lines.push({ level, message });
      return { debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  let logHelper;
  try {
    logHelper = require("../node_helper");
  } finally {
    Module._load = originalLoad;
  }
  logHelper.sendSocketNotification = () => {};

  const configure = (id, logLevel) =>
    logHelper.socketNotificationReceived("MMM-Webuntis_REQUEST", {
      action: "CONFIGURE",
      identifier: id,
      data: {
        config: {
          id,
          logLevel,
          demoDataFile: "demo/fixtures/single-student-week.json",
          displayMode: "grid",
          students: [],
        },
      },
    });

  try {
    configure("verbose", "debug");
    configure("quiet", "error");
    await new Promise((resolve) => setTimeout(resolve, 50));

    const debugFor = (id) => lines.filter((line) => line.level === "debug" && line.message.includes(`id=${id}`));
    assert.ok(debugFor("verbose").length > 0, "the debug instance keeps its debug lines");
    assert.equal(debugFor("quiet").length, 0, "the error instance logs no debug lines");
    assert.equal(logHelper._sharedLogLevel(), "debug", "shared services follow the widest instance level");
  } finally {
    logHelper.stop();
  }
});

test("demo payloads take the configured student's options, one fixture per student", () => {
  const { buildDemoPayloads } = require("../lib/demoData");
  const moduleRoot = require("node:path").join(__dirname, "..");
  const config = {
    demoDataFile: "demo/fixtures/single-student-week.json, demo/fixtures/single-student-week.json",
    debugDate: "2026-09-30",
    students: [{ title: "Avery", mode: "verbose" }],
  };

  const [first, second] = buildDemoPayloads(config, moduleRoot);
  assert.equal(first.context.config.mode, "verbose");
  assert.equal(first.context.student.title, "Avery Finch", "the data keeps the fixture's student");
  assert.equal(second.context.config.title, "Avery", "more fixtures than students reuse the first student");
});

test("demoDataFile cannot point outside the module folder", () => {
  const { resolveFixturePaths } = require("../lib/demoData");
  const moduleRoot = require("node:path").join(__dirname, "..");

  assert.throws(() => resolveFixturePaths("../../config/config.js", moduleRoot), /inside the module folder/);
  assert.equal(resolveFixturePaths("/demo/fixtures/single-student-week.json", moduleRoot).length, 1);
});

test("a missing demo fixture fails CONFIGURE with a config error", async () => {
  const demoHelper = loadNodeHelper();
  demoHelper._mmLog = () => {};
  const emitted = [];
  demoHelper.sendSocketNotification = (_name, payload) => emitted.push(payload);

  try {
    demoHelper.socketNotificationReceived("MMM-Webuntis_REQUEST", {
      action: "CONFIGURE",
      identifier: "demo-module",
      data: { config: { id: "demo-module", demoDataFile: "demo/fixtures/missing.json", students: [] } },
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].action, "CONFIG_INVALID");
    assert.match(emitted[0].error.details.errors.join(" "), /demoDataFile/);
  } finally {
    demoHelper.stop();
  }
});

test("a re-login logs the session it replaces out, but not one with the same cookies", async () => {
  const { AuthService } = require("../lib/webuntisClient");
  const service = new AuthService({ logger: () => {} });
  const logouts = [];
  service.httpClient.logout = async (server, school, cookies) => {
    logouts.push({ server, school, cookies });
  };
  const entry = { token: "t", cookieString: "old", school: "s", server: "srv" };

  service._authCache.set("key", { ...entry, expiresAt: Date.now() });
  service._cacheAuthResult("key", { ...entry, cookieString: "new" });
  assert.deepEqual(logouts, [{ server: "srv", school: "s", cookies: "old" }]);

  service._cacheAuthResult("key", { ...entry, cookieString: "new" });
  service._cacheAuthResult("fresh", { ...entry, cookieString: "first" });
  assert.equal(logouts.length, 1, "same cookies and first logins retire nothing");
});

test("a credentials login keeps school and server in the cache, so the session can be logged out later", async () => {
  const { AuthService } = require("../lib/webuntisClient");
  const service = new AuthService({ logger: () => {} });
  service.httpClient.authenticateWithCredentials = async () => ({ cookies: "c" });
  service.httpClient.getBearerToken = async () => "t";
  service._fetchAppData = async () => ({ tenantId: 1, schoolYearId: 2, appData: {} });
  const logouts = [];
  service.httpClient.logout = async (server, school, cookies) => {
    logouts.push({ server, school, cookies });
  };

  await service._performAuthFromCredentials("key", "school-a", "user", "pw", "srv.example", {});
  await service.logoutAll();

  assert.deepEqual(logouts, [{ server: "srv.example", school: "school-a", cookies: "c" }]);
});

function createRenewalService({ renewToken }) {
  const { AuthService } = require("../lib/webuntisClient");
  const lines = [];
  const service = new AuthService({ logger: (level, message) => lines.push({ level, message }) });
  const calls = { renew: 0, login: 0 };
  service.httpClient.getBearerToken = async () => {
    calls.renew += 1;
    return renewToken();
  };
  service._performAuth = async () => {
    calls.login += 1;
    return { token: "login-token", cookieString: "c", school: "s", server: "srv" };
  };
  const entry = {
    token: "old",
    cookieString: "c",
    tenantId: 1,
    schoolYearId: 2,
    personId: 3,
    school: "s",
    server: "srv",
    appData: { user: 1 },
    sessionStartedAt: Date.now() - 20 * 60 * 1000,
    expiresAt: Date.now() + 10 * 1000,
  };
  service._authCache.set("key", entry);
  const getAuth = () =>
    service.getAuth({ school: "s", username: "u", password: "p", server: "srv", options: { cacheKey: "key" } });
  return { service, calls, lines, entry, getAuth };
}

test("an expiring token is renewed from the session cookie, keeping the cached app data, without a login", async () => {
  const { calls, lines, getAuth, service } = createRenewalService({ renewToken: async () => "new-token" });

  const auth = await getAuth();

  assert.equal(auth.token, "new-token");
  assert.equal(auth.tenantId, 1);
  assert.deepEqual(auth.appData, { user: 1 });
  assert.deepEqual(calls, { renew: 1, login: 0 });
  assert.equal(
    lines.some((line) => line.level === "info"),
    false,
    "a renewal is not a login",
  );
  assert.equal(service._authCache.get("key").token, "new-token");
  assert.ok(service._authCache.get("key").sessionStartedAt < Date.now() - 19 * 60 * 1000, "the session start stays");
});

test("when the cookie no longer works the renewal falls back to a real login", async () => {
  const { calls, lines, getAuth } = createRenewalService({
    renewToken: async () => {
      throw new Error("Session expired");
    },
  });

  const auth = await getAuth();

  assert.equal(auth.token, "login-token");
  assert.deepEqual(calls, { renew: 1, login: 1 });
  assert.equal(lines.filter((line) => line.level === "info").length, 1);
});

test("a session older than six hours, or without a recorded start, gets a real login", async () => {
  for (const change of [{ sessionStartedAt: Date.now() - 7 * 60 * 60 * 1000 }, { sessionStartedAt: undefined }]) {
    const { calls, getAuth, service, entry } = createRenewalService({ renewToken: async () => "new-token" });
    service._authCache.set("key", { ...entry, ...change });

    await getAuth();

    assert.deepEqual(calls, { renew: 0, login: 1 });
  }
});

test("parallel requests during a renewal share it", async () => {
  const { calls, getAuth } = createRenewalService({
    renewToken: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "new-token";
    },
  });

  const results = await Promise.all([getAuth(), getAuth(), getAuth()]);

  assert.equal(calls.renew, 1);
  assert.deepEqual(new Set(results.map((auth) => auth.token)), new Set(["new-token"]));
});
