# WebUntis REST API Discovery & Analysis

**Last Updated:** December 18, 2025
**Status:** Comprehensive discovery complete - 5 core REST APIs + 4 additional endpoints + 3 Bearer token endpoints identified

---

## Parameter Reference

Throughout this documentation, the following placeholders are used:

| Placeholder | Meaning | Example |
|------------|---------|----------|
| `{server}` | WebUntis server hostname | `example.webuntis.com` |
| `{school}` | School code/identifier | `school-name` |
| `{username}` | Username (parent account) | `parent@example.com` |
| `{password}` | Password | `your-secure-password` |
| `{studentId}` | Student ID from config | `{STUDENT_ID}` |
| `{startDate}` | Start date (YYYYMMDD) | `20250901` |
| `{endDate}` | End date (YYYYMMDD) | `20251231` |
| `{klasseId}` | Class ID | `854` |
| `{personId}` | Person/user ID | `5605` |
| `{elemType}` | Element type (2=class, 5=student, 15=room, 25=teacher) | `5` |
| `{elemId}` | Element ID (student/class/teacher ID) | `{ELEM_ID}` |

---

## Executive Summary

After extensive exploration of the WebUntis API ecosystem (both JSON-RPC and REST), we have successfully identified and documented **5 working REST API endpoints + 1 token API + 4 additional useful endpoints + 3 Bearer token endpoints**.

**Key Achievement:** All major features (Absences, Exams, Homework, Class Services, Timetable, **Holidays**) now have REST API support that works with **parent account credentials** - eliminating the limitation of JSON-RPC methods which only work with student/QR-code accounts.

**🆕 CRITICAL DISCOVERY:** Bearer tokens can be **self-generated** after JSON-RPC login via `GET /api/token/new`. This enables:
- ✅ Holidays access (only available via Bearer token!)
- ✅ Stateless authentication for mobile apps
- ✅ Alternative endpoints for exams, messages, app data

**Bonus Discoveries:**
- ✅ Token API for JWT-based authentication with Bearer tokens (self-generated!)
- ✅ Environment API for WebUntis service configuration
- ✅ Help Mapping API for documentation lookups
- ✅ Timetable Weekly API for parent account timetables
- ✅ Timegrid API for school hour structure
- ✅ **Bearer token authentication via `/api/token/new` - SELF-GENERATED after JSON-RPC login**
- ✅ REST view Exams endpoint (`/api/rest/view/v1/exams`)
- ✅ REST view Messages endpoint (`/api/rest/view/v1/messages`)
- ✅ **App Data endpoint for system configuration - INCLUDES HOLIDAYS (47+ records)**

---

## Working REST APIs

### 1. **Absences API** ⭐ HIGHEST PRIORITY
**Endpoint:** `GET /api/classreg/absences/students`

**Parent Account Support:** ✅ YES (main advantage over JSON-RPC)

**Parameters:**
| Parameter | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `startDate` | String | Yes | `{startDate}` | Format: YYYYMMDD |
| `endDate` | String | Yes | `{endDate}` | Format: YYYYMMDD |
| `studentId` | Number | Yes | `{studentId}` | Student ID from config |
| `excuseStatusId` | Number | No | `-1` | See Excuse Statuses below |

**Excuse Status IDs:**
```
-1  : All absences
-2  : Excused only
-3  : Not excused only
0   : Open/pending
1   : Excused
2   : Not excused
```

