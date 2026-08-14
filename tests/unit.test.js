const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const runtimeUtils = require('../lib/runtime-utils');
const { sanitizeRichText } = require('../lib/webuntis/dataOrchestration');
const singleStudentWeekFixture = require('../demo/fixtures/single-student-week.json');

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

  const sharedPath = require.resolve('../lib/frontendShared');
  delete require.cache[sharedPath];
  require(sharedPath);
  const shared = global.window.MMMWebuntisFrontendShared;

  global.window = previousWindow;
  global.document = previousDocument;

  return shared;
}

function loadNodeHelper() {
  const originalLoad = Module._load;
  const helperPath = require.resolve('../node_helper');
  delete require.cache[helperPath];

  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === 'node_helper') {
      return { create: (definition) => definition };
    }
    if (request === 'logger') {
      return { debug() {}, info() {}, warn() {}, error() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require('../node_helper');
  } finally {
    Module._load = originalLoad;
  }
}

const helper = loadNodeHelper();

test('sanitizeRichText preserves the formatting whitelist and removes unsafe markup', () => {
  const result = sanitizeRichText('<p>Hello <strong onclick="alert(1)">World</strong><br><script>alert(1)</script><img src=x></p>');

  assert.equal(result, 'Hello <strong>World</strong>');
});

test('sanitizeRichText keeps Markdown markers only when requested', () => {
  assert.equal(sanitizeRichText('A *marked* _text_'), 'A marked text');
  assert.equal(sanitizeRichText('A *marked* _text_', true), 'A *marked* _text_');
});

test('single-student-week fixture matches the canonical V3 payload shape', () => {
  const { data, state } = singleStudentWeekFixture;

  assert.deepEqual(Object.keys(data).sort(), [
    'absences',
    'dayNotices',
    'exams',
    'holidays',
    'homework',
    'lessons',
    'messages',
    'timeUnits',
  ]);
  assert.deepEqual(state.warningMeta, []);
  assert.equal(data.holidays.current, null);

  for (const lesson of data.lessons) {
    assert.equal(Array.isArray(lesson.displayIcons), true);
    assert.equal('activityType' in lesson, false);
    assert.equal('statusDetail' in lesson, false);
  }

  for (const exam of data.exams) {
    assert.equal('endTime' in exam, true);
  }

  for (const homework of data.homework) {
    for (const field of ['id', 'lid', 'lessonId', 'studentId', 'elementIds', 'completed', 'remark']) {
      assert.equal(field in homework, true);
    }
  }

  for (const absence of data.absences) {
    assert.equal('student' in absence, true);
    assert.equal('lessonId' in absence, true);
  }
});

test('mergeGroupWarningsIntoPayload deduplicates warnings and upgrades generic metadata', () => {
  const payload = {
    state: {
      warnings: ['auth warning'],
      warningMeta: [{ message: 'auth warning', kind: 'generic', severity: 'warning' }],
    },
  };

  const result = helper._mergeGroupWarningsIntoPayload(
    payload,
    'module-1',
    ['auth warning', 'config warning'],
    new Map([
      ['auth warning', { kind: 'auth', severity: 'critical' }],
      ['config warning', { kind: 'config', severity: 'warning' }],
    ])
  );

  assert.equal(result.id, 'module-1');
  assert.deepEqual(result.state.warnings, ['auth warning', 'config warning']);
  assert.deepEqual(result.state.warningMeta, [
    { message: 'auth warning', kind: 'auth', severity: 'critical' },
    { message: 'config warning', kind: 'config', severity: 'warning' },
  ]);
});

test('buildStudentErrorPayload returns empty API snapshot and fallback warning metadata', () => {
  const payload = helper._buildStudentErrorPayload({
    identifier: 'module-1',
    sessionId: 'session-1',
    sessionKey: 'module-1:session-1',
    student: { title: 'Student A' },
    config: { displayMode: 'lessons' },
    warnings: ['plain warning'],
    groupWarningMetaByMessage: new Map(),
    warningFallbackMeta: { kind: 'generic', severity: 'warning' },
    includeApiSnapshot: false,
  });

  assert.deepEqual(payload.state.api, {
    timetable: null,
    exams: null,
    homework: null,
    absences: null,
    messages: null,
  });
  assert.deepEqual(payload.state.warningMeta, [{ message: 'plain warning', kind: 'generic', severity: 'warning' }]);
});

