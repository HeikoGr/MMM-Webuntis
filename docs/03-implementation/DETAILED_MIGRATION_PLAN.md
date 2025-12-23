# Detailed REST API Migration Plan - MMM-Webuntis

**Status:** Planning Phase
**Branch:** `rest-api`
**Target:** Complete migration from webuntis library (JSON-RPC) to native REST API calls
**Last Updated:** 2025-12-19

---

## Executive Summary

This document provides a step-by-step migration plan to transition MMM-Webuntis from the `webuntis` npm library (which uses JSON-RPC under the hood) to direct REST API calls. The migration will be **incremental, backward-compatible, and feature-flagged** to ensure safety and allow gradual rollout.

### Goals

1. **Eliminate dependency on `webuntis` library** for data fetching
2. **Implement direct REST API calls** using axios (already a dependency)
3. **Maintain 100% backward compatibility** during transition
4. **Add comprehensive logging** to track API usage (JSON-RPC vs REST)
5. **Enable experimental mode** via feature flag for early testing
6. **Improve parent account support** by leveraging REST endpoints

### Non-Goals

- Breaking changes to existing configuration schema
- Removing support for QR code authentication (will be preserved)
- Forcing users to migrate (both modes will coexist initially)

---

## Current State Analysis

### Dependencies (package.json)

```json
{
  "webuntis": "^2.2.1",           // ← TO BE REMOVED (eventually)
  "axios": "^1.7.0",              // ✅ Already available
  "axios-cookiejar-support": "^6.0.5",  // ✅ Already available
  "tough-cookie": "^6.0.0",       // ✅ Already available
  "otplib": "^12.0.1"             // ✅ Used for QR code TOTP
}
```

### API Methods Used (node_helper.js)

| Method | Current Implementation | Line(s) | Migration Status |
|--------|----------------------|---------|------------------|
| `login()` | webuntis library | Implicit | ⚠️ Keep JSON-RPC |
| `logout()` | webuntis library | Implicit | ⚠️ Keep JSON-RPC |
| `getTimegrid()` | webuntis library | ~700 | ✅ REST available |
| `getOwnTimetableForRange()` | webuntis library | ~840 | ✅ REST available |
| `getOwnClassTimetableForRange()` | webuntis library | ~835 | ✅ REST available |
| `getTimetableForRange()` | webuntis library + REST fallback | ~805-825 | ⚠️ Hybrid (partially migrated) |
| `getExamsForRange()` | webuntis library | ~850-870 | ✅ REST available |
| `getHomeWorkAndLessons()` | webuntis library | ~880 | ✅ REST available |
| `getHomeWorksFor()` | webuntis library | ~881 | ✅ REST available |
| `getAbsentLesson()` | webuntis library | ~900+ | ✅ REST available |
| `getNewsWidget()` | webuntis library | Not visible | ✅ REST available |
| `getHolidays()` | webuntis library | Not visible | ✅ REST available |

### Existing REST Implementation

**Location:** `node_helper.js:104-213`

```javascript
async _getRestAuthTokenAndCookies(school, username, password, server = 'webuntis.com') {
  // Cached token implementation ✅
  // Returns: { token, cookieString }
}

async _getTimetableViaRest(school, username, password, server, startDate, endDate, studentId) {
  // REST timetable fetch with Bearer token ✅
  // Currently only used for parent accounts with studentId
}
```

**Key Finding:** REST infrastructure is already partially implemented but only activated for parent accounts with `studentId`.

---

## Migration Architecture

### Phase Overview

```
Phase 0: Preparation & Infrastructure    [Week 1]
Phase 1: Core REST API Module           [Week 2-3]
Phase 2: Method-by-Method Migration     [Week 4-6]
Phase 3: Testing & Validation           [Week 7]
Phase 4: Feature Flag Removal           [Week 8+]
Phase 5: Deprecation & Cleanup          [Future]
```

### Feature Flag Strategy

**Configuration Option:** `apiMode`

```javascript
config: {
  apiMode: 'auto',  // 'auto' | 'rest' | 'jsonrpc' | 'hybrid'

  // 'auto'     - Intelligent selection (REST for parent accounts, JSON-RPC otherwise)
  // 'rest'     - Force REST API (experimental, may fail on some endpoints)
  // 'jsonrpc'  - Force legacy webuntis library (default fallback)
  // 'hybrid'   - Use REST where available, fall back to JSON-RPC
}
```

**Default:** `'auto'` (maintains current behavior)

---

## Phase 0: Preparation & Infrastructure

### 0.1 Documentation Review ✅

**Status:** COMPLETE (this document)

- [x] Read all REST API documentation in `docs/`
- [x] Analyze current implementation in `node_helper.js`
- [x] Map webuntis library methods to REST endpoints
- [x] Create this migration plan

### 0.2 Create REST API Wrapper Class

**File:** `lib/webuntis-rest-client.js` (new)

**Responsibilities:**
- Authentication (JSON-RPC → cookies → Bearer token)
- Token caching and refresh logic
- Common headers management (Tenant-Id, School-Year-Id, etc.)
- Error handling and retry logic
- Request logging with API type indicators

**Interface:**
```javascript
class WebUntisRestClient {
  constructor(config) {
    this.school = config.school;
    this.username = config.username;
    this.password = config.password;
    this.server = config.server || 'webuntis.com';
    this.logLevel = config.logLevel || 'none';
    this.logger = config.logger || console.log;

    // Cache
    this._authCache = null; // { token, cookies, expiresAt, tenantId, schoolYearId }
  }

  async authenticate() { /* ... */ }
  async getTimegrid() { /* ... */ }
  async getTimetable(params) { /* ... */ }
  async getExams(params) { /* ... */ }
  async getHomework(params) { /* ... */ }
  async getAbsences(params) { /* ... */ }
  async getHolidays() { /* ... */ }
  async getMessagesOfDay(date) { /* ... */ }
  async logout() { /* ... */ }
}

module.exports = WebUntisRestClient;
```

