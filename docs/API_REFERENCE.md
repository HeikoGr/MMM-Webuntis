# WebUntis API Reference

Reference for the external WebUntis APIs used by MMM-Webuntis.

Scope of this document:
- external WebUntis authentication and endpoint usage
- endpoint semantics the module relies on
- normalization rules applied before data reaches the frontend

Out of scope:
- internal `DATA_UPDATE` payload shape
- frontend/backend transport contract
- detailed retry, timeout, and skip behavior

For the currently shipped internal socket payload contract, see [API_V3_MANIFEST.md](API_V3_MANIFEST.md).
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

### Form Login (alternative, not used)

The WebUntis web UI does not use JSON-RPC `authenticate`; it posts the credentials to a Spring
Security form-login endpoint. **MMM-Webuntis does not use this path.** It is documented because
`jsonrpc.do` is a legacy surface that WebUntis could retire, and because this flow yields the CSRF
token required by [`jsonrpc_web/jsonCalendarService`](#jsonrpc_webjsoncalendarservice).

Flow:
1. `GET /WebUntis/?school=<school>` - sets a pre-auth session cookie and embeds the CSRF token
   (see [CSRF Token](#csrf-token)).
2. `POST /WebUntis/j_spring_security_check` with the CSRF header and
   `Content-Type: application/x-www-form-urlencoded`:

   ```text
   school=<school>&j_username=<username>&j_password=<password>&token=
   ```

   The trailing `token` field stays empty for plain credential login.
3. On success the response is `{"switchUI":true,"state":"SUCCESS"}` and the session cookie is
   upgraded to an authenticated one.
4. Continue as with JSON-RPC login: `/WebUntis/api/token/new`, then `app/data`.

Verified working against a live tenant from plain Node (no browser required). The failure response
shape was not probed; an implementation should treat anything other than `state: "SUCCESS"` as a
failed login.

### CSRF Token

Several non-REST endpoints require a CSRF token. It is not a cookie and not a meta tag: the initial
HTML of `GET /WebUntis/?school=<school>` embeds it in an inline JSON blob.

```json
{ "csrfHeader": "X-CSRF-TOKEN", "csrfToken": "<token>" }
```

Use the value of `csrfHeader` as the header name and `csrfToken` as its value. The token is bound to
the session cookie of that same response, so both must be kept together.

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

School-year scoping (important):
- this endpoint is scoped by the **school year stored in the server-side session**, not by the
  requested date range and not by the `X-Webuntis-Api-School-Year-Id` header
- a session is pinned to the school year that was current at login; a request for a date range in
  a different school year answers HTTP 200 with every collection empty:
  `{"data":{"records":[],"homeworks":[],"teachers":[],"lessons":[]}}`
- the WebUntis web UI works around this by calling `setSchoolyear` (see
  [`jsonrpc_web/jsonCalendarService`](#jsonrpc_webjsoncalendarservice)) before it queries a date
  outside the active school year
- MMM-Webuntis does not call `setSchoolyear`, so homework is only retrievable for the school year
  that is current at fetch time - see [Known Limitation: debugDate](#known-limitation-debugdate)

Measured behavior on one session (identical request, only the session school year changed):

| Session school year | homework | exams | timetable |
| --- | --- | --- | --- |
| current (at login) | 0 | 3 | 8 |
| previous, via `setSchoolyear` | 43 | 3 | 8 |
| current again | 0 | 3 | 8 |

Exams and timetable were unaffected by the session school year in the same test; the timetable
endpoint derives the school year from the requested date range.

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

### `jsonrpc_web/jsonCalendarService`

A second, separate JSON-RPC surface used by the WebUntis web UI. **Not used by MMM-Webuntis** -
documented because it is the only known way to reach data of a past school year (see
[Homework](#homework)).

```text
POST /WebUntis/jsonrpc_web/jsonCalendarService
```

`setSchoolyear` switches the school year stored in the server-side session:

```json
{
  "id": 6,
  "method": "setSchoolyear",
  "params": [9],
  "jsonrpc": "2.0"
}
```

Response:

```json
{ "jsonrpc": "2.0", "id": 6, "result": true }
```

Requirements:
- an authenticated session cookie
- `Content-Type: application/json`
- a CSRF token header (see [CSRF Token](#csrf-token)); the request is rejected without it

Notes:
- the school year id comes from `GET /WebUntis/api/rest/view/v1/schoolyears`, which lists every
  school year with `id`, `name`, and `dateRange`; ids are not contiguous per school
- the call mutates shared session state: one session is shared by all module instances of an
  account, so any implementation must account for instances targeting different school years

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

HTML-bearing fields are sanitized before transport by the shared `sanitizeRichText()` helper, which uses `sanitize-html`. No HTML attributes are retained.

Whitelist:
- `<b>`
- `<strong>`
- `<i>`
- `<em>`
- `<u>`
- `<s>`, `<strike>`, `<del>`
- `<sub>`, `<sup>`, `<small>`

`<br>` and block elements (`<p>`, `<div>`, `<li>`, `<h1>` through `<h6>`) are converted to line breaks. All other tags, attributes, and unsafe tag content are removed. Entities (`&amp;`, `&auml;`, `&#228;`) are decoded **after** all tags are gone, so a decoded `<` can never be read as the start of a tag.

#### Two sanitizers, and which field gets which

There are two helpers in `lib/webuntis/dataOrchestration.js`, and both take a second boolean that does *not* mean the same thing:

| Helper | Second parameter | Keeps markup? | Used by |
|--------|------------------|---------------|---------|
| `sanitizeRichText(text, keepMarkdownMarkers)` | keep literal `_` and `*` | yes, the whitelist above | `lib/mmm-adapter/mmmPayloadMapper.js`, on the fields below |
| `stripAllHtml(text, preserveLineBreaks)` | keep `<br>` as newlines | no, everything is removed | `webuntisApiService.getExams()` only, injected as `stripHtml` from `lib/webuntis/webuntisClient.js` |

Neither parameter switches HTML removal on or off. `sanitizeRichText` always keeps the whitelist, `stripAllHtml` always removes everything.

Field-by-field result in the `DATA_UPDATE` payload:

| Collection | Field | Pipeline | Reaches the frontend as |
|------------|-------|----------|-------------------------|
| lessons | substitutionText, lessonText | **none** | raw API text; the `lessons` and `grid` plugins run it through `escapeHtml()` at render time |
| exams | name, subject | `stripAllHtml(…, false)` then `sanitizeRichText` | plain text, whitespace collapsed |
| exams | text | `stripAllHtml(…, true)` then `sanitizeRichText` | plain text, line breaks kept |
| homework | text | `sanitizeRichText(…, true)` | rich text, Markdown markers kept |
| homework | remark | `sanitizeRichText(…, false)` | rich text |
| absences | reason | `sanitizeRichText(…, false)` | rich text |
| messagesofday | subject, text | `sanitizeRichText(…, true)` | rich text, Markdown markers kept |

Two rows deserve attention, both current behavior rather than a deliberate contract:

- **exams**: the API layer already strips everything, so the later rich-text pass has no markup left to preserve. Exam fields are plain text even though the mapper treats them as rich text.
- **lessons**: `substitutionText` and `lessonText` are never sanitized on the backend. They are safe because both plugins escape them when rendering, but as a consequence entities arrive escaped rather than decoded - a lesson text containing `&amp;` displays as `&amp;`, while the same characters in a homework text display as `&`.

**Trust boundary:** whatever leaves `sanitizeRichText()` is declared safe HTML and must not be escaped again in a plugin frontend. Escaping it a second time is what made users see literal `&amp;` and `<b>` (fixed in `f7ebcda`).

### Range Calculation

Date ranges are computed centrally before API calls.

Inputs may depend on:
- selected plugins
- `grid.nextDays` and `grid.pastDays`
- `lessons.nextDays` and `lessons.pastDays`
- `exams.nextDays`
- `homework.nextDays` and `homework.pastDays`
- `absences.nextDays` and `absences.pastDays`
- `grid.weekView`
- `debugDate`

The exact internal range object is an implementation detail and is therefore not duplicated here.

## Known Limitation: debugDate

`debugDate` moves the module's calendar date for testing. When the chosen date lies in a **past
school year**, homework comes back empty while timetable and exams still return data.

This is the session-scoping behavior described under [Homework](#homework), not a module bug: a
session is pinned to the school year current at login, and the module deliberately does not call
[`setSchoolyear`](#jsonrpc_webjsoncalendarservice), because that call mutates session state shared
by every module instance of the account.

Practical consequence:
- pick a `debugDate` inside the current school year to exercise homework
- normal operation is unaffected, since live fetches always target the current date

Ruled out during investigation (all reproduced against a live tenant):
- sending `X-Webuntis-Api-School-Year-Id` with the correct id - no effect on this endpoint
- passing `studentId` as a query parameter - the web UI does not send it either
- bearer token vs. cookie-only auth, and the order of calls after login
- the login method itself: the [form login](#form-login-alternative-not-used) behaves identically

## Coverage Summary

| Capability | External API used | Notes |
| --- | --- | --- |
| Authentication | JSON-RPC `authenticate` | Required for initial session |
| Timetable | REST timetable endpoint | Auth canary and primary lesson source |
| Timegrid | REST `app/data` or derived fallback | No dedicated production endpoint used |
| Exams | REST `/api/exams` | Direct endpoint |
| Homework | REST `/api/homeworks/lessons` | Homework and lesson join; scoped to the session's school year |
| Absences | REST class-register absences endpoint | Student-specific filtering when needed |
| Messages | REST news widget endpoint | Normalized to internal `messages` |
| Holidays | REST `app/data` | Derived from school-year and app-data payload |

For transport-contract details and field names after normalization, see [API_V3_MANIFEST.md](API_V3_MANIFEST.md).