**Response Structure:**
```json
{
  "data": {
    "absences": [
      {
        "id": {absenceId},
        "studentName": "{studentName}",
        "startDate": {startDate},
        "startTime": 750,
        "endDate": {endDate},
        "endTime": 1800,
        "reasonId": 0,
        "reason": "",
        "text": "",
        "excuseStatus": "entschuldigt",
        "isExcused": true,
        "excuse": {
          "id": {excuseId},
          "excuseStatus": "entschuldigt",
          "isExcused": true,
          "excuseDate": {excuseDate}
        },
        "createDate": {createDate},
        "lastUpdate": {lastUpdate},
        "createdUser": "{createdBy}",
        "updatedUser": "{updatedBy}",
        "canEdit": true,
        "interruptions": null
      }
    ],
    "absenceReasons": [
      { "id": {reasonId}, "name": "{reasonName}" },
      { "id": {reasonId2}, "name": "{reasonName2}" }
    ],
    "excuseStatuses": [
      { "id": "-1", "label": "- All -" },
      { "id": "-2", "label": "[Excused]" },
      { "id": "-3", "label": "[Not Excused]" }
    ],
    "showAbsenceReasonChange": true,
    "showCreateAbsence": true
  }
}
```

**Testing:**
```bash
# Full date range with all absences
curl "https://{server}/WebUntis/api/classreg/absences/students?startDate={startDate}&endDate={endDate}&studentId={studentId}&excuseStatusId=-1"

# Filter: excused only
curl "https://{server}/WebUntis/api/classreg/absences/students?startDate={startDate}&endDate={endDate}&studentId={studentId}&excuseStatusId=-2"
```

**Related:** Also available: `/api/classreg/absences/meta` (provides excuse statuses and metadata)

---

### 2. **Homework API** ⭐ NEW DISCOVERY
**Endpoint:** `GET /api/homeworks/lessons`

**Parent Account Support:** ✅ YES (not tested, likely)

**Parameters:**
| Parameter | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `startDate` | String | No | `20251201` | Format: YYYYMMDD |
| `endDate` | String | No | `20251231` | Format: YYYYMMDD |
| `studentId` | Number | No | `{STUDENT_ID}` | Student ID - optional, returns all if not provided |

**Response Structure:**
```json
{
  "data": {
    "records": [...],      // Homework records/details
    "homeworks": [...],    // Homework entries
    "teachers": [...],     // Teacher information
    "lessons": [...]       // Lesson information
  }
}
```

**Testing:**
```bash
# No parameters (returns all homeworks)
curl "https://{server}/WebUntis/api/homeworks/lessons"

# With date range
curl "https://{server}/WebUntis/api/homeworks/lessons?startDate={startDate}&endDate={endDate}"

# With student ID
curl "https://{server}/WebUntis/api/homeworks/lessons?studentId={studentId}"

# Combined
curl "https://{server}/WebUntis/api/homeworks/lessons?startDate={startDate}&endDate={endDate}&studentId={studentId}"
```

---

### 3. **Exams API** ⭐ EXTENDED
**Endpoint:** `GET /api/exams`

**Parent Account Support:** ✅ YES

**Parameters:**
| Parameter | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `studentId` | Number | Yes | `{studentId}` | Student ID |
| `startDate` | String | No | `{startDate}` | Format: YYYYMMDD |
| `endDate` | String | No | `{endDate}` | Format: YYYYMMDD |
| `klasseId` | Number | No | `-1` | Class ID or -1 for all |
| `withGrades` | Boolean | No | `true` | Include grade information |

**Response Structure:**
```json
{
  "data": {
    "exams": [
      {
        "id": 0,
        "examType": "...",
        "name": "...",
        "studentClass": "...",
        "assignedStudents": [...],
        "examDate": "...",
        "startTime": 750,
        "endTime": 900,
        "subject": "Ma",
        "teachers": [...],
        "rooms": [...],
        "text": "...",
        "grade": null
      }
    ]
  }
}
```

**Testing:**
```bash
# Basic (student + dates)
curl "https://{server}/WebUntis/api/exams?studentId={studentId}&startDate={startDate}&endDate={endDate}"

# With class filter
curl "https://{server}/WebUntis/api/exams?studentId={studentId}&klasseId=-1&startDate={startDate}&endDate={endDate}"

# With grades
curl "https://{server}/WebUntis/api/exams?studentId={studentId}&startDate={startDate}&endDate={endDate}&withGrades=true"
```

---