### 0.3 Enhance Logging System

**Objective:** Add API usage tracking to all WebUntis calls

**Changes in `node_helper.js`:**

```javascript
_mmLog(level, student, message, apiType = null) {
  // Existing logging logic...

  // NEW: Add API type indicator
  if (apiType) {
    const prefix = {
      'rest': '[REST API]',
      'jsonrpc': '[JSON-RPC]',
      'hybrid': '[HYBRID]',
      'cache': '[CACHE]'
    }[apiType] || '[API]';

    message = `${prefix} ${message}`;
  }

  // Continue with existing logging...
}
```

**Usage Example:**
```javascript
this._mmLog('info', student, 'Fetching timetable for student 12345', 'rest');
// Output: [MMM-Webuntis] [REST API] Fetching timetable for student 12345
```

### 0.4 Add Configuration Migration Handler

**Objective:** Support new `apiMode` config option with backward compatibility

**Changes in `MMM-Webuntis.js`:**

```javascript
defaults: {
  // ... existing defaults ...

  apiMode: 'auto',  // NEW: 'auto' | 'rest' | 'jsonrpc' | 'hybrid'

  // DEPRECATED (but still supported):
  // useRestApi: false  // Old flag (if present, maps to apiMode)
}
```

**Compatibility Mapper (in `start()`):**
```javascript
start() {
  // Map legacy config options
  if (this.config.useRestApi === true) {
    this.config.apiMode = 'rest';
    console.warn('[MMM-Webuntis] useRestApi is deprecated, use apiMode instead');
  }
}
```

---

## Phase 1: Core REST API Module

### 1.1 Create REST Client Foundation

**File:** `lib/webuntis-rest-client.js`

**Implementation Steps:**

1. **Authentication Flow** (based on existing `_getRestAuthTokenAndCookies`)
   ```javascript
   async authenticate() {
     // Step 1: Check cache
     if (this._authCache && this._authCache.expiresAt > Date.now() + 60000) {
       return this._authCache;
     }

     // Step 2: JSON-RPC authenticate
     const authResp = await axios.post(/*...*/);

     // Step 3: Extract cookies from Set-Cookie headers
     const cookies = this._extractCookies(authResp.headers['set-cookie']);

     // Step 4: Get Bearer token
     const tokenResp = await axios.get('/api/token/new', {
       headers: { Cookie: cookies }
     });

     // Step 5: Extract metadata from JWT
     const decoded = this._decodeJWT(tokenResp.data);

     // Step 6: Cache with expiration
     this._authCache = {
       token: tokenResp.data,
       cookieString: cookies,
       tenantId: decoded.tenant_id,
       schoolYearId: decoded.schoolYearId || '9', // fallback
       personId: decoded.person_id,
       userId: decoded.user_id,
       expiresAt: decoded.exp * 1000
     };

     this.logger('debug', `REST API authenticated (expires: ${new Date(this._authCache.expiresAt)})`);
     return this._authCache;
   }
   ```

2. **Base Request Method**
   ```javascript
   async _request(method, endpoint, options = {}) {
     const auth = await this.authenticate();

     const config = {
       method,
       url: `https://${this.server}/WebUntis${endpoint}`,
       headers: {
         'Authorization': `Bearer ${auth.token}`,
         'Cookie': auth.cookieString,
         'Accept': 'application/json',
         'Tenant-Id': auth.tenantId,
         'X-Webuntis-Api-School-Year-Id': auth.schoolYearId,
         ...options.headers
       },
       params: options.params,
       data: options.data,
       validateStatus: () => true,
       timeout: options.timeout || 10000
     };

     const startTime = Date.now();
     const resp = await axios(config);
     const duration = Date.now() - startTime;

     this.logger('debug', `${method} ${endpoint} → ${resp.status} (${duration}ms)`);

     if (resp.status !== 200) {
       throw new Error(`REST API error: ${resp.status} ${resp.statusText}`);
     }

     return resp.data;
   }
   ```

3. **Helper Methods**
   ```javascript
   _extractCookies(setCookieHeaders) {
     const cookies = {};
     (setCookieHeaders || []).forEach(setCookie => {
       const [cookie] = setCookie.split(';');
       const [key, value] = cookie.split('=');
       if (key && value) cookies[key.trim()] = value;
     });
     return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
   }

   _decodeJWT(token) {
     const [, payload] = token.split('.');
     return JSON.parse(Buffer.from(payload, 'base64').toString());
   }

   _formatDate(date) {
     const y = date.getFullYear();
     const m = String(date.getMonth() + 1).padStart(2, '0');
     const d = String(date.getDate()).padStart(2, '0');
     return `${y}-${m}-${d}`;
   }

   _formatDateYMD(date) {
     const y = date.getFullYear();
     const m = String(date.getMonth() + 1).padStart(2, '0');
     const d = String(date.getDate()).padStart(2, '0');
     return `${y}${m}${d}`;
   }
   ```

### 1.2 Implement Individual REST Methods

**Following the endpoint mapping from `docs/02-api-reference/REST_ENDPOINTS_OVERVIEW.md`**

#### 1.2.1 Timegrid

```javascript
async getTimegrid() {
  this.logger('info', 'Fetching timegrid via REST API');
  const data = await this._request('GET', '/api/timegrid');
  return Array.isArray(data) ? data : [];
}
```

#### 1.2.2 Timetable (Multiple Strategies)

```javascript
async getTimetable(startDate, endDate, options = {}) {
  const { studentId, useClassTimetable, format = 1 } = options;

  this.logger('info', `Fetching timetable via REST API (${this._formatDate(startDate)} to ${this._formatDate(endDate)})`);

  // Strategy 1: Bearer token endpoint (preferred for parent accounts)
  if (studentId && Number.isFinite(Number(studentId))) {
    try {
      return await this._getTimetableViaBearerToken(startDate, endDate, studentId);
    } catch (err) {
      this.logger('warn', `Bearer token timetable failed: ${err.message}`);
      // Fall through to Strategy 2
    }
  }

  // Strategy 2: Multi-week approach
  return await this._getTimetableViaMultiWeek(startDate, endDate, useClassTimetable);
}

