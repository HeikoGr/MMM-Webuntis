const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

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