test('createGroupWarningCollector stores one warning entry per message', () => {
  const collector = helper._createGroupWarningCollector();

  collector.addGroupWarning('network issue', { kind: 'network', severity: 'critical' });
  collector.addGroupWarning('network issue', { kind: 'config', severity: 'warning' });
  collector.addGroupWarning('config issue');

  assert.deepEqual(collector.groupWarnings, ['network issue', 'config issue']);
  assert.deepEqual(collector.groupWarningMetaByMessage.get('network issue'), {
    kind: 'network',
    severity: 'critical',
  });
  assert.deepEqual(collector.groupWarningMetaByMessage.get('config issue'), {
    kind: 'generic',
    severity: 'warning',
  });
});

test('emit helpers preserve or override route metadata as intended', () => {
  helper.notifications = { EVENT: 'MMM-Webuntis_EVENT' };
  const emitted = [];
  helper.sendSocketNotification = (name, payload) => emitted.push({ name, payload });

  helper._emitGotData({ id: 'old', sessionId: 'old-session', value: 1 }, { identifier: 'new', sessionId: 'new-session' });
  helper._emitInitError({ id: 'old', sessionId: 'old-session', value: 2 }, { identifier: 'new', sessionId: 'new-session' });
  helper._emitModuleInitialized({ value: 3 }, { identifier: 'new', sessionId: 'new-session' });

  assert.equal(emitted.length, 3);

  const [dataEvt, errEvt, readyEvt] = emitted;
  assert.equal(dataEvt.name, 'MMM-Webuntis_EVENT');
  assert.equal(dataEvt.payload.action, 'DATA_UPDATE');
  assert.equal(dataEvt.payload.identifier, 'new');
  assert.equal(dataEvt.payload.instanceId, 'new');
  assert.equal(dataEvt.payload.ok, true);
  assert.deepEqual(dataEvt.payload.data, { id: 'new', sessionId: 'new-session', value: 1 });
  assert.equal(dataEvt.payload.error, null);
  assert.equal(typeof dataEvt.payload.requestId, 'string');
  assert.equal(Number.isFinite(dataEvt.payload.ts), true);

  assert.equal(errEvt.name, 'MMM-Webuntis_EVENT');
  assert.equal(errEvt.payload.action, 'MODULE_INIT_FAILED');
  assert.equal(errEvt.payload.identifier, 'old');
  assert.equal(errEvt.payload.instanceId, 'old');
  assert.equal(errEvt.payload.ok, false);
  assert.deepEqual(errEvt.payload.data, { id: 'old', sessionId: 'old-session', value: 2 });
  assert.deepEqual(errEvt.payload.error, { id: 'old', sessionId: 'old-session', value: 2 });
  assert.equal(typeof errEvt.payload.requestId, 'string');
  assert.equal(Number.isFinite(errEvt.payload.ts), true);

  assert.equal(readyEvt.name, 'MMM-Webuntis_EVENT');
  assert.equal(readyEvt.payload.action, 'MODULE_READY');
  assert.equal(readyEvt.payload.identifier, 'new');
  assert.equal(readyEvt.payload.instanceId, 'new');
  assert.equal(readyEvt.payload.ok, true);
  assert.deepEqual(readyEvt.payload.data, { id: 'new', sessionId: 'new-session', value: 3 });
  assert.equal(readyEvt.payload.error, null);
  assert.equal(typeof readyEvt.payload.requestId, 'string');
  assert.equal(Number.isFinite(readyEvt.payload.ts), true);
});

test('handleSessionState uses default route values for missing payload metadata', () => {
  helper._pausedSessions = new Set();
  helper._mmLog = () => {};

  helper._handleSessionState({ state: 'paused' });

  assert.equal(helper._pausedSessions.has('default:unknown'), true);
});

const { parseCliArgs } = require('../scripts/node_helper_wrapper');

function parseCli(argline) {
  return parseCliArgs(['node', 'node_helper_wrapper.js', ...argline.split(' ').filter(Boolean)], 2);
}

test('parseCliArgs does not mistake a flag value for the positional config path', () => {
  // Regression: `auth` used to be picked up as the positional command and reused as --config,
  // which made every documented `--action <x>` invocation fail with "Config file not found".
  const { flags, command } = parseCli('--action auth --verbose');

  assert.equal(flags.action, 'auth');
  assert.equal(flags.verbose, true);
  assert.equal(command, null);
});