async _getTimetableViaBearerToken(startDate, endDate, studentId) {
  const auth = await this.authenticate();

  const params = {
    start: this._formatDate(startDate),
    end: this._formatDate(endDate),
    format: 1,
    resourceType: 'STUDENT',
    resources: String(studentId),  // MUST be string!
    timetableType: 'WEEK',
    layout: 'CALENDAR'
  };

  const data = await this._request('GET', '/api/rest/view/v1/timetable/entries', { params });

  // Extract lessons from data.data.result.data.elements
  if (data?.data?.result?.data?.elements) {
    return data.data.result.data.elements;
  }

  return [];
}

async _getTimetableViaMultiWeek(startDate, endDate, useClassTimetable) {
  // Round down to Monday
  const start = new Date(startDate);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));

  const weeks = [];
  const current = new Date(start);

  // Generate week list
  while (current <= endDate) {
    weeks.push(this._formatDate(current));
    current.setDate(current.getDate() + 7);
  }

  this.logger('debug', `Fetching ${weeks.length} weeks of timetable data`);

  // Fetch all weeks in parallel
  const promises = weeks.map(weekStart => {
    const endpoint = useClassTimetable
      ? '/api/public/timetable/weekly/data'  // class timetable
      : '/api/public/timetable/weekly/data';  // student timetable

    const params = {
      date: weekStart,
      formatId: 1
    };

    return this._request('GET', endpoint, { params });
  });

  const results = await Promise.all(promises);

  // Merge and filter lessons
  const allLessons = [];
  results.forEach(weekData => {
    if (weekData?.data?.result?.data?.elements) {
      allLessons.push(...weekData.data.result.data.elements);
    }
  });

  // Filter to date range
  const startYMD = parseInt(this._formatDateYMD(startDate));
  const endYMD = parseInt(this._formatDateYMD(endDate));

  return allLessons.filter(lesson => {
    const lessonDate = parseInt(lesson.date);
    return lessonDate >= startYMD && lessonDate <= endYMD;
  });
}
```

#### 1.2.3 Exams

```javascript
async getExams(startDate, endDate, studentId = null) {
  this.logger('info', `Fetching exams via REST API (${this._formatDate(startDate)} to ${this._formatDate(endDate)})`);

  const params = {
    startDate: this._formatDateYMD(startDate),
    endDate: this._formatDateYMD(endDate)
  };

  if (studentId) {
    params.studentId = studentId;
  }

  const data = await this._request('GET', '/api/exams', { params });
  return Array.isArray(data) ? data : [];
}
```

#### 1.2.4 Homework

```javascript
async getHomework(startDate, endDate) {
  this.logger('info', `Fetching homework via REST API (${this._formatDate(startDate)} to ${this._formatDate(endDate)})`);

  const params = {
    startDate: this._formatDateYMD(startDate),
    endDate: this._formatDateYMD(endDate)
  };

  const data = await this._request('GET', '/api/homeworks/lessons', { params });
  return data || { homeworks: [], records: [] };
}
```

#### 1.2.5 Absences

```javascript
async getAbsences(startDate, endDate, studentId = null, excuseStatusId = null) {
  this.logger('info', `Fetching absences via REST API (${this._formatDate(startDate)} to ${this._formatDate(endDate)})`);

  const params = {
    startDate: this._formatDateYMD(startDate),
    endDate: this._formatDateYMD(endDate)
  };

  if (studentId) {
    params.studentId = studentId;
  }

  if (excuseStatusId) {
    params.excuseStatusId = excuseStatusId;
  }

  const data = await this._request('GET', '/api/classreg/absences/students', { params });
  return Array.isArray(data) ? data : [];
}
```

#### 1.2.6 Holidays

```javascript
async getHolidays() {
  this.logger('info', 'Fetching holidays via REST API');
  const data = await this._request('GET', '/api/holidays');
  return Array.isArray(data) ? data : [];
}
```

#### 1.2.7 Messages of Day

```javascript
async getMessagesOfDay(date) {
  this.logger('info', `Fetching messages of day via REST API (${this._formatDateYMD(date)})`);

  const params = {
    date: this._formatDateYMD(date)
  };

  try {
    const data = await this._request('GET', '/api/public/news/newsWidgetData', { params });

    if (data && Array.isArray(data.messagesOfDay) && data.messagesOfDay.length > 0) {
      return data.messagesOfDay;
    }

    // Fallback to HTML scraping (as documented)
    this.logger('warn', 'Messages API returned empty, falling back to HTML parsing');
    return await this._getMessagesOfDayFromHTML(date);

  } catch (err) {
    this.logger('error', `Messages fetch failed: ${err.message}`);
    return [];
  }
}

