# WebUntis API Reference

Reference for the external WebUntis APIs used by MMM-Webuntis.

Scope of this document:
- external WebUntis authentication and endpoint usage
- endpoint semantics the module relies on
- normalization rules applied before data reaches the frontend

Out of scope:
- internal `GOT_DATA` payload shape
- frontend/backend transport contract
- detailed retry, timeout, and skip behavior

For the internal socket payload contract, see [API_V2_MANIFEST.md](API_V2_MANIFEST.md).
For runtime fetch order, retries, timeouts, and skip rules, see [SERVER_REQUEST_FLOW.md](SERVER_REQUEST_FLOW.md).

**Related Documentation**:
- [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) - testing tool and endpoint research

## Authentication

MMM-Webuntis uses a mixed auth model:
- JSON-RPC for login and OTP-based login
- REST for production data endpoints

### QR Code Authentication

Format:

```text
untis://setschool?url=<server>&school=<school>&user=<username>&key=<secret>
```

Flow:
1. Parse server, school, user, and secret from the QR URL.
2. Generate a TOTP from `key`.
3. Call JSON-RPC `authenticate` with username and TOTP.
4. Reuse the resulting session to request a REST bearer token.

Notes:
- TOTP uses `otplib`.
- The generated bearer token is used together with tenant and school-year headers.

### Username / Password Authentication

Canonical config keys:
- `username`
- `password`
- `school`
- `server`

Flow:
1. Call JSON-RPC `authenticate` with username and password.
2. Reuse the resulting session cookies.
3. Request a REST bearer token via `/WebUntis/api/token/new`.
4. Optionally read `/WebUntis/api/rest/view/v1/app/data` for parent-account auto-discovery.

### Token And Session Handling

REST bearer tokens:
- server lifetime: about 15 minutes
- module cache lifetime: 14 minutes with a 5-minute safety buffer

Required REST headers:
- `Authorization: Bearer <token>`
- `Tenant-Id: <tenantId>`
- `X-Webuntis-Api-School-Year-Id: <schoolYearId>`

Session cookies:
- established through JSON-RPC authentication
- reused for token acquisition and endpoints that still rely on session cookies

## REST Endpoints

This section documents the external endpoints and the subset of response semantics MMM-Webuntis relies on.

### Timetable

```text
GET /WebUntis/api/rest/view/v1/timetable/entries
```

Parameters:
- `start=<YYYY-MM-DD>`
- `end=<YYYY-MM-DD>`
- `resourceType=STUDENT|CLASS`
- `resources=<studentId_or_classId>`
- `timetableType=MY_TIMETABLE`

The module relies on:
- `days[].date`
- `days[].gridEntries[]`
- `gridEntries[].duration.start`
- `gridEntries[].duration.end`
- `gridEntries[].status`
- `gridEntries[].type`

Operational note:
- This endpoint is treated as the auth canary by the runtime fetch flow.

### Timegrid

There is no dedicated production timegrid call in this module.

Source order:
1. `/WebUntis/api/rest/view/v1/app/data` -> `currentSchoolYear.timeGrid.units`
2. derived fallback from timetable data

### Exams

```text
GET /WebUntis/api/exams
```

Parameters:
- `startDate=<YYYYMMDD>`
- `endDate=<YYYYMMDD>`

The module relies on:
- `data.exams[]`
- `examDate`
- `startTime`
- `endTime`
- `name`
- `subject`
- `teachers`

### Homework

```text
GET /WebUntis/api/homeworks/lessons
```

Parameters:
- `startDate=<YYYYMMDD>`
- `endDate=<YYYYMMDD>`

The module relies on:
- `data.homeworks[]`
- `data.lessons[]`
- the relation `homework.lessonId -> lesson.id`

Normalization note:
- homework items are joined with lesson metadata before transport to the frontend

### Absences

```text
GET /WebUntis/api/classreg/absences/students
```

Parameters:
- `startDate=<YYYYMMDD>`
- `endDate=<YYYYMMDD>`
- `studentId=<studentId>` when needed

The module relies on:
- `data.absences[]`
- start and end dates and times
- excused status
- reason and text fields

### Messages Of Day

```text
GET /WebUntis/api/public/news/newsWidgetData
```

Parameters:
- `date=<YYYYMMDD>`

The module relies on:
- `data.messagesOfDay[]`
- `subject`
- `text`
- update and expiry flags when present

Normalization note:
- transport to the frontend uses the canonical internal field name `messages`, not `messagesOfDay`

### Holidays And App Data

```text
GET /WebUntis/api/rest/view/v1/app/data
```

Used for:
- parent-account auto-discovery through `children[]`
- timegrid units
- school-year context (`tenantId`, `schoolYearId`)
- holiday ranges

In MMM-Webuntis, holidays are not fetched from a separate production endpoint.

## JSON-RPC Endpoint

Base URL:

```text
https://<server>/WebUntis/jsonrpc.do?school=<school>
```

### `authenticate`

Used for:
- username/password login
- QR/TOTP login

Minimal request shape:

```json
{
  "id": "req-1",
  "method": "authenticate",
  "params": {
    "user": "<username>",
    "password": "<password_or_totp>",
    "client": "MMM-Webuntis"
  },
  "jsonrpc": "2.0"
}
```

Minimal response fields used by the module:

```json
{
  "result": {
    "sessionId": "ABC123XYZ",
    "personType": 5,
    "personId": 12345
  }
}
```

## Normalization Rules

This section documents stable transformation rules that are intentionally applied before data enters the frontend contract.

### Dates

Canonical frontend-facing date shape:
- `YYYYMMDD` integer

Accepted upstream examples:
- `20260125`
- `"2026-01-25"`
- ISO datetime strings when source data provides them

Rule:
- normalize upstream date representations to `YYYYMMDD` integers before payload building

### Times

Canonical frontend-facing time shape:
- HHMM integer

Source formats:
- REST API often already returns HHMM integers
- timegrid units may come as `HH:MM` strings

Rule:
- REST HHMM values pass through unchanged
- `HH:MM` strings are converted to HHMM integers

### HTML Sanitization

HTML-bearing fields are sanitized before transport.

Whitelist:
- `<b>`
- `<strong>`
- `<i>`
- `<em>`
- `<u>`
- `<br>`
- `<p>`

Applied to:
- homework text
- absence reasons and text
- messages of day

### Range Calculation

Date ranges are computed centrally before API calls.

Inputs may depend on:
- selected widgets
- `grid.nextDays` and `grid.pastDays`
- `lessons.nextDays` and `lessons.pastDays`
- `exams.nextDays`
- `homework.nextDays` and `homework.pastDays`
- `absences.nextDays` and `absences.pastDays`
- `grid.weekView`
- `debugDate`

The exact internal range object is an implementation detail and is therefore not duplicated here.

## Coverage Summary

| Capability | External API used | Notes |
| --- | --- | --- |
| Authentication | JSON-RPC `authenticate` | Required for initial session |
| Timetable | REST timetable endpoint | Auth canary and primary lesson source |
| Timegrid | REST `app/data` or derived fallback | No dedicated production endpoint used |
| Exams | REST `/api/exams` | Direct endpoint |
| Homework | REST `/api/homeworks/lessons` | Homework and lesson join |
| Absences | REST class-register absences endpoint | Student-specific filtering when needed |
| Messages | REST news widget endpoint | Normalized to internal `messages` |
| Holidays | REST `app/data` | Derived from school-year and app-data payload |

For transport-contract details and field names after normalization, see [API_V2_MANIFEST.md](API_V2_MANIFEST.md).