test('parseCliArgs handles every invocation documented in the CLI help', () => {
  const cases = [
    ['--student 0', { student: '0' }],
    ['--student 1 --verbose', { student: '1', verbose: true }],
    ['--action exams', { action: 'exams' }],
    ['--action lessons,grid', { action: 'lessons,grid' }],
    ['--action homework --verbose', { action: 'homework', verbose: true }],
    ['--dump --verbose', { dump: true, verbose: true }],
    ['--config ./custom-config.js --student 1', { config: './custom-config.js', student: '1' }],
    ['--all --action auth --verbose', { all: true, action: 'auth', verbose: true }],
  ];

  for (const [argline, expected] of cases) {
    const { flags, command } = parseCli(argline);
    assert.deepEqual(flags, expected, `flags mismatch for "${argline}"`);
    assert.equal(command, null, `"${argline}" must not produce a positional command`);
  }
});

test('parseCliArgs supports short, bundled, and =-style flags', () => {
  assert.deepEqual(parseCli('-a auth -v').flags, { a: 'auth', v: true });
  assert.deepEqual(parseCli('-vd').flags, { v: true, d: true });
  assert.deepEqual(parseCli('--action=auth --config=./c.js').flags, { action: 'auth', config: './c.js' });

  // A boolean long flag must not swallow the next flag.
  assert.deepEqual(parseCli('--verbose --action auth').flags, { verbose: true, action: 'auth' });

  // A value flag at the end of the line degrades to boolean instead of consuming undefined.
  assert.deepEqual(parseCli('--action').flags, { action: true });
});

test('parseCliArgs still accepts a bare config path as positional command', () => {
  const { flags, command } = parseCli('./config/config.js --verbose');

  assert.equal(command, './config/config.js');
  assert.equal(flags.verbose, true);
});

test('collectCapabilities prefers the backend hook and falls back to the manifest', () => {
  const { collectCapabilities, buildFetchFlagsFromCapabilities } = require('../lib/pluginCapabilityResolver');

  const records = [
    // No backend instance: manifest capabilities are used.
    { manifest: { id: 'exams', capabilities: ['exams', 'studentContext'] }, instance: null },
    // Backend hook overrides the manifest and may depend on plugin config.
    {
      manifest: { id: 'grid', capabilities: ['lessons'] },
      instance: {
        getCapabilities: (pluginConfig) => (pluginConfig?.showAbsences ? ['lessons', 'timeUnits', 'absences'] : ['lessons', 'timeUnits']),
      },
    },
  ];

  const withoutAbsences = collectCapabilities(records, { getPluginConfig: () => ({}) });
  assert.deepEqual(withoutAbsences, ['exams', 'lessons', 'studentContext', 'timeUnits']);

  const withAbsences = collectCapabilities(records, { getPluginConfig: (id) => (id === 'grid' ? { showAbsences: true } : {}) });
  assert.equal(withAbsences.includes('absences'), true);
  assert.equal(buildFetchFlagsFromCapabilities(withAbsences).fetchAbsences, true);

  // Unknown capability names are dropped rather than silently forwarded as fetch flags.
  const bogus = collectCapabilities([{ manifest: { id: 'x', capabilities: ['lessons', 'notACapability'] }, instance: null }], {});
  assert.deepEqual(bogus, ['lessons']);
});

test('buildFetchFlags derives fetch flags from active plugin capabilities', () => {
  helper._mmLog = () => {};
  helper._pluginHost = {
    plugins: [
      { manifest: { id: 'exams', capabilities: ['exams', 'studentContext'] }, instance: null },
      { manifest: { id: 'homework', capabilities: ['homework'] }, instance: null },
    ],
  };

  const flags = helper._buildFetchFlags({ plugins: { exams: { enabled: true }, homework: { enabled: false } } });

  assert.equal(flags.fetchExams, true);
  assert.equal(flags.wantsExamsWidget, true);
  assert.equal(flags.fetchHomeworks, false, 'disabled plugin must not pull its endpoint');
  assert.equal(flags.wantsHomeworkWidget, false);
});