async _getMessagesOfDayFromHTML(date) {
  // Implementation of HTML fallback
  // See docs/02-api-reference/REST_ENDPOINTS_OVERVIEW.md for details
  // This requires parsing /WebUntis/main.do and extracting data-dojo-props
  this.logger('debug', 'HTML fallback not yet implemented');
  return [];
}
```

#### 1.2.8 Logout

```javascript
async logout() {
  if (!this._authCache) return;

  this.logger('info', 'Logging out via JSON-RPC');

  try {
    await axios.post(
      `https://${this.server}/WebUntis/jsonrpc.do?school=${encodeURIComponent(this.school)}`,
      {
        jsonrpc: '2.0',
        method: 'logout',
        params: {},
        id: 1
      },
      {
        headers: { Cookie: this._authCache.cookieString },
        validateStatus: () => true,
        timeout: 5000
      }
    );
  } catch (err) {
    this.logger('warn', `Logout failed: ${err.message}`);
  } finally {
    this._authCache = null;
  }
}
```

---

## Phase 2: Integration into node_helper.js

### 2.1 Add REST Client Initialization

**Location:** `node_helper.js:start()`

```javascript
start() {
  Log.info('[MMM-Webuntis] Node helper started');

  // Existing cache initialization...
  this._responseCache = new Map();
  this._cacheTTLMs = DEFAULT_CACHE_TTL_MS;
  this._cacheCleanupTimer = null;
  this._cacheCleanupIntervalMs = DEFAULT_CACHE_CLEANUP_INTERVAL_MS;
  this._startCacheCleanup();

  // NEW: REST API client cache
  this._restClients = new Map(); // credKey -> WebUntisRestClient

  // Existing REST auth cache (can be deprecated once REST client is integrated)
  this._restAuthCache = null;
}
```

### 2.2 Create or Get REST Client

**New method in `node_helper.js`:**

```javascript
/**
 * Create or retrieve cached REST API client for given credentials
 * @param {string} credKey - Credential key
 * @param {Object} student - Student config
 * @param {Object} moduleConfig - Module config
 * @returns {WebUntisRestClient}
 */
_getRestClient(credKey, student, moduleConfig) {
  // Check cache
  if (this._restClients.has(credKey)) {
    return this._restClients.get(credKey);
  }

  // Determine credentials
  const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
  const hasOwnCredentials = student.qrcode || (student.username && student.password);
  const isParentMode = hasStudentId && !hasOwnCredentials;

  let config;

  if (isParentMode && moduleConfig.parentUsername) {
    // Parent account credentials
    config = {
      school: moduleConfig.school || student.school,
      username: moduleConfig.parentUsername,
      password: moduleConfig.parentPassword,
      server: moduleConfig.server || student.server || 'webuntis.com',
      logLevel: student.logLevel || 'none',
      logger: (level, msg) => this._mmLog(level, student, msg, 'rest')
    };
  } else if (student.qrcode) {
    // QR code mode - extract credentials from QR code
    // Note: This requires parsing the QR code URL
    // For now, fall back to JSON-RPC for QR codes
    return null;
  } else {
    // Direct student credentials
    config = {
      school: student.school,
      username: student.username,
      password: student.password,
      server: student.server || 'webuntis.com',
      logLevel: student.logLevel || 'none',
      logger: (level, msg) => this._mmLog(level, student, msg, 'rest')
    };
  }

  const WebUntisRestClient = require('./lib/webuntis-rest-client');
  const client = new WebUntisRestClient(config);

  this._restClients.set(credKey, client);
  return client;
}
```

### 2.3 Add API Mode Selection Logic

**New method in `node_helper.js`:**

```javascript
/**
 * Determine which API mode to use for this student
 * @param {Object} student - Student config
 * @param {Object} moduleConfig - Module config
 * @returns {string} 'rest' | 'jsonrpc' | 'hybrid'
 */
_selectApiMode(student, moduleConfig) {
  const configMode = moduleConfig.apiMode || 'auto';

  // Explicit mode selection
  if (configMode === 'rest' || configMode === 'jsonrpc' || configMode === 'hybrid') {
    return configMode;
  }

  // Auto mode: intelligent selection
  if (configMode === 'auto') {
    const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
    const hasParentCredentials = moduleConfig.parentUsername && moduleConfig.parentPassword;
    const isParentMode = hasStudentId && hasParentCredentials;

    // Parent accounts benefit from REST API
    if (isParentMode) {
      return 'hybrid';  // Use REST where possible, fall back to JSON-RPC
    }

    // QR code users: stick with JSON-RPC (simpler for now)
    if (student.qrcode) {
      return 'jsonrpc';
    }

    // Direct student logins: hybrid mode for testing
    return 'hybrid';
  }

  // Default fallback
  return 'jsonrpc';
}
```

### 2.4 Refactor fetchData Method

**Strategy:** Replace individual `untis.getXXX()` calls with mode-aware wrappers

**New wrapper methods:**

```javascript
/**
 * Fetch timegrid using selected API mode
 */
async _fetchTimegrid(untis, restClient, apiMode, student) {
  if (apiMode === 'rest' && restClient) {
    try {
      this._mmLog('debug', student, 'Fetching timegrid via REST', 'rest');
      return await restClient.getTimegrid();
    } catch (err) {
      this._mmLog('error', student, `REST timegrid failed: ${err.message}`, 'rest');
      if (apiMode === 'rest') throw err;  // No fallback in strict REST mode
    }
  }

  // JSON-RPC fallback
  this._mmLog('debug', student, 'Fetching timegrid via JSON-RPC', 'jsonrpc');
  return await untis.getTimegrid();
}

/**
 * Fetch timetable using selected API mode
 */
async _fetchTimetable(untis, restClient, apiMode, student, startDate, endDate) {
  const useClassTimetable = student.useClassTimetable;
  const studentId = student.studentId && Number.isFinite(Number(student.studentId))
    ? Number(student.studentId)
    : null;

  // Try REST first in hybrid/rest mode
  if ((apiMode === 'rest' || apiMode === 'hybrid') && restClient) {
    try {
      this._mmLog('info', student, `Fetching timetable via REST (${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]})`, 'rest');

      const options = {
        studentId,
        useClassTimetable
      };

      const lessons = await restClient.getTimetable(startDate, endDate, options);
      this._mmLog('info', student, `Timetable received via REST: ${lessons.length} lessons`, 'rest');
      return lessons;

    } catch (err) {
      this._mmLog('warn', student, `REST timetable failed: ${err.message}`, 'rest');
      if (apiMode === 'rest') throw err;  // No fallback in strict REST mode
      this._mmLog('info', student, 'Falling back to JSON-RPC', 'hybrid');
    }
  }

  // JSON-RPC fallback
  this._mmLog('debug', student, 'Fetching timetable via JSON-RPC', 'jsonrpc');

  if (studentId) {
    const elementType = 5; // WebUntisElementType.STUDENT
    return await untis.getTimetableForRange(startDate, endDate, studentId, elementType);
  } else if (useClassTimetable) {
    return await untis.getOwnClassTimetableForRange(startDate, endDate);
  } else {
    return await untis.getOwnTimetableForRange(startDate, endDate);
  }
}