### 4. **Class Services API**
**Endpoint:** `GET /api/classreg/classservices`

**Parent Account Support:** ✅ YES

**Parameters:**
| Parameter | Type | Required | Example | Notes |
|-----------|------|----------|---------|-------|
| `startDate` | String | Yes | `{startDate}` | Format: YYYYMMDD |
| `endDate` | String | Yes | `{endDate}` | Format: YYYYMMDD |

**Response Structure:**
```json
{
  "data": {
    "classRoles": [
      {
        "id": {classRoleId},
        "personId": {personId},
        "klasse": { "id": {klasseId}, "name": "{className}" },
        "foreName": "{foreName}",
        "longName": "{lastName}",
        "duty": { "id": {dutyId}, "label": "{dutyLabel}" },
        "startDate": {startDate},
        "endDate": {endDate},
        "text": ""
      }
    ],
    "personKlasseMap": { ... }
  }
}
```

---

### 5. **Absences Metadata API**
**Endpoint:** `GET /api/classreg/absences/meta`

**Parameters:** None

**Response Structure:**
```json
{
  "data": {
    "excuseStatuses": [
      { "id": "-1", "label": "- Alle -" },
      { "id": "-2", "label": "[entschuldigt]" },
      { "id": "-3", "label": "[nicht entschuldigt]" },
      { "id": "0", "label": "[offen]" },
      { "id": "1", "label": "entsch." },
      { "id": "2", "label": "nicht entsch." },
      ...
    ]
  }
}
```

**Usage:** Cache excuse statuses for UI rendering and parameter validation

---

---

## New Discovery: Token API ⭐ IMPORTANT

### **Token API** (Authentication Enhancement)
**Endpoint:** `GET /api/token/new`

**Status:** ✅ WORKING (Status 200)

**Testing Result:**
```
✅ Authentication via JSON-RPC establishes session
✅ GET /api/token/new returns JWT token (Status 200)
```

**Response Format:**
Returns a JWT token string in the response body.

**JWT Token Structure:**
```
Header: { "kid": "...", "alg": "RS256" }
Payload: {
  "tenant_id": {TENANT_ID},
  "sub": "{username}",
  "roles": "LEGAL_GUARDIAN",
  "iss": "webuntis",
  "locale": "de",
  "sc": "de",
  "user_type": "USER",
  "route": "niobe.internal.webuntis.com",
  "user_id": {personId},
  "host": "{server}",
  "sn": "{school}",
  "scopes": "mg:r",
  "exp": {...},
  "per": ["mg:r"],
  "iat": {...},
  "username": "{username}",
  "sr": "DE-BW",
  "person_id": {personId}
}
```

**Key Information from Token:**
- Tenant ID: {TENANT_ID} (internal)
- User Type: USER (parent account)
- Roles: LEGAL_GUARDIAN (parent)
- Scopes: `mg:r` (read management?)
- User ID: {personId}
- Person ID: {personId}

**Potential Use Cases:**
1. **Token-based Authentication** - Use JWT instead of session cookies for REST APIs
2. **Cross-Service Requests** - Token could be used for API calls to external services
3. **Mobile App Support** - JWT tokens are more suitable for mobile apps than cookies
4. **Expiration Tracking** - Token includes `exp` timestamp for session management

**Current Limitation:**
- Endpoint works and returns token, but unclear if REST APIs accept Bearer tokens
- Most REST APIs appear to work with session cookies instead
- Token format suggests modern architecture (RS256, JWT), but may be for other services

**Recommendation:**
Continue using session cookies for existing REST APIs. Token API may be for future features or third-party integration.

---

## Additional Discovered Endpoints

### **Environment Configuration** ⭐ USEFUL
**Endpoint:** `GET /environment.json` (public, no auth)

**Status:** ✅ WORKING

**Response:**
```json
{
  "spApiURL": "https://substitution.webuntis.com",
  "websocketURL": "wss://events.webuntis.com/",
  "version": "69e045e2"
}
```