test('frontendShared exposes the namespaces backing pluginContext', () => {
  const shared = loadFrontendShared();

  // Regression: pluginContext.dom/time/formatting used to be handed to plugins as empty objects
  // while docs/PLUGINS.md documented them as provided.
  const expected = {
    dom: ['addFullRow', 'addHeader', 'addRow', 'createContainer', 'createElement', 'escapeHtml'],
    time: ['DEFAULT_TIMEZONE', 'currentTimeAsHHMM', 'getCurrentDateContext', 'toMinutesSinceMidnight'],
    formatting: ['escapeHtml', 'formatDisplayDate', 'formatDisplayTime', 'formatYmd'],
  };

  for (const [namespace, keys] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(shared[namespace]).sort(), keys, `${namespace} namespace mismatch`);

    for (const key of keys) {
      assert.notEqual(shared[namespace][key], undefined, `${namespace}.${key} must be defined`);
    }
  }

  // util keeps exposing everything so existing plugin code stays working.
  assert.equal(typeof shared.util.formatDisplayDate, 'function');
  assert.equal(typeof shared.util.resolveWidgetHelpers, 'function');
  assert.equal(typeof shared.util.buildHolidayMapFromRanges, 'function');
  assert.equal(typeof shared.util.buildDayNoticeMap, 'function');
});

test('shared date map builders replace the former per-plugin copies', () => {
  const shared = loadFrontendShared();

  const holidayMap = shared.util.buildHolidayMapFromRanges([{ startDate: 20260302, endDate: 20260304, name: 'Spring' }]);
  assert.deepEqual(Object.keys(holidayMap), ['20260302', '20260303', '20260304']);
  assert.equal(holidayMap[20260303].name, 'Spring');

  // Malformed ranges are skipped rather than throwing or producing endless loops.
  assert.deepEqual(shared.util.buildHolidayMapFromRanges([{ startDate: 'x', endDate: 20260304 }]), {});
  assert.deepEqual(shared.util.buildHolidayMapFromRanges([]), {});

  const noticeMap = shared.util.buildDayNoticeMap([{ date: 20260302, text: 'a' }, { date: 0 }, {}]);
  assert.deepEqual(Object.keys(noticeMap), ['20260302']);
});

test('frontendShared namespace members are callable', () => {
  const shared = loadFrontendShared();

  assert.equal(shared.formatting.escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
  assert.equal(shared.formatting.formatYmd(20260302), '02.03.2026');
  assert.equal(shared.time.currentTimeAsHHMM(new Date(2026, 0, 1, 13, 50)), 1350);
  assert.equal(shared.time.toMinutesSinceMidnight('13:50'), 830);
  assert.equal(shared.time.DEFAULT_TIMEZONE, 'Europe/Berlin');
});

function seedApiStatus() {
  helper._mmLog = () => {};
  helper._apiStatusBySession = new Map();
  return 'mirror:session';
}

function failEndpoint(sessionKey, endpoint, status, times = 1) {
  for (let i = 0; i < times; i++) {
    helper._recordApiStatusFromError(sessionKey, endpoint, { status });
  }
}

function ageRecord(sessionKey, endpoint, ms) {
  helper._apiStatusBySession.get(sessionKey)[endpoint].recordedAt -= ms;
}

test('shouldSkipApi keeps retrying isolated 5xx blips', () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, 'homework', 500, 1);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), false);

  failEndpoint(sessionKey, 'homework', 500, 1);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), false, 'two failures must not open the breaker');
});

test('shouldSkipApi backs off after repeated 5xx and escalates the window', () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, 'homework', 500, 3);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), true, 'third failure opens the breaker');

  // Still inside the first 15min window.
  ageRecord(sessionKey, 'homework', 10 * 60 * 1000);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), true);

  // Window elapsed - one probe is allowed through.
  ageRecord(sessionKey, 'homework', 6 * 60 * 1000);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), false);

  // Probe fails again -> escalate to the 1h step.
  failEndpoint(sessionKey, 'homework', 500, 1);
  ageRecord(sessionKey, 'homework', 30 * 60 * 1000);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), true, '30min must not clear the 1h step');

  ageRecord(sessionKey, 'homework', 31 * 60 * 1000);
  assert.equal(helper._shouldSkipApi(sessionKey, 'homework'), false);
});