/**
 * Fetch exams using selected API mode
 */
async _fetchExams(untis, restClient, apiMode, student, startDate, endDate) {
  const studentId = student.studentId && Number.isFinite(Number(student.studentId))
    ? Number(student.studentId)
    : null;

  if ((apiMode === 'rest' || apiMode === 'hybrid') && restClient) {
    try {
      this._mmLog('debug', student, 'Fetching exams via REST', 'rest');
      const exams = await restClient.getExams(startDate, endDate, studentId);
      this._mmLog('info', student, `Exams received via REST: ${exams.length} items`, 'rest');
      return exams;
    } catch (err) {
      this._mmLog('warn', student, `REST exams failed: ${err.message}`, 'rest');
      if (apiMode === 'rest') throw err;
    }
  }

  // JSON-RPC fallback
  this._mmLog('debug', student, 'Fetching exams via JSON-RPC', 'jsonrpc');
  return await untis.getExamsForRange(startDate, endDate, studentId);
}

/**
 * Fetch homework using selected API mode
 */
async _fetchHomework(untis, restClient, apiMode, student, startDate, endDate) {
  if ((apiMode === 'rest' || apiMode === 'hybrid') && restClient) {
    try {
      this._mmLog('debug', student, 'Fetching homework via REST', 'rest');
      const hw = await restClient.getHomework(startDate, endDate);
      this._mmLog('info', student, `Homework received via REST: ${hw.homeworks?.length || 0} items`, 'rest');
      return hw;
    } catch (err) {
      this._mmLog('warn', student, `REST homework failed: ${err.message}`, 'rest');
      if (apiMode === 'rest') throw err;
    }
  }

  // JSON-RPC fallback
  this._mmLog('debug', student, 'Fetching homework via JSON-RPC', 'jsonrpc');
  const candidates = [
    () => untis.getHomeWorkAndLessons(startDate, endDate),
    () => untis.getHomeWorksFor(startDate, endDate)
  ];

  for (const fn of candidates) {
    try {
      return await fn();
    } catch (err) {
      // Try next candidate
    }
  }

  return null;
}

/**
 * Fetch absences using selected API mode
 */
async _fetchAbsences(untis, restClient, apiMode, student, startDate, endDate, excuseStatusId = null) {
  const studentId = student.studentId && Number.isFinite(Number(student.studentId))
    ? Number(student.studentId)
    : null;

  // Note: Parent account absences may not work via JSON-RPC
  if ((apiMode === 'rest' || apiMode === 'hybrid') && restClient) {
    try {
      this._mmLog('debug', student, 'Fetching absences via REST', 'rest');
      const absences = await restClient.getAbsences(startDate, endDate, studentId, excuseStatusId);
      this._mmLog('info', student, `Absences received via REST: ${absences.length} items`, 'rest');
      return absences;
    } catch (err) {
      this._mmLog('warn', student, `REST absences failed: ${err.message}`, 'rest');
      if (apiMode === 'rest') throw err;
    }
  }

  // JSON-RPC fallback
  this._mmLog('debug', student, 'Fetching absences via JSON-RPC', 'jsonrpc');
  return await untis.getAbsentLesson(startDate, endDate, excuseStatusId);
}

/**
 * Fetch holidays using selected API mode
 */
