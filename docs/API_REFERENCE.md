# WebUntis API Reference

Comprehensive reference for REST and JSON-RPC APIs used in MMM-Webuntis.

**Status:** All documented APIs are actively used in production (v2.x)

---

## Authentication Methods

### QR Code Authentication (Recommended)

**Format:** `untis://setschool?url=<server>&school=<school>&user=<username>&key=<secret>`

**Implementation:**
1. Extract credentials from QR code URL
2. Generate TOTP token using `key` parameter (`otplib` library, 30s interval, 6 digits)
3. POST JSON-RPC `authenticate` with username + TOTP token
4. Store session cookies for subsequent REST calls

**Token Details:**
- Algorithm: SHA-1 HMAC
- Interval: 30 seconds
- Digits: 6
- Library: `otplib` (Node.js)

### Parent Account Authentication

**Credentials:** `username`, `password`, `school`, `server`

**Workflow:**
1. POST JSON-RPC `authenticate` with username + password
2. Session cookies stored automatically
3. GET `/WebUntis/api/rest/view/v1/app/data` to discover student IDs (auto-discovery)
4. Use `studentId` parameter for student-specific API calls

### Token Caching

**REST Bearer Tokens:**
- Lifetime: 15 minutes (WebUntis server)
- Cache duration: 14 minutes (with 5-minute buffer to prevent silent failures)
- Generation: GET `/WebUntis/api/token/new` (requires active session)
- Header: `Authorization: Bearer <token>`, `Tenant-Id: <tenantId>`, `X-Webuntis-Api-School-Year-Id: <schoolYearId>`

**Session Cookies:**
- Lifetime: ~1 hour (varies by server)
- Automatic renewal on each API call
- No manual expiry handling needed

---

## REST API Endpoints

All REST endpoints require active session cookies or Bearer token (where noted).

### Timetable

#### Get Student Timetable
```
GET /WebUntis/api/rest/view/v1/timetable/entries
```
**Auth:** Session cookies or Bearer token
**Parameters:**
- `start=<YYYY-MM-DD>`
- `end=<YYYY-MM-DD>`
- `resourceType=STUDENT|CLASS`
- `resources=<studentId_or_classId>`
- `timetableType=MY_TIMETABLE`

**Response:**
```json
{
  "days": [
    {
      "date": "2026-01-19",
      "gridEntries": [
        {
          "ids": [123456],
          "duration": { "start": "2026-01-19T08:00:00", "end": "2026-01-19T09:45:00" },
          "status": "REGULAR",
          "type": "NORMAL_TEACHING_PERIOD"
        }
      ]
    }
  ]
}
```

**Parent Account:** ✅ Supported via `resourceType/resources` parameters

#### Get Timegrid (School Hours)
There is no separate production Timegrid REST call.

**Source in this module:**
- Primary: `GET /WebUntis/api/rest/view/v1/app/data` (`currentSchoolYear.timeGrid.units`)
- Fallback: derived from timetable data when no timegrid units are available

---

### Exams

```
GET /WebUntis/api/exams
```
**Auth:** Session cookies or Bearer token
**Parameters:**
- `startDate=<YYYYMMDD>`
- `endDate=<YYYYMMDD>`

**Response:**
```json
{
  "data": {
    "exams": [
      {
        "id": 12345,
        "examDate": 20260125,
        "startTime": 800,
        "endTime": 945,
        "name": "Math Test",
        "subject": { "id": 789, "name": "MA", "longName": "Mathematics" },
        "teachers": [{ "id": 456, "name": "SM", "longName": "Smith, John" }]
      }
    ]
  }
}
```

