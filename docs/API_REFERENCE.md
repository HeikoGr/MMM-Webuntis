# WebUntis API Reference

Reference for the external WebUntis APIs used by MMM-Webuntis.

Scope of this document:
- External WebUntis authentication and endpoint usage
- Normalization rules applied before data reaches the frontend
- Operational behavior relevant to endpoint reliability

Out of scope:
- Internal `GOT_DATA` payload shape
- Frontend/backend transport contract

For the internal socket payload contract, see [API_V2_MANIFEST.md](API_V2_MANIFEST.md).

**Related Documentation**:
- [API_TESTING_GUIDE.md](API_TESTING_GUIDE.md) - Testing tool and v2 calendar-entry API research (verdict: keep existing v1 architecture)

---

## Authentication

MMM-Webuntis uses a mixed auth model:
- JSON-RPC only for login / OTP-based login
- REST for all production data endpoints

### QR Code Authentication

Format:

```text
untis://setschool?url=<server>&school=<school>&user=<username>&key=<secret>
```

Flow:
1. Parse server, school, user, and secret from the QR URL.
2. Generate a TOTP from `key`.
3. Call JSON-RPC `authenticate` with username + TOTP.
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
1. Call JSON-RPC `authenticate` with username + password.
2. Reuse the resulting session cookies.
3. Request a REST bearer token via `/WebUntis/api/token/new`.
4. Optionally read `/WebUntis/api/rest/view/v1/app/data` for parent-account auto-discovery.

### Token and Session Handling

REST bearer tokens:
- Server lifetime: about 15 minutes
- Module cache lifetime: 14 minutes with a 5-minute safety buffer

Required REST headers:
- `Authorization: Bearer <token>`
- `Tenant-Id: <tenantId>`
- `X-Webuntis-Api-School-Year-Id: <schoolYearId>`

Session cookies:
- Established through JSON-RPC authentication
- Reused for token acquisition and endpoints that still rely on session cookies

---

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
- This endpoint is the auth canary. It reliably surfaces expired auth as `401` and is therefore fetched first.

### Timegrid

There is no dedicated production timegrid call in this module.

Source order:
1. `/WebUntis/api/rest/view/v1/app/data` -> `currentSchoolYear.timeGrid.units`
2. Derived fallback from timetable data

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
- relation via `homework.lessonId -> lesson.id`

Normalization note:
- Homework items are joined with lesson metadata before transport to frontend.

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
- start/end dates and times
- excused status
- reason / text fields

### Messages of Day

```text
GET /WebUntis/api/public/news/newsWidgetData
```

Parameters:
- `date=<YYYYMMDD>`

The module relies on:
- `data.messagesOfDay[]`
- `subject`
- `text`
- update / expiry flags when present

Normalization note:
- Transport to frontend uses the canonical internal field name `messages`, not `messagesOfDay`.

### Holidays and App Data

```text
GET /WebUntis/api/rest/view/v1/app/data
```

Used for:
- parent-account auto-discovery (`children[]`)
- timegrid units
- school-year context (`tenantId`, `schoolYearId`)
- holiday ranges

In MMM-Webuntis, holidays are not fetched from a separate production endpoint.

---

## JSON-RPC Endpoints

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

---

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
- Normalize upstream date representations to `YYYYMMDD` integers before payload building.

### Times

Canonical frontend-facing time shape:
- HHMM integer

Source formats:
- REST API often already returns HHMM integers
- timegrid units may come as `HH:MM` strings

Rule:
- REST HHMM values pass through unchanged.
- `HH:MM` strings are converted to HHMM integers.

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
- absence reasons / text
- messages of day

### Range Calculation

Date ranges are computed centrally before API calls.

Inputs may depend on:
- selected widgets
- `grid.nextDays` / `grid.pastDays`
- `lessons.nextDays` / `lessons.pastDays`
- `exams.nextDays`
- `homework.nextDays` / `homework.pastDays`
- `absences.nextDays` / `absences.pastDays`
- `grid.weekView`
- `debugDate`

The exact internal range object is an implementation detail and is therefore not duplicated here.

---

## Reliability Model

### Timetable-first Fetch Strategy

Problem:
- non-timetable endpoints may return `200` with empty arrays on expired auth

Solution:
1. Fetch timetable first
2. Re-auth if timetable exposes auth failure
3. Fetch remaining enabled endpoints in parallel

### HTTP Status Handling

Important statuses:

| Status | Meaning in module |
|--------|-------------------|
| `200` | Success |
| `401` | Auth expired or invalid; retry with fresh auth |
| `403` | Permanent permission error; endpoint may be skipped on later fetches |
| `404` | Endpoint/resource unavailable; may be skipped later |
| `410` | Endpoint gone; may be skipped later |
| `429` | Temporary rate limiting |
| `5xx` | Temporary server-side failure |

Permanent per-session endpoint status tracking exists specifically to avoid wasting calls on APIs that are permanently unavailable for the current account or school setup.

---

## Coverage Summary

| Capability | External API used | Notes |
|------------|-------------------|-------|
| Authentication | JSON-RPC `authenticate` | Required for initial session |
| Timetable | REST timetable endpoint | Auth canary and primary lesson source |
| Timegrid | REST `app/data` or derived fallback | No dedicated production endpoint used |
| Exams | REST `/api/exams` | Direct endpoint |
| Homework | REST `/api/homeworks/lessons` | Homework + lesson join |
| Absences | REST class-register absences endpoint | Student-specific filtering when needed |
| Messages | REST news widget endpoint | Normalized to internal `messages` |
| Holidays | REST `app/data` | Derived from school-year/app-data payload |

For transport-contract details and field names after normalization, see [API_V2_MANIFEST.md](API_V2_MANIFEST.md).
