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
3. GET `/api/rest/view/v1/app/data` to discover student IDs (auto-discovery)
4. Use `studentId` parameter for student-specific API calls

### Token Caching

**REST Bearer Tokens:**
- Lifetime: 15 minutes (WebUntis server)
- Cache duration: 14 minutes (with 5-minute buffer to prevent silent failures)
- Generation: GET `/api/token/new` (requires active session)
- Header: `Authorization: Bearer <token>`, `X-Webuntis-Api-Tenant-Id: <tenantId>`

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
GET /api/public/timetable/weekly/data
```
**Auth:** Session cookies or Bearer token
**Parameters:**
- `elementType=5` (students)
- `elementId=<studentId>`
- `date=<YYYYMMDD>` (Monday of target week)
- `formatId=<formatId>` (from app/data response)

**Response:**
```json
{
  "data": {
    "elementPeriods": {
      "<studentId>": [
        {
          "id": 123456,
          "date": 20260119,
          "startTime": 800,
          "endTime": 945,
          "elements": [
            { "type": 3, "id": 789, "name": "Math", "longName": "Mathematics" },
            { "type": 2, "id": 456, "name": "SM", "longName": "Smith, John" }
          ],
          "studentGroup": "10a",
          "code": "REGULAR|CANCELLED|IRREGULAR"
        }
      ]
    }
  }
}
```

**Parent Account:** ✅ Supported via `elementId` parameter

#### Get Timegrid (School Hours)
```
GET /api/timegrid
```
**Auth:** Session cookies
**Response:**
```json
{
  "data": {
    "days": [
      {
        "day": 2,
        "timeUnits": [
          { "name": "1", "startTime": "08:00", "endTime": "08:45" },
          { "name": "2", "startTime": "08:50", "endTime": "09:35" }
        ]
      }
    ]
  }
}
```

---

### Exams

```
GET /api/exams
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
GET /api/homeworks/lessons
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
GET /api/classreg/absences/students
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
GET /api/public/news/newsWidgetData
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

```
GET /api/schoolyear/holidays
```
**Auth:** Session cookies
**Response:**
```json
{
  "data": {
    "holidays": [
      {
        "id": 123,
        "name": "Winter Break",
        "longName": "Winter Break 2026",
        "startDate": 20260201,
        "endDate": 20260207
      }
    ]
  }
}
```

**Implementation:**
- Backend pre-computes `holidayByDate` map (YYYYMMDD → holiday object)
- Grid widget uses lookup map for instant holiday detection
- `currentHoliday` field suppresses "No lessons" warning during vacation

---

### App Initialization Data

```
GET /api/rest/view/v1/app/data
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

## Data Normalization

All REST API responses are normalized before frontend consumption.

### Date Normalization
- **Input:** `20260125` (YYYYMMDD integer) or `"2026-01-25"` (ISO string)
- **Output:** `20260125` (YYYYMMDD integer)
- **Function:** `normalizeDateToInteger(date)` in [dataTransformer.js](../lib/dataTransformer.js)

### Time Normalization

**REST API:** HHMM integers (e.g., `1350` = 13:50)
- **Pass-through:** No transformation needed
- **Frontend:** `formatTime(1350)` → `"13:50"`

**Timegrid API:** HH:MM strings (e.g., `"13:50"`)
- **Transformation:** `parseTimegridTimeString("13:50")` → `1350`
- **Location:** [payloadCompactor.js](../lib/payloadCompactor.js)

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
| Timetable | ✅ Primary | ⚠️ Fallback | Cookies/Bearer | ✅ |
| Exams | ✅ Primary | ⚠️ Fallback | Cookies/Bearer | ✅ |
| Homework | ✅ Only | ❌ None | Cookies | ✅ |
| Absences | ✅ Only | ❌ None | Cookies | ✅ |
| Messages | ✅ Only | ⚠️ Fallback | Cookies | ✅ |
| Holidays | ✅ Only | ⚠️ Fallback | Cookies | ✅ |
| Authentication | ❌ N/A | ✅ Required | Password/TOTP | ✅ |

**Legend:**
- ✅ Fully supported and tested
- ⚠️ Available but not actively used
- ❌ Not available

---

For implementation details, see:
- [authService.js](../lib/authService.js) - Authentication and token caching
- [webuntisApiService.js](../lib/webuntisApiService.js) - REST endpoint wrappers
- [dataFetchOrchestrator.js](../lib/dataFetchOrchestrator.js) - Timetable-first fetch strategy
- [dataTransformer.js](../lib/dataTransformer.js) - Data normalization
- [payloadCompactor.js](../lib/payloadCompactor.js) - HTML sanitization and time parsing