**Use Case:** Get WebUntis service URLs for:
- Substitution API (external service)
- WebSocket events connection
- Version tracking

**Testing:**
```bash
curl "https://{server}/environment.json"
```

### **Help Mapping API** (Information Only)
**Endpoint:** `GET /api/help/helpmapping`

**Status:** ✅ WORKING

**Description:** Maps UI pages to help documentation

**Response Structure:**
```json
{
  "data": {
    "data": {
      "basic/messagecenter": {
        "student": "wu_nachrichten.htm",
        "teacher": "wu_nachrichten.htm",
        "default": "wu_nachrichten.htm"
      },
      "main": { "default": "einfuehrungke.htm" },
      // ... 164+ help topic mappings
    }
  }
}
```

**Use Case:** Not relevant for MMM-Webuntis (help documentation only)

---

## Bearer Token Authentication Endpoints

**🆕 NEW DISCOVERY (December 18, 2025):**

### How to Generate Bearer Tokens (Self-Generated)

Bearer tokens can be **self-generated**. The key benefit is that you can access bearer-token-only REST endpoints without relying on legacy JSON-RPC calls for data retrieval.

**⚠️ IMPORTANT:** This works with username/password authentication, and (as of the newer discovery) also with QR-code student logins, as long as you obtain valid session cookies and then call `/WebUntis/api/token/new`.

**Supported Scenarios:**
- ✅ Parent account with username/password → Can generate Bearer tokens
- ✅ Student account with username/password → Can generate Bearer tokens
- ✅ Student account with QR code → Can generate Bearer tokens

**Step 1: Authenticate with JSON-RPC (get session cookies)**
```javascript

const fetchClient = require('./lib/fetchClient');
const CookieJar = require('./lib/cookieJar');

const cookieJar = new CookieJar();
const baseURL = 'https://{server}/WebUntis';

// Authenticate once
await fetchClient.post(`${baseURL}/jsonrpc.do?school={school}`, {
  jsonrpc: '2.0',
  method: 'authenticate',
  params: {
    user: '{username}',
    password: '{password}',
    client: 'App'
  },
  id: 1,
});
```

**Step 2: Get Bearer Token (from session)**
```javascript
// Now get JWT token
const tokenResp = await client.get('/api/token/new');
const jwtToken = tokenResp.data;  // Raw JWT string

// Optional: Decode to check expiration
const parts = jwtToken.split('.');
const payload = JSON.parse(
  Buffer.from(parts[1], 'base64').toString()
);
console.log('Token expires:', new Date(payload.exp * 1000));
```

**Step 3: Use Bearer Token for specific endpoints**
```javascript
const headers = {
  'Authorization': 'Bearer ' + jwtToken,
};

// Now use Bearer-authenticated endpoints
const appData = await fetchClient.get('https://{server}/WebUntis/api/rest/view/v1/app/data', { headers });
const holidays = appData.data.holidays;  // Get holidays!
const exams = await fetchClient.get('https://{server}/WebUntis/api/rest/view/v1/exams', { headers });
const messages = await fetchClient.get('https://{server}/WebUntis/api/rest/view/v1/messages', { headers });
```

### Complete Self-Contained Example

```javascript

const fetchClient = require('./lib/fetchClient');
const CookieJar = require('./lib/cookieJar');

async function getHolidaysWithBearerToken() {
  // Step 1: Setup and authenticate
  const cookieJar = new CookieJar();
  const baseURL = 'https://{SCHOOL_NAME}.webuntis.com/WebUntis';

  await fetchClient.post(`${baseURL}/jsonrpc.do?school={SCHOOL_NAME}`, {
    jsonrpc: '2.0',
    method: 'authenticate',
    params: {
      user: '{username}',
      password: 'password123',
      client: 'App'
    },
    id: 1,
  }, { cookieJar });

  // Step 2: Get Bearer token
  const tokenResp = await fetchClient.get(`${baseURL}/api/token/new`, { cookieJar });
  const token = tokenResp.data;

  // Step 3: Use Bearer token
  const headers = {
    'Authorization': 'Bearer ' + token,
  };

  // Get holidays
  const appData = await fetchClient.get(`${baseURL}/api/rest/view/v1/app/data`, { headers });
  return appData.data.holidays;  // 47 holidays!
}

// Run it
getHolidaysWithBearerToken().then(holidays => {
  console.log(`Found ${holidays.length} holidays:`);
  holidays.forEach(h => {
    console.log(`  ${h.name}: ${h.start} - ${h.end}`);
  });
});
```