async _fetchHolidays(untis, restClient, apiMode, student) {
  if ((apiMode === 'rest' || apiMode === 'hybrid') && restClient) {
    try {
      this._mmLog('debug', student, 'Fetching holidays via REST', 'rest');
      const holidays = await restClient.getHolidays();
      this._mmLog('info', student, `Holidays received via REST: ${holidays.length} items`, 'rest');
      return holidays;
    } catch (err) {
      this._mmLog('warn', student, `REST holidays failed: ${err.message}`, 'rest');
      if (apiMode === 'rest') throw err;
    }
  }

  // JSON-RPC fallback
  this._mmLog('debug', student, 'Fetching holidays via JSON-RPC', 'jsonrpc');
  return await untis.getHolidays();
}
```

### 2.5 Update processGroup Method

**Location:** `node_helper.js:~650` (method `processGroup`)

**Changes:**

```javascript
async processGroup(credKey, students, identifier) {
  // Existing credential creation...
  const sample = students[0];
  const untis = this._createUntisClient(sample, this.config);

  // NEW: Determine API mode and create REST client
  const apiMode = this._selectApiMode(sample, this.config);
  const restClient = (apiMode === 'rest' || apiMode === 'hybrid')
    ? this._getRestClient(credKey, sample, this.config)
    : null;

  this._mmLog('info', sample, `Using API mode: ${apiMode}`, apiMode);

  // Existing login logic...
  await untis.login();
  this._mmLog('info', sample, 'Login successful');

  // Fetch data for each student
  for (const student of students) {
    await this.fetchData(untis, restClient, apiMode, student, identifier, credKey);
  }

  // Logout
  try {
    if (restClient && apiMode === 'rest') {
      await restClient.logout();
    } else {
      await untis.logout();
    }
    this._mmLog('info', sample, 'Logout successful');
  } catch (err) {
    this._mmLog('warn', sample, `Logout failed: ${err.message}`);
  }
}
```

### 2.6 Update fetchData Method

**Location:** `node_helper.js:~735` (method `fetchData`)

**Changes:**

```javascript
async fetchData(untis, restClient, apiMode, student, identifier, credKey) {
  // Update signature to include restClient and apiMode

  // Replace all `await untis.getXXX()` calls with wrapper methods:

  // Timegrid
  const timegrid = await this._fetchTimegrid(untis, restClient, apiMode, student);

  // Timetable
  let timetable = [];
  if (student.daysToShow > 0) {
    timetable = await this._fetchTimetable(untis, restClient, apiMode, student, rangeStart, rangeEnd);
  }

  // Exams
  let rawExams = [];
  if (student.examsDaysAhead > 0) {
    rawExams = await this._fetchExams(untis, restClient, apiMode, student, rangeStart, rangeEnd);
  }

  // Homework
  let hwResult = null;
  if (fetchHomeworks) {
    hwResult = await this._fetchHomework(untis, restClient, apiMode, student, new Date(), hwRangeEnd);
  }

  // Absences
  let rawAbsences = [];
  if (fetchAbsences && !isParentAccount) {
    rawAbsences = await this._fetchAbsences(untis, restClient, apiMode, student, absenceStart, absenceEnd);
  }

  // Holidays
  let rawHolidays = [];
  rawHolidays = await this._fetchHolidays(untis, restClient, apiMode, student);

  // ... rest of method unchanged ...
}
```

---

## Phase 3: Testing & Validation

### 3.1 Unit Tests

**File:** `test/webuntis-rest-client.test.js` (new)

**Coverage:**
- Authentication flow (JSON-RPC → token → cache)
- Token expiration and refresh
- Each REST endpoint (mocked)
- Error handling and fallbacks
- Cookie extraction logic
- JWT decoding

### 3.2 Integration Tests

**Update:** `cli/test-webuntis-rest-api.js`

**Add test cases:**
- Compare REST vs JSON-RPC results for same queries
- Verify data structure compatibility
- Test all API modes (rest, jsonrpc, hybrid, auto)
- Parent account scenarios
- QR code scenarios

### 3.3 CLI Testing Tool Enhancement

**File:** `cli/cli.js`

**Add option:**
```javascript
async function main() {
  // ... existing menu ...

  console.log('\n=== API Mode Selection ===');
  console.log('1. Auto (intelligent selection)');
  console.log('2. REST only (experimental)');
  console.log('3. JSON-RPC only (legacy)');
  console.log('4. Hybrid (REST with fallback)');

  const modeChoice = await ask(rl, 'Select API mode [1-4]: ');
  const apiModes = ['auto', 'rest', 'jsonrpc', 'hybrid'];
  config.apiMode = apiModes[parseInt(modeChoice) - 1] || 'auto';

  console.log(`\nUsing API mode: ${config.apiMode}`);
}
```

### 3.4 Validation Checklist

- [ ] All REST endpoints return data in expected format
- [ ] Compact methods (`_compactLessons`, etc.) work with REST data
- [ ] Frontend widgets render correctly with REST data
- [ ] Caching works correctly for both API modes
- [ ] No memory leaks in REST client cache
- [ ] Token refresh happens automatically before expiration
- [ ] Error messages are clear and actionable
- [ ] Logging includes API type indicators
- [ ] Parent accounts work in all API modes
- [ ] QR code authentication still works (JSON-RPC mode)

---

## Phase 4: Documentation & Rollout

### 4.1 Update README.md

**Add section:**

```markdown
## API Mode Configuration

MMM-Webuntis supports multiple API modes for fetching data from WebUntis:

| Mode | Description | Use Case |
|------|-------------|----------|
| `auto` | Intelligent selection (default) | Recommended for all users |
| `rest` | Force REST API only | Testing, parent accounts |
| `jsonrpc` | Force legacy webuntis library | Maximum compatibility |
| `hybrid` | REST with JSON-RPC fallback | Gradual migration |

### Example Configuration

```javascript
{
  module: 'MMM-Webuntis',
  config: {
    apiMode: 'auto',  // ← NEW option

    // Parent account credentials (for REST API)
    parentUsername: 'parent@example.com',
    parentPassword: 'password',
    school: 'school_name',
    server: 'webuntis.com',

    students: [
      { title: 'Child 1', studentId: 12345 },
      { title: 'Child 2', studentId: 67890 }
    ]
  }
}
```

### API Mode Selection Guide

- **Parent accounts with multiple children**: Use `apiMode: 'auto'` or `'hybrid'`
- **Single student, QR code**: Use `apiMode: 'auto'` (falls back to JSON-RPC)
- **Testing REST API**: Use `apiMode: 'rest'` (may fail on some servers)
- **Maximum compatibility**: Use `apiMode: 'jsonrpc'`
```

### 4.2 Create Migration Guide

**File:** `docs/01-getting-started/MIGRATION_GUIDE.md` (new)

**Content:**
- Why migrate to REST API
- Benefits (better parent support, more features, faster)
- Step-by-step upgrade instructions
- Troubleshooting common issues
- How to roll back if needed

### 4.3 Update CHANGELOG.md

```markdown
## [Unreleased]

### Added
- REST API support as alternative to webuntis library
- New `apiMode` configuration option (`auto`, `rest`, `jsonrpc`, `hybrid`)
- Improved parent account support via REST API
- Enhanced logging with API type indicators ([REST API] / [JSON-RPC])
- Bearer token authentication with automatic refresh

### Changed
- Timetable fetching now uses REST API for parent accounts (with JSON-RPC fallback)
- All API calls now logged with source indicator for debugging

### Deprecated
- Direct dependency on `webuntis` npm library (will be optional in future versions)

### Migration Notes
- Existing configurations continue to work without changes
- To enable REST API, add `apiMode: 'auto'` to config
- See docs/01-getting-started/MIGRATION_GUIDE.md for details
```

---

## Phase 5: Deprecation & Cleanup (Future)

### 5.1 Make webuntis Library Optional

**Timeline:** After 6 months of REST API stability

**Changes in package.json:**
```json
{
  "dependencies": {
    "axios": "^1.7.0",
    "axios-cookiejar-support": "^6.0.5",
    "tough-cookie": "^6.0.0",
    "otplib": "^12.0.1"
  },
  "optionalDependencies": {
    "webuntis": "^2.2.1"  // ← Moved to optional
  }
}
```

**Graceful degradation:**
```javascript
// In node_helper.js
const WEBUNTIS_AVAILABLE = (() => {
  try {
    require('webuntis');
    return true;
  } catch {
    return false;
  }
})();