**Parent Account:** ✅ Supported (returns all students' exams)

---

### Homework

```
GET /WebUntis/api/homeworks/lessons
```
**Auth:** Session cookies
**Parameters:**
- `startDate=<YYYYMMDD>`
- `endDate=<YYYYMMDD>`

**Response:**
```json
{
  "data": {
    "homeworks": [
      {
        "id": 12345,
        "lessonId": 67890,
        "date": 20260120,
        "dueDate": 20260127,
        "text": "Read chapter 5",
        "remark": ""
      }
    ],
    "lessons": [
      {
        "id": 67890,
        "subject": { "id": 789, "name": "MA", "longName": "Mathematics" }
      }
    ]
  }
}
```

**Data Transformation:**
- Join `homeworks` to `lessons` via `lessonId`
- HTML sanitization: Strip tags except `<b>`, `<i>`, `<u>`, `<br>`, `<p>`, `<strong>`, `<em>`
- Subject fallback: `lesson.subject.longName` → `lesson.subject.name` → `lesson.su[0]`

**Parent Account:** ✅ Supported (returns all students' homework)

---

### Absences

```
GET /WebUntis/api/classreg/absences/students
```
**Auth:** Session cookies
**Parameters:**
- `startDate=<YYYYMMDD>`
- `endDate=<YYYYMMDD>`
- `studentId=<studentId>` (optional for parent accounts)

**Response:**
```json
{
  "data": {
    "absences": [
      {
        "id": 12345,
        "startDate": 20260120,
        "endDate": 20260120,
        "startTime": 800,
        "endTime": 945,
        "excused": true,
        "reason": { "id": 1, "name": "Illness" },
        "text": "Doctor's note provided"
      }
    ]
  }
}
```

**Parent Account:** ✅ Fully supported via `studentId` parameter

---

### Messages of Day

```
GET /WebUntis/api/public/news/newsWidgetData
```
**Auth:** Session cookies
**Parameters:**
- `date=<YYYYMMDD>`

**Response:**
```json
{
  "data": {
    "messagesOfDay": [
      {
        "id": 12345,
        "subject": "School Event",
        "text": "Sports day on Friday",
        "isExpired": false,
        "isUpdated": false
      }
    ]
  }
}
```

---

### Holidays

In this module, holidays are read from `GET /WebUntis/api/rest/view/v1/app/data` (school year data), not from a separate holiday endpoint.

**Implementation:**
- Backend sends holiday ranges (`startDate`/`endDate`)
- Backend also provides `data.holidays.current` (active holiday for `today`, or `null`)
- Frontend derives a per-day lookup map from `data.holidays.ranges` for instant widget lookup
- The range expansion is inclusive (`startDate..endDate`), so one-day holidays (`startDate === endDate`) are mapped and rendered correctly
- Empty-lessons warning suppression during vacation is decided in backend using the active holiday (`data.holidays.current`)

---

### App Initialization Data

```
GET /WebUntis/api/rest/view/v1/app/data
```
**Auth:** Bearer token
**Response:**
```json
{
  "user": {
    "person": { "id": 12345, "name": "Alice Smith" },
    "children": [
      { "id": 67890, "key": "std-67890", "name": "Alice Smith" }
    ]
  },
  "settings": {
    "timetableSettings": { "defaultFormatId": 1 }
  }
}
```

**Usage:**
- Auto-discovery: Extract `children[]` array for parent accounts
- Format ID: Use `defaultFormatId` for timetable API calls
- Person ID extraction: Required for QR code authentication (JWT parsing)

---

## JSON-RPC Endpoints (Legacy)

**Base URL:** `https://<server>/WebUntis/jsonrpc.do?school=<school>`

### Authentication

```json
POST /WebUntis/jsonrpc.do?school=<school>
{
  "id": "req-1",
  "method": "authenticate",
  "params": {
    "user": "<username>",
    "password": "<password_or_totp_token>",
    "client": "MMM-Webuntis"
  },
  "jsonrpc": "2.0"
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "sessionId": "ABC123XYZ",
    "personType": 5,
    "personId": 12345
  }
}
```

**Session Management:**
- Session cookies set automatically in response headers
- Use cookies for all subsequent REST API calls
- Logout: POST JSON-RPC `logout` method

---

### Data Normalization

Relevant REST payload parts are normalized before frontend consumption.

### Date Normalization
- **Input:** `20260125` (YYYYMMDD integer) or `"2026-01-25"` (ISO string)
- **Output:** `20260125` (YYYYMMDD integer)
- **Function:** `normalizeDateToInteger(date)` in [dataOrchestration.js](../lib/dataOrchestration.js)

### Time Normalization

**REST API:** HHMM integers (e.g., `1350` = 13:50)
- **Pass-through:** No transformation needed
- **Frontend:** `formatDisplayTime(1350)` → `"13:50"`

**Timegrid Source Data:** HH:MM strings (e.g., `"13:50"`)
- **Transformation:** `parseHHMMStringToInteger("13:50")` → `1350`
- **Location:** [dataOrchestration.js](../lib/webuntis/dataOrchestration.js)

### HTML Sanitization

**Whitelist:** `<b>`, `<strong>`, `<i>`, `<em>`, `<u>`, `<br>`, `<p>`

**Implementation:**
```javascript
sanitizeHtml(rawHtml) {
  return rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p>/gi, '\n')
    .replace(/<\/p>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}
```

**Applied to:** Homework text, absence reasons, messages of day

---

## Error Handling

### HTTP Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| 200 | Success | Process data |
| 401 | Unauthorized | Token expired, re-authenticate |
| 403 | Forbidden | Permanent permission error, skip future calls |
| 404 | Not Found | Endpoint/resource unavailable, skip future calls |
| 410 | Gone | API deprecated, skip future calls |
| 429 | Rate Limited | Retry after delay |
| 5xx | Server Error | Retry on next fetch interval |

**Status Tracking:** Permanent errors (403/404/410) are tracked per session in `node_helper.js#_apiStatusBySession` Map to prevent repeated failed API calls.

### REST Error Mapping

Errors are mapped to user-friendly warnings in [errorHandler.js](../lib/errorHandler.js):

```javascript
{
  status: 403,
  message: "No permission to access exams",
  apiType: "exams"
}
```

**Frontend Display:** Warnings shown in widget header, data section hidden

---

## Timetable-First Fetch Strategy

**Problem:** Non-timetable APIs return 200 OK with empty arrays when token expired (silent failures)

**Solution:** Sequential timetable fetch + parallel remaining APIs

**Order:**
1. **Timetable** (sequential) - reliably returns 401 on expired token
2. **Exams, Homework, Absences, Messages** (parallel) - only if timetable succeeds

**Implementation:** [dataFetchOrchestrator.js](../lib/dataFetchOrchestrator.js)

---

## Rate Limiting & Best Practices

- **Default interval:** 5 minutes (`updateInterval: 5 * 60 * 1000`)
- **Token caching:** 14-minute TTL prevents excessive auth calls
- **Parallel fetching:** Exams, homework, absences, messages fetched simultaneously after timetable
- **Error backoff:** Permanent errors (403/404/410) skip future API calls
- **Date ranges:** Use smallest necessary range to minimize payload size

---

## API Coverage Summary

| Feature | REST API | JSON-RPC | Auth Method | Parent Support |
|---------|----------|----------|-------------|----------------|
| Timetable | ✅ Primary | ❌ None | Cookies/Bearer | ✅ |
| Exams | ✅ Primary | ❌ None | Cookies/Bearer | ✅ |
| Homework | ✅ Only | ❌ None | Cookies | ✅ |
| Absences | ✅ Only | ❌ None | Cookies | ✅ |
| Messages | ✅ Only | ❌ None | Cookies | ✅ |
| Holidays | ✅ Via app/data | ❌ None | Cookies/Bearer | ✅ |
| Authentication | ❌ N/A | ✅ Required | Password/TOTP | ✅ |

**Legend:**
- ✅ Fully supported and tested
- ❌ Not available

---

For implementation details, see:
- [authService.js](../lib/authService.js) - Authentication and token caching
- [webuntisApiService.js](../lib/webuntisApiService.js) - REST endpoint wrappers
- [dataFetchOrchestrator.js](../lib/dataFetchOrchestrator.js) - Timetable-first fetch strategy
- [payloadCompactor.js](../lib/payloadCompactor.js) - Payload compaction, HTML sanitization, and time parsing