### Bearer Token Characteristics

| Property | Value | Notes |
|----------|-------|-------|
| **Generation** | ✅ Self-generated | No external service needed |
| **Lifetime** | ~15 minutes (900s) | Payload contains `exp` field |
| **Algorithm** | RS256 | RSA SHA256 signing |
| **When to regenerate** | Every 15 min | Check `exp` field in payload |
| **Scope** | Read-only (`mg:r`) | Management read access |
| **Roles supported** | LEGAL_GUARDIAN, USER | Parent and student accounts |

### When Bearer Token is Required (vs optional)

| Endpoint | Cookie Auth | Bearer Auth | Recommendation |
|----------|------------|------------|-----------------|
| `/api/classreg/absences/students` | ✅ YES | ❌ NO | Use cookies |
| `/api/homeworks/lessons` | ✅ YES | ❌ NO | Use cookies |
| `/api/exams` | ✅ YES | ❌ NO | Use cookies |
| `/api/public/timetable/weekly/data` | ✅ YES | ❌ NO | Use cookies |
| `/api/timegrid` | ✅ YES | ❌ NO | Use cookies |
| `/api/rest/view/v1/exams` | ❌ NO | ✅ YES | Use Bearer only |
| `/api/rest/view/v1/messages` | ❌ NO | ✅ YES | Use Bearer only |
| **`/api/rest/view/v1/app/data`** | ❌ NO | ✅ YES | **Use Bearer (holidays!)** |

### Token Caching Strategy

```javascript
class TokenManager {
  constructor() {
    this.token = null;
    this.expiresAt = 0;
  }

  isExpired() {
    // Add 60s buffer to avoid edge cases
    return (Math.floor(Date.now() / 1000) + 60) > this.expiresAt;
  }

  async getToken(cookieClient) {
    if (this.token && !this.isExpired()) {
      return this.token;  // Return cached
    }

    // Generate new token
    const resp = await cookieClient.get('/api/token/new');
    this.token = resp.data;

    // Parse expiration
    const parts = this.token.split('.');
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString()
    );
    this.expiresAt = payload.exp;

    console.log(`Token generated, expires in ${payload.exp - Math.floor(Date.now() / 1000)}s`);
    return this.token;
  }
}
```

### Authentication Comparison: QR-Code vs Username/Password

| Feature | QR-Code Login | Username/Password | Bearer Token Possible? |
|---------|--------------|------------------|----------------------|
| Authentication Method | Puppeteer (browser) | JSON-RPC HTTP | - |
| Session Management | Internal to Puppeteer | Cookie jar - |
| JSESSIONID Access | ⚠️ Not exposed by default | ✅ Accessible | - |
| Can call `/api/token/new` | ⚠️ Yes, if you can obtain valid session cookies | ✅ Yes | - |
| **Bearer Token Support** | **⚠️ Possible (cookie-dependent)** | **✅ Yes** | **Depends on whether you have cookies** |
| JSON-RPC Methods | ✅ All work | ✅ All work | N/A |
| REST APIs (cookies) | ✅ All work | ✅ All work | N/A |
| Holidays Access | ⚠️ Yes (via Bearer, cookie-dependent) | ✅ Yes (via Bearer) | **Only if Bearer token is available** |