// When creating untis client:
if (apiMode === 'jsonrpc' && !WEBUNTIS_AVAILABLE) {
  throw new Error('webuntis library not installed. Install with: npm install webuntis');
}
```

### 5.2 Remove Compatibility Code

**After 12 months:**
- Remove JSON-RPC fallback code
- Remove `_createUntisClient` method
- Remove webuntis library from dependencies entirely
- Update all documentation to REST-only approach

---

## Risk Assessment & Mitigation

### High Risk Items

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| REST API returns different data format than JSON-RPC | High | Medium | Extensive testing, fallback to JSON-RPC in hybrid mode |
| Token refresh fails in production | High | Low | Implement retry logic, cache tokens conservatively |
| Parent account REST endpoints unavailable on some servers | Medium | Medium | Hybrid mode as default, JSON-RPC fallback |
| Memory leak in REST client cache | Medium | Low | Implement proper cleanup, monitor in production |
| Breaking change for existing users | High | Low | Feature flag, backward compatibility, extensive testing |

### Mitigation Strategies

1. **Extensive Testing Period**
   - 4-6 weeks of testing in hybrid mode before enabling REST by default
   - Community beta testing with diverse WebUntis server versions

2. **Gradual Rollout**
   - Phase 1: Hybrid mode available (opt-in)
   - Phase 2: Hybrid mode as default (JSON-RPC fallback available)
   - Phase 3: REST mode as default (JSON-RPC still available)
   - Phase 4: REST mode only (webuntis library optional)

3. **Monitoring & Logging**
   - Enhanced logging shows which API is used for each call
   - Error tracking with API mode context
   - Performance metrics (response times, cache hit rates)

4. **Rollback Plan**
   - Simple config change to revert to JSON-RPC mode
   - No database/state migrations required
   - Documentation for rollback procedure

---

## Success Metrics

### Technical Metrics

- [ ] 100% feature parity between REST and JSON-RPC modes
- [ ] < 5% performance regression (target: 20% improvement)
- [ ] Zero increase in error rate
- [ ] 90% cache hit rate for bearer tokens
- [ ] < 100ms overhead for token refresh

### User Experience Metrics

- [ ] No reported breaking changes for existing configs
- [ ] Parent account users report improved reliability
- [ ] Reduced "data not loading" issues (especially for parent accounts)
- [ ] Clear, actionable error messages in logs

### Code Quality Metrics

- [ ] 80%+ code coverage for REST client
- [ ] All ESLint rules passing
- [ ] Zero new security vulnerabilities
- [ ] Documentation coverage for all new features
- [ ] Spell check passing (`node --run test:spelling`)

---

## Timeline & Milestones

### Week 1: Phase 0 - Preparation
- [x] Documentation review (this document)
- [ ] Create `lib/webuntis-rest-client.js` skeleton
- [ ] Set up logging enhancements
- [ ] Add `apiMode` config option

### Week 2-3: Phase 1 - Core REST Module
- [ ] Implement authentication flow
- [ ] Implement all REST endpoints
- [ ] Add error handling and retries
- [ ] Unit tests for REST client

### Week 4-6: Phase 2 - Integration
- [ ] Integrate REST client into `node_helper.js`
- [ ] Implement wrapper methods
- [ ] Update `fetchData` method
- [ ] Integration tests

### Week 7: Phase 3 - Testing
- [ ] Community beta testing
- [ ] Bug fixes
- [ ] Performance optimization
- [ ] Documentation review

### Week 8+: Phase 4 - Rollout
- [ ] Merge to master branch
- [ ] Release v0.5.0 (hybrid mode available)
- [ ] Monitor production usage
- [ ] Gather feedback

### Future: Phase 5 - Deprecation
- [ ] v0.6.0: Make webuntis library optional (6 months)
- [ ] v1.0.0: REST-only, remove JSON-RPC fallbacks (12 months)

---

## Open Questions

### Technical Questions

1. **QR Code Support in REST Mode**
   - Can we extract credentials from QR code to use with REST API?
   - Or should QR codes always use JSON-RPC mode?
   - **Decision:** Keep QR codes on JSON-RPC for now (simpler)

2. **Messages of Day HTML Fallback**
   - Should we implement the HTML scraping fallback?
   - What's the priority vs. effort?
   - **Decision:** Implement basic version, log warning if used frequently

3. **Token Refresh Strategy**
   - Proactive refresh before expiration, or reactive on 401?
   - **Decision:** Proactive with 1-minute buffer

4. **Multi-Instance Coordination**
   - How to handle multiple MagicMirror instances with same credentials?
   - Should we share token cache across instances?
   - **Decision:** Each instance maintains its own cache (simpler)

### Product Questions

1. **Default API Mode**
   - Should `auto` mode default to `hybrid` or `jsonrpc`?
   - **Decision:** `hybrid` for parent accounts, `jsonrpc` for others

2. **Feature Flag Visibility**
   - Should `apiMode` be prominently documented or hidden?
   - **Decision:** Document clearly, encourage `auto` mode

3. **Deprecation Timeline**
   - Is 12 months enough for JSON-RPC deprecation?
   - **Decision:** Re-evaluate after 6 months based on adoption

---

## Additional Considerations

### 1. Error Handling Philosophy

**Principle:** Fail gracefully, log extensively, never crash MagicMirror

**Implementation:**
- All REST calls wrapped in try-catch
- Fallback to JSON-RPC in hybrid mode
- Empty arrays returned on error (never null/undefined)
- Clear error messages in logs with API context

### 2. Performance Optimization

**Strategies:**
- Parallel requests where possible (multi-week timetable fetches)
- Aggressive token caching (15-minute lifetime, refresh at 14 minutes)
- Response caching at node_helper level (existing mechanism)
- Reuse axios instances per credential

**Monitoring:**
- Log request durations
- Track cache hit rates
- Alert on slow responses (>2 seconds)

### 3. Security Considerations

**Critical Points:**
- Never log credentials or bearer tokens
- Clear token cache on logout
- Validate all user inputs before sending to API
- Use HTTPS only (already enforced by WebUntis)
- Implement request timeout (10 seconds max)

**Audit Checklist:**
- [ ] No credentials in logs
- [ ] No tokens in logs
- [ ] No sensitive data in error messages
- [ ] Secure token storage (memory only, cleared on logout)
- [ ] HTTPS enforcement
- [ ] Input validation for all parameters

### 4. Backward Compatibility Matrix

| Configuration Pattern | JSON-RPC Mode | REST Mode | Hybrid Mode |
|----------------------|---------------|-----------|-------------|
| QR code only | ✅ Works | ❌ Not supported | ✅ Falls back to JSON-RPC |
| Student credentials | ✅ Works | ✅ Works | ✅ Works |
| Parent + studentId | ⚠️ Limited | ✅ Works | ✅ Optimal |
| Legacy config keys | ✅ Works | ✅ Works | ✅ Works |
| No apiMode specified | ✅ Default | N/A | N/A |

### 5. Logging Enhancement Details

**Log Levels:**
- `debug`: Individual API calls with parameters and duration
- `info`: Major operations (login, logout, data fetch complete)
- `warn`: Fallbacks, degraded functionality, recoverable errors
- `error`: Unrecoverable errors, failed operations

**Log Format:**
```
[MMM-Webuntis] [REST API] Fetching timetable for student 12345 (2025-12-15 to 2025-12-19)
[MMM-Webuntis] [REST API] GET /api/rest/view/v1/timetable/entries → 200 (523ms)
[MMM-Webuntis] [REST API] Timetable received: 24 lessons
[MMM-Webuntis] [HYBRID] REST timetable failed: 404 Not Found
[MMM-Webuntis] [HYBRID] Falling back to JSON-RPC
[MMM-Webuntis] [JSON-RPC] Timetable received: 24 lessons
```

### 6. CLI Tool Enhancements

**New Commands:**
```bash
# Test specific API mode
node cli/cli.js --api-mode rest