test('getTransientBackoffMs caps the escalation', () => {
  assert.equal(helper._getTransientBackoffMs(2), 0);
  assert.equal(helper._getTransientBackoffMs(3), 15 * 60 * 1000);
  assert.equal(helper._getTransientBackoffMs(4), 60 * 60 * 1000);
  assert.equal(helper._getTransientBackoffMs(5), 6 * 60 * 60 * 1000);
  assert.equal(helper._getTransientBackoffMs(50), 6 * 60 * 60 * 1000, 'capped at the last step');
});

test('recordApiStatusFromError counts only consecutive failures', () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, 'homework', 500, 2);
  assert.equal(helper._apiStatusBySession.get(sessionKey).homework.failureCount, 2);

  // A success in between must restart the streak.
  helper._apiStatusBySession.get(sessionKey).homework = { status: 200, recordedAt: Date.now(), failureCount: 0 };
  failEndpoint(sessionKey, 'homework', 500, 1);
  assert.equal(helper._apiStatusBySession.get(sessionKey).homework.failureCount, 1);
});

test('shouldSkipApi still treats permanent errors as permanent', () => {
  const sessionKey = seedApiStatus();

  // A single 403 skips immediately - no threshold, unlike transient errors.
  failEndpoint(sessionKey, 'timetable', 403, 1);
  assert.equal(helper._shouldSkipApi(sessionKey, 'timetable'), true);

  // ...but is re-probed after the 24h license window.
  ageRecord(sessionKey, 'timetable', 25 * 60 * 60 * 1000);
  assert.equal(helper._shouldSkipApi(sessionKey, 'timetable'), false);
  assert.equal('timetable' in helper._apiStatusBySession.get(sessionKey), false, 'expired record is cleared');
});

test('shouldSkipApi never skips an endpoint whose last call succeeded', () => {
  const sessionKey = seedApiStatus();

  failEndpoint(sessionKey, 'exams', 500, 5);
  assert.equal(helper._shouldSkipApi(sessionKey, 'exams'), true);

  helper._apiStatusBySession.get(sessionKey).exams = { status: 200, recordedAt: Date.now(), failureCount: 0 };
  assert.equal(helper._shouldSkipApi(sessionKey, 'exams'), false);
});

function seedSessionState(sessionKeys = []) {
  helper._mmLog = () => {};
  helper._configsBySession = new Map();
  helper._apiStatusBySession = new Map();
  helper._pausedSessions = new Set();
  helper._sessionLastSeenAt = new Map();

  for (const [sessionKey, lastSeenAt] of sessionKeys) {
    helper._configsBySession.set(sessionKey, { updateInterval: 300000 });
    helper._apiStatusBySession.set(sessionKey, { timetable: { status: 403, recordedAt: 0 } });
    helper._sessionLastSeenAt.set(sessionKey, lastSeenAt);
  }
}

test('storeInitSessionConfig releases session state left behind by frontend reloads', () => {
  const now = Date.now();
  // Two dead sessions from earlier page loads, one live sibling client still refreshing.
  seedSessionState([
    ['mirror:oldsession1', now - 60 * 60 * 1000],
    ['mirror:oldsession2', now - 45 * 60 * 1000],
    ['mirror:livesession', now - 1000],
    ['other:oldsession', now - 60 * 60 * 1000],
  ]);

  helper._storeInitSessionConfig('mirror:newsession', { updateInterval: 300000 });

  const remaining = Array.from(helper._configsBySession.keys()).sort();
  assert.deepEqual(remaining, ['mirror:livesession', 'mirror:newsession', 'other:oldsession']);

  // Per-session side tables must be released together with the config clone.
  assert.equal(helper._apiStatusBySession.has('mirror:oldsession1'), false);
  assert.equal(helper._sessionLastSeenAt.has('mirror:oldsession2'), false);

  // A different identifier is never touched, even when it is equally stale.
  assert.equal(helper._apiStatusBySession.has('other:oldsession'), true);
});

test('storeInitSessionConfig keeps concurrent clients of the same identifier alive', () => {
  const now = Date.now();
  seedSessionState([['mirror:phoneclient', now - 2 * 60 * 1000]]);

  // Second client attaches under the same identifier while the first is still refreshing.
  helper._storeInitSessionConfig('mirror:mirrorclient', { updateInterval: 300000 });

  assert.equal(helper._configsBySession.has('mirror:phoneclient'), true);
  assert.equal(helper._configsBySession.has('mirror:mirrorclient'), true);
});