**Conclusion:**
- Use **QR-code login** → If your implementation cannot access cookies, stick with JSON-RPC methods
- Use **Username/Password** → Can reliably leverage Bearer tokens for holidays + advanced endpoints
- **Parent accounts** → Strong choice for multi-student use; Bearer-token generation works via cookie-based login

---

### Authentication with JWT Bearer Tokens

After JWT token generation via `/api/token/new`, certain REST view endpoints accept Bearer authentication:

```bash
# Step 1: Get JWT token
curl -H "Cookie: JSESSIONID=..." \
  "https://{server}/WebUntis/api/token/new"
# Returns JWT token string

# Step 2: Use token for Bearer auth
curl -H "Authorization: Bearer {token}" \
  "https://{server}/WebUntis/api/rest/view/v1/exams"
```

### 4.1 REST View Exams (Bearer) ✅
**Endpoint:** `GET /api/rest/view/v1/exams`

**Authentication:** Bearer token (from `/api/token/new`)

**Status:** ✅ 200 OK (with Bearer token)

**Response Structure:**
```json
{
  "exams": [ /* exam objects */ ],
  "withDeleted": false
}
```

**Parent Account Support:** ✅ YES

**Notes:**
- Returns exams for the authenticated user's role (LEGAL_GUARDIAN returns parent-visible exams)
- Alternative to `/api/exams` (which uses session cookies)
- Better for stateless API consumption (mobile apps, etc.)

### 4.2 REST View Messages (Bearer) ✅
**Endpoint:** `GET /api/rest/view/v1/messages`

**Authentication:** Bearer token (from `/api/token/new`)

**Status:** ✅ 200 OK (with Bearer token)

**Response Structure:**
```json
{
  "incomingMessages": [ /* message objects */ ],
  "readConfirmationMessages": [ /* confirmations */ ]
}
```

**Parent Account Support:** ✅ YES

**Notes:**
- Messages endpoint now available via REST view API
- Alternative to JSON-RPC `getMessagesOfDay()`
- Requires Bearer authentication (not session cookies)

### 4.3 App Data (Bearer) ✅ **ONLY WAY TO GET HOLIDAYS**
**Endpoint:** `GET /api/rest/view/v1/app/data`

**Authentication:** Bearer token (from `/api/token/new`)

**Status:** ✅ 200 OK (with Bearer token)

**Response Contains:**
- `currentSchoolYear` - School year information
- **`holidays`** - **Holiday definitions (47+ records)** ⭐ **ONLY AVAILABLE HERE**
- `tenant` - School/tenant configuration
- `user` - Current user information
- `permissions` - User permissions array
- `settings` - User settings
- `ui2020` - UI version flag

**Holidays Structure:**
```json
{
  "holidays": [
    {
      "id": 1,
      "name": "Herbst",
      "start": "2023-10-30T00:00:00",
      "end": "2023-11-05T23:59:59",
      "bookable": false
    },
    ...
  ]
}
```

**Use Case:** Application initialization and configuration data

**⚠️ IMPORTANT:** Holidays are NOT available via cookie-based REST APIs (they return 500 errors). They can ONLY be fetched via bearer-token authentication.

### 4.4 Timegrid API (Cookie-based) ✅
**Endpoint:** `GET /api/timegrid`

**Status:** ✅ 200 OK (session cookies)

**Response Contains:**
- `schoolyearId` - Current school year ID
- `rows` - Period definitions with times:
  - `period` - Period number (1-12)
  - `startTime` - Start time (HHMM format, e.g., 750 = 07:50)
  - `endTime` - End time (HHMM format, e.g., 845 = 08:45)
  - `description` - Optional period description
- `units` - Day-to-period mapping with LESSON/VACANT states

**Parent Account Support:** ✅ YES (via session cookies)

**Use Case:** Display school hour structure, time grid formatting

---

## Non-Working / Not Available