# Compare REST vs JSON-RPC results
node cli/cli.js --compare-apis

# Benchmark API performance
node cli/cli.js --benchmark

# Validate configuration for REST API
node cli/cli.js --validate-rest-config
```

---

## Appendix A: File Structure (After Migration)

```
MMM-Webuntis/
├── lib/
│   └── webuntis-rest-client.js     ← NEW: REST API client
├── cli/
│   ├── cli.js                       ← UPDATED: Add API mode selection
│   └── test-webuntis-rest-api.js   ← UPDATED: Add comparison tests
├── docs/
│   ├── 01-getting-started/
│   │   └── MIGRATION_GUIDE.md      ← NEW: Migration documentation
│   └── 03-implementation/
│       └── DETAILED_MIGRATION_PLAN.md  ← THIS FILE
├── test/                            ← NEW: Test directory
│   └── webuntis-rest-client.test.js
├── MMM-Webuntis.js                  ← UPDATED: Add apiMode to defaults
├── node_helper.js                   ← UPDATED: Major refactoring
└── package.json                     ← UPDATED: Eventually remove webuntis dep
```

---

## Appendix B: REST API Quick Reference

| Data Type | REST Endpoint | Params | Auth |
|-----------|---------------|--------|------|
| Timegrid | `/api/timegrid` | - | Session |
| Timetable (Bearer) | `/api/rest/view/v1/timetable/entries` | start, end, resourceType, resources | Bearer + Session |
| Timetable (Weekly) | `/api/public/timetable/weekly/data` | date, formatId | Session |
| Exams | `/api/exams` | startDate, endDate, studentId | Session |
| Homework | `/api/homeworks/lessons` | startDate, endDate | Session |
| Absences | `/api/classreg/absences/students` | startDate, endDate, studentId | Session |
| Holidays | `/api/holidays` | - | Session |
| Messages | `/api/public/news/newsWidgetData` | date | Session |
| Token | `/api/token/new` | - | Session |
| Auth | `/jsonrpc.do?school={school}` | JSON-RPC | None |

---

## Appendix C: Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2025-12-19 | Use feature flag (`apiMode`) | Allows gradual migration, easy rollback |
| 2025-12-19 | Default to `auto` mode | Intelligent selection based on account type |
| 2025-12-19 | Keep QR codes on JSON-RPC | Simpler implementation, low priority |
| 2025-12-19 | Implement hybrid mode | Safety net for production deployments |
| 2025-12-19 | Create separate REST client class | Clean separation, easier testing |
| 2025-12-19 | Token refresh at 14 minutes | 1-minute buffer before 15-minute expiration |
| 2025-12-19 | Parallel multi-week fetches | Performance optimization for date ranges |
| 2025-12-19 | HTML fallback for messages | Documented issue, low implementation cost |

---

## Appendix D: References

### Internal Documentation
- [Implementation Reference](../01-getting-started/IMPLEMENTATION_REFERENCE.md)
- [Bearer Token Guide](../02-api-reference/BEARER_TOKEN_GUIDE.md)
- [REST Endpoints Overview](../02-api-reference/REST_ENDPOINTS_OVERVIEW.md)
- [REST Implementation Guide](REST_IMPLEMENTATION_GUIDE.md)
- [Original Migration Plan](REST_MIGRATION_PLAN.md)

### External Resources
- WebUntis API (undocumented, reverse-engineered)
- MagicMirror² Module Development: https://docs.magicmirror.builders/development/module-development.html
- Node.js Best Practices: https://github.com/goldbergyoni/nodebestpractices

---

**Document Status:** ✅ READY FOR IMPLEMENTATION
**Next Action:** Begin Phase 0.2 - Create REST API Wrapper Class
**Responsible:** Development Team
**Target Date:** 2025-12-26 (Week 1 completion)
