const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const runtimeUtils = require('../lib/runtime-utils');

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
  const emitted = [];
  helper.sendSocketNotification = (name, payload) => emitted.push({ name, payload });

  helper._emitGotData({ id: 'old', sessionId: 'old-session', value: 1 }, { identifier: 'new', sessionId: 'new-session' });
  helper._emitInitError({ id: 'old', sessionId: 'old-session', value: 2 }, { identifier: 'new', sessionId: 'new-session' });
  helper._emitModuleInitialized({ value: 3 }, { identifier: 'new', sessionId: 'new-session' });

  assert.deepEqual(emitted, [
    {
      name: 'GOT_DATA',
      payload: { id: 'new', sessionId: 'new-session', value: 1 },
    },
    {
      name: 'INIT_ERROR',
      payload: { id: 'old', sessionId: 'old-session', value: 2 },
    },
    {
      name: 'MODULE_INITIALIZED',
      payload: { id: 'new', sessionId: 'new-session', value: 3 },
    },
  ]);
});

test('handleSessionState uses default route values for missing payload metadata', () => {
  helper._pausedSessions = new Set();
  helper._mmLog = () => {};

  helper._handleSessionState({ state: 'paused' });

  assert.equal(helper._pausedSessions.has('default:unknown'), true);
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

test('_calculateBaseNow uses normalized debug date context', () => {
  const baseNow = helper._calculateBaseNow({ debugDate: '20260302', timezone: 'UTC' });

  assert.equal(baseNow.getFullYear(), 2026);
  assert.equal(baseNow.getMonth(), 2);
  assert.equal(baseNow.getDate(), 2);
});