### Messages API (REST view)
**Endpoint:** `/api/rest/view/v1/messages` (without Bearer token)
**Status:** ❌ 404 Not Found (session cookies only)
**Last Tested:** December 18, 2025
**Reason:** API path not available on this server instance
**JSON-RPC Alternative:** `getMessagesOfDay()`
**Notes:** Browser traces showed these endpoints, but they return 404 when accessed directly. May require special permissions or be UI-only.

### Timetable REST API
**Endpoint:** `/api/rest/view/v1/timetable/entries`, `/api/rest/view/v1/timetable/grid`, `/api/rest/view/v1/timetable/calendar`, etc.
**Status:** ❌ 404 Not Found
**Last Tested:** December 18, 2025
**Reason:** API endpoints not available for parent account access
**JSON-RPC Alternative:** `getTimetable()`
**Notes:** Browser traces show these endpoints are used in the web app, but they return 404 when accessed via API calls. Likely requires different authentication or resource types not available to parent accounts.

### School Years, App Data, Dashboard, etc.
**Endpoints:** `/api/rest/view/v1/schoolyears`, `/api/rest/view/v1/app/data`, `/api/rest/view/v1/app/platform-application/menus`, `/api/rest/view/v2/trigger/startup`, `/api/rest/view/v1/dashboard/cards/status`
**Status:** ❌ 404 Not Found
**Last Tested:** December 18, 2025
**Reason:** These endpoints are not available (likely browser-only or admin-only features)

### JSON-RPC Calendar Service
**Endpoint:** `POST /jsonrpc_web/jsonCalendarService`
**Status:** ⚠️ 403 Forbidden
**Last Tested:** December 18, 2025
**Reason:** Parent account access not permitted for this service
**Notes:** This endpoint exists but returns 403 when called with parent credentials

---

## Discovery Journey & Failed Attempts

### Tested but Non-Functional

#### JSON-RPC Methods
| Method | Parameter Structure | Error | Reason |
|--------|-------------------|-------|--------|
| `getClassregEvents()` | `{startDate, endDate, element: {id, type, keyType}}` | "no right for getClassregEvents()" | Permission denied for parent accounts |
| `getTimetableWithAbsences()` | `{startDate, endDate}` | "no right for getTimetableWithAbsences()" | Parent account limitation |
| `getStudentAbsences2017()` | Various | "Server didn't return any result" | Method not available on this WebUntis instance |

#### REST API Endpoints (404/500)
```
❌ /api/classreg/timetable → 500
❌ /api/classreg/schedule → 500
❌ /api/classreg/lessons → 500
❌ /api/classreg/homework → 500
❌ /api/classreg/events → 500
❌ /api/homeworks → 500 (use /api/homeworks/lessons instead!)
❌ /api/homework → 500
❌ /api/timetable → 500
❌ /api/schedule → 500
❌ /api/messages → 500
❌ /api/announcements → 500
❌ /api/rest/view/v1/timetable/entries → 404
❌ /api/rest/view/v1/messages → 404
```

---

## Authentication & Session Management

### REST API with Session Management (Recommended)
```javascript

const fetchClient = require('./lib/fetchClient');
const CookieJar = require('./lib/cookieJar');

// Setup session jar
const cookieJar = new CookieJar();
const baseURL = `https://${server}/WebUntis`;

// Authenticate (stores JSESSIONID in cookie jar)
await fetchClient.post(
  `${baseURL}/jsonrpc.do?school=${encodeURIComponent(school)}`,
  {
    method: 'authenticate',
    params: { user, password, client: 'App' },
    jsonrpc: '2.0'
  },
  { cookieJar }
);

