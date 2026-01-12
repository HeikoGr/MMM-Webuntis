/**
 * Patch script to refactor REST API functions in node_helper.js
 * This script safely replaces the 5 large REST API functions with calls to webuntisApiService
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'node_helper.js');
let content = fs.readFileSync(filePath, 'utf8');

console.log('Original file: ' + content.split('\n').length + ' lines');

// 1. Add webuntisApiService import
const importOld = `const restClient = require('./lib/restClient');
const { compactArray, schemas } = require('./lib/payloadCompactor');
const { validateConfig, applyLegacyMappings } = require('./lib/configValidator');
const { createBackendLogger } = require('./lib/logger');`;

const importNew = `const restClient = require('./lib/restClient');
const { compactArray, schemas } = require('./lib/payloadCompactor');
const { validateConfig, applyLegacyMappings } = require('./lib/configValidator');
const { createBackendLogger } = require('./lib/logger');
const webuntisApiService = require('./lib/webuntisApiService');`;

content = content.replace(importOld, importNew);

// 2. Find and replace each function individually using robust markers
const functions = [
  {
    name: '_getTimetableViaRest',
    start: '  async _getTimetableViaRest(',
    end: '  async _getExamsViaRest(',
    replacement: `  async _getTimetableViaRest(
    school,
    username,
    password,
    server,
    rangeStart,
    rangeEnd,
    studentId,
    options = {},
    useClassTimetable = false,
    className = null
  ) {
    const wantsClass = Boolean(useClassTimetable || options.useClassTimetable);
    let classId = options.classId;

    // Resolve class ID if needed
    if (wantsClass && !classId) {
      classId = await this._resolveClassIdViaRest(
        school,
        username,
        password,
        server,
        rangeStart,
        rangeEnd,
        className || options.className || null,
        { ...options, studentId }
      );
    }

    return webuntisApiService.getTimetable({
      getAuth: () => this._getRestAuthTokenAndCookies(school, username, password, server, options),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      useClassTimetable: wantsClass,
      classId,
      logger: this._mmLog.bind(this),
      mapStatusToCode: this._mapRestStatusToLegacyCode.bind(this),
    });
  },

  `,
  },
  {
    name: '_getExamsViaRest',
    start: '  async _getExamsViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {',
    end: '  async _getHomeworkViaRest(school,',
    replacement: `  async _getExamsViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    return webuntisApiService.getExams({
      getAuth: () => this._getRestAuthTokenAndCookies(school, username, password, server, options),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      normalizeDate: this._normalizeDateToInteger.bind(this),
      normalizeTime: this._normalizeTimeToMinutes.bind(this),
      sanitizeHtml: this._sanitizeHtmlText.bind(this),
    });
  },

  `,
  },
  {
    name: '_getHomeworkViaRest',
    start: '  async _getHomeworkViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {',
    end: '  async _getAbsencesViaRest(school,',
    replacement: `  async _getHomeworkViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    return webuntisApiService.getHomework({
      getAuth: () => this._getRestAuthTokenAndCookies(school, username, password, server, options),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
    });
  },

  `,
  },
  {
    name: '_getAbsencesViaRest',
    start: '  async _getAbsencesViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {',
    end: '  async _getMessagesOfDayViaRest(school,',
    replacement: `  async _getAbsencesViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    return webuntisApiService.getAbsences({
      getAuth: () => this._getRestAuthTokenAndCookies(school, username, password, server, options),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
    });
  },

  `,
  },
  {
    name: '_getMessagesOfDayViaRest',
    start: '  async _getMessagesOfDayViaRest(school, username, password, server, date, options = {}) {',
    end: '  _resolveSchoolAndServer(student) {',
    replacement: `  async _getMessagesOfDayViaRest(school, username, password, server, date, options = {}) {
    return webuntisApiService.getMessagesOfDay({
      getAuth: () => this._getRestAuthTokenAndCookies(school, username, password, server, options),
      server,
      date,
      logger: this._mmLog.bind(this),
    });
  },

  `,
  },
];

// Replace each function
functions.forEach((fn) => {
  const startIdx = content.indexOf(fn.start);
  const endIdx = content.indexOf(fn.end, startIdx);

  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Could not find boundaries for ${fn.name}`);
  }

  const before = content.substring(0, startIdx);
  const after = content.substring(endIdx);
  content = before + fn.replacement + after;
  console.log(`✓ Replaced ${fn.name}`);
});

// Write the file
fs.writeFileSync(filePath, content, 'utf8');
console.log('\nPatched file: ' + content.split('\n').length + ' lines');
console.log('✓ Successfully refactored node_helper.js');