test('getSessionTtlMs clamps the eviction window', () => {
  assert.equal(helper._getSessionTtlMs({ updateInterval: 300000 }), 10 * 60 * 1000); // 2x, raised to min
  assert.equal(helper._getSessionTtlMs({ updateInterval: 20 * 60 * 1000 }), 40 * 60 * 1000); // 2x, in range
  assert.equal(helper._getSessionTtlMs({ updateInterval: 10 * 60 * 60 * 1000 }), 60 * 60 * 1000); // capped
  assert.equal(helper._getSessionTtlMs({}), 10 * 60 * 1000); // no interval -> default, raised to min
});

test('getCurrentDateContext keeps wall clock time while overriding debug date', () => {
  const now = new Date(Date.UTC(2026, 4, 12, 14, 37, 22, 15));
  const result = runtimeUtils.getCurrentDateContext(
    {
      debugDate: '2026-03-02',
      timezone: 'UTC',
    },
    {
      now,
      defaultTimezone: 'UTC',
    }
  );

  assert.equal(result.isDebug, true);
  assert.equal(result.ymd, 20260302);
  assert.equal(result.isoDate, '2026-03-02');
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
const wallClock = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

test('getCurrentDateContext resolves the school wall clock regardless of the host timezone', () => {
  const now = new Date(Date.UTC(2026, 4, 12, 14, 37, 0)); // 16:37 in Berlin (CEST, UTC+2)
  const result = runtimeUtils.getCurrentDateContext({ timezone: 'Europe/Berlin' }, { now, defaultTimezone: 'Europe/Berlin' });

  assert.equal(wallClock(result.date), '16:37');
  assert.equal(result.ymd, 20260512);
  assert.equal(result.isDebug, false);
});

test('getCurrentDateContext applies the winter offset outside daylight saving time', () => {
  const now = new Date(Date.UTC(2026, 0, 15, 14, 30, 0)); // 15:30 in Berlin (CET, UTC+1)
  const result = runtimeUtils.getCurrentDateContext({ timezone: 'Europe/Berlin' }, { now, defaultTimezone: 'Europe/Berlin' });

  assert.equal(wallClock(result.date), '15:30');
  assert.equal(result.ymd, 20260115);
});

test('getCurrentDateContext rolls over the day at local midnight, not at UTC midnight', () => {
  const now = new Date(Date.UTC(2026, 7, 14, 22, 30, 0)); // 00:30 on the 15th in Berlin
  const result = runtimeUtils.getCurrentDateContext({ timezone: 'Europe/Berlin' }, { now, defaultTimezone: 'Europe/Berlin' });

  assert.equal(result.ymd, 20260815, 'the timetable must already show the new day');
  assert.equal(result.isoDate, '2026-08-15');
  assert.equal(wallClock(result.date), '00:30');
});

test('getCurrentDateContext honours a timezone behind UTC', () => {
  const now = new Date(Date.UTC(2026, 0, 15, 14, 30, 0)); // 09:30 in New York (EST, UTC-5)
  const result = runtimeUtils.getCurrentDateContext({ timezone: 'America/New_York' }, { now, defaultTimezone: 'Europe/Berlin' });

  assert.equal(wallClock(result.date), '09:30');
  assert.equal(result.ymd, 20260115);
});

test('getCurrentDateContext keeps the school wall clock when debugDate crosses a DST boundary', () => {
  // Real date is in CEST (UTC+2), the debug date is in CET (UTC+1). The wall clock must survive
  // the jump untouched - only the day changes.
  const now = new Date(Date.UTC(2026, 4, 12, 14, 37, 22, 15));
  const result = runtimeUtils.getCurrentDateContext(
    { debugDate: '2026-03-02', timezone: 'Europe/Berlin' },
    { now, defaultTimezone: 'Europe/Berlin' }
  );

  assert.equal(result.isDebug, true);
  assert.equal(result.ymd, 20260302);
  assert.equal(wallClock(result.date), '16:37');
  assert.equal(result.date.getSeconds(), 22);
  assert.equal(result.date.getMilliseconds(), 15, 'milliseconds survive the Intl round trip');
});

test('_calculateBaseNow uses normalized debug date context', () => {
  const baseNow = helper._calculateBaseNow({ debugDate: '20260302', timezone: 'UTC' });

  assert.equal(baseNow.getFullYear(), 2026);
  assert.equal(baseNow.getMonth(), 2);
  assert.equal(baseNow.getDate(), 2);
});