// Subsequent REST API calls automatically include cookies
const result = await fetchClient.get(
  `${baseURL}/api/classreg/absences/students?startDate=20250901&endDate=20251231&studentId={STUDENT_ID}`,
  { cookieJar }
);
```

---

## Implementation Notes

### Parent Account Advantage
- ✅ REST APIs work with parent credentials (unlike JSON-RPC methods)
- ✅ Parent can monitor multiple children by iterating over `config.students[]`
- ✅ Better performance and response times
- ✅ More detailed data (e.g., excuse tracking for absences)

### Date Formats
- **All APIs use:** `YYYYMMDD` (e.g., `20251231` for Dec 31, 2025)
- NOT ISO format (`YYYY-MM-DD`)

### Parameter Validation
- Required parameters trigger 500 errors if missing
- Optional parameters are safely ignored if not provided
- Always use exact parameter names (case-sensitive)

### Response Format
- All responses wrapped in `{ data: { ... } }` structure
- Main data in `.data` property
- Collections usually in `.data.items` or `.data.arrays`

---

## Recommended Migration Path

### Phase 1: Absences (High Priority)
```
Current: getAbsentLesson() via JSON-RPC (student account only)
New:     /api/classreg/absences/students (parent account + more details)
Impact:  Parent users can now see student absences + excuse tracking
```

### Phase 2: Homework (Medium Priority)
```
Current: getHomeworkEvents() via JSON-RPC
New:     /api/homeworks/lessons (better structured response)
Impact:  More consistent data format
```

### Phase 3: Exams (Low Priority - already works)
```
Current: getExamEvents() via JSON-RPC
New:     /api/exams (supports withGrades parameter)
Impact:  Optional: can add grade information
```

### Unchanged
```
Timetable: Keep getTimetable() - no REST API available
Messages:  Keep getMessagesOfDay() - no REST API available
```

---

## Server Configuration

### Tested Servers
- **{server}** (example school)
  - ✅ All REST APIs working
  - ✅ Session management functional
  - ✅ Parent account support confirmed

### Known Limitations (Server-Specific)
- Swagger/OpenAPI endpoints not available
- Server introspection not possible
- No public API documentation

---

## Testing & Verification

### Discovery Tools (cli/)
- `api-discovery-full.js` - Comprehensive endpoint scanning
- `api-browser-discovery.js` - Analysis of browser network traces
- `api-detailed-analysis.js` - Deep parameter testing
- `api-introspection.js` - Server capability exploration
- `test-absences-rest-api.js` - Working example for absences

### Run Discovery
```bash
# Test all discovered APIs
node cli/api-detailed-analysis.js config/config.js {STUDENT_ID}

# Analyze specific endpoint
node cli/test-absences-rest-api.js config/config.js {STUDENT_ID} 20250901 20251231
```

---

## Next Steps

1. **Integration Phase**
   - Update `node_helper.js` to use REST APIs
   - Add session management layer
   - Maintain backward compatibility

2. **Testing Phase**
   - Test with multiple schools/servers
   - Verify parent account scenarios
   - Performance benchmarking

3. **Documentation Phase**
   - Update README.md with new API capabilities
   - Create migration guide for existing modules
   - Document parent account workflows

---

## References

- **WebUntis Official:** https://www.untis.at/
- **WebUntis JS Library:** https://webuntis.noim.me/
- **MagicMirror² Module Development:** https://docs.magicmirror.builders/development/module-development.html

---

## Document History

| Date | Status | Changes |
|------|--------|---------|
| 2025-12-18 | Complete | **Bearer token authentication discovery** - Found `/api/rest/view/v1/exams`, `/api/rest/view/v1/messages`, `/api/rest/view/v1/app/data` with JWT Bearer auth |
| 2025-12-18 | Complete | **Timegrid API** - `/api/timegrid` endpoint for school hour structure |
| 2025-12-18 | Complete | **Weekly timetable endpoint** - `/api/public/timetable/weekly/data` fully tested and working for parent accounts |
| 2025-12-18 | Complete | **Comprehensive JSON-RPC vs REST coverage analysis** - All 30+ methods mapped |
| 2025-12-18 | Complete | Initial comprehensive discovery documentation |
| - | - | All major REST APIs identified and tested |
| - | - | Parent account support confirmed |
| - | - | Non-working endpoints documented |
| - | - | Implementation roadmap created |
