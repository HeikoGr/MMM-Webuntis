# REST Endpoints Overview: MMM-Webuntis Module

## Summary

The MMM-Webuntis module uses **REST API endpoints** via the `webuntis` library. In practice, most data retrieval happens via REST endpoints. JSON-RPC is primarily used for session-based authentication (login/logout); after login, subsequent calls are REST.

---

## Detailed Mapping: Module Data vs. REST Endpoints

### 1) Lessons / Timetable

| Data category | Module function | `webuntis` library | REST endpoint | Notes |
|---|---|---|---|---|
| Own timetable (week) | `getOwnTimetableForWeek()` | `getOwnTimetableForWeek(date)` | `/WebUntis/api/klassen/{klasseId}/timeline?week=...` | Web client API |
| Own timetable (range) | `getOwnTimetableForRange()` | `getOwnTimetableForRange(start, end)` | `/WebUntis/api/klassen/{klasseId}/timetable?from=...&to=...` | Legacy mapping (JSON-RPC → REST) |
| Class timetable (range) | `getOwnClassTimetableForRange()` | `getOwnClassTimetableForRange(start, end)` | `/WebUntis/api/klassen/{klasseId}/timetable?...` | For classes |
| Student timetable (range) | `getTimetableForRange(start, end, studentId, 5)` | `getTimetableForRange(start, end, id, type)` | `/WebUntis/api/students/{id}/timetable?...` | Parent account with `studentId` |
| Time grid | `getTimegrid()` | `getTimegrid()` | `/WebUntis/api/timegrid` | School-wide time grid |

**Status:** ✅ REST-based

---

### 2) Exams

| Data category | Module function | `webuntis` library | REST endpoint | Notes |
|---|---|---|---|---|
| Exams (range) | `getExamsForRange(start, end, studentId?)` | `getExamsForRange(start, end, klasseId?)` | `/WebUntis/api/exams?from=...&to=...&klasseId=...` | Optional with `klasseId` |

**Status:** ✅ REST-based

---

### 3) Homework

| Data category | Module function | REST endpoint | Notes |
|---|---|---|---|
| Homework (range) | `_getHomeworkViaRest(startDate, endDate)` | `/WebUntis/api/homeworks/lessons` | Returns parallel arrays: `{ homeworks: [...], lessons: [...] }` |

**Status:** ✅ REST-based (MMM-Webuntis)

**Implementation Details:**
- Endpoint: `/WebUntis/api/homeworks/lessons`
- Parameters: `startDate`, `endDate` (YYYYMMDD format)
- Response structure: Parallel arrays with `homeworks[]` and `lessons[]`
- Subject mapping: Join homework to lesson via `lessonId`, use `lesson.subject` or fallback to `lesson.su[0]`
- HTML sanitization: Text content is sanitized while preserving line breaks
- Deduplication: Uses homework ID or `lessonId_dueDate` composite key to avoid duplicates

---

### 4) Absences

| Data category | Module function | REST endpoint | Notes |
|---|---|---|---|
| Absences (range) | `_getAbsencesViaRest(startDate, endDate, studentId)` | `/WebUntis/api/classreg/absences/students` | Date range and student filtering |

**Status:** ✅ REST-based (MMM-Webuntis)

**Implementation Details:**
- Endpoint: `/WebUntis/api/classreg/absences/students`
- Parameters: `startDate`, `endDate` (YYYYMMDD format), `studentId` for parent accounts
- Response structure: `{ data: { absences: [...] } }`
- Parent account support: ✅ Fully supported via `studentId` parameter
- HTML sanitization: Applied to absence text fields
- Date filtering: Server-side filtering via date range parameters

---

### 5) Messages of the Day

| Data category | Module function | REST endpoint | Notes |
|---|---|---|---|
| News widget | `_getMessagesOfDayViaRest(date)` | `/WebUntis/api/public/news/newsWidgetData` | REST endpoint with date parameter |

**Status:** ✅ REST-based (MMM-Webuntis)

**Implementation Details:**
- Endpoint: `/WebUntis/api/public/news/newsWidgetData`
- Parameters: `date` (YYYYMMDD format)
- Response structure: `{ data: { messagesOfDay: [...] } }`
- HTML sanitization: Text content is sanitized to remove HTML tags, preserves line breaks
- Caching: Messages are fetched once per day based on configuration interval

---

### 6) Holidays

| Data category | Module function | `webuntis` library | REST endpoint | Notes |
|---|---|---|---|---|
| School holidays/breaks | `getHolidays()` | `getHolidays()` | `/WebUntis/api/holidays` | All school holidays |

**Status:** ✅ REST-based

---

### 7) Authentication & Session

| Action | Module function | `webuntis` library | REST endpoint | Notes |
|---|---|---|---|---|
| Login | `login()` | `login()` (WebUntis, WebUntisQR) | `/WebUntis/jsonrpc.do?school=...` → session cookie | JSON-RPC used for login |
| Logout | `logout()` | `logout()` | `/WebUntis/jsonrpc.do?school=...` | JSON-RPC used for logout |
| Validate session | `validateSession()` | `validateSession()` | `/WebUntis/api/latest/importtime` | REST validation |
| Request Bearer token | *(not in module)* | *Manual via `/api/token/new`* | `/WebUntis/api/token/new` | For direct REST access |

**Status:** ✅ REST-based (after login)

**Note:** Login/logout uses JSON-RPC, but most subsequent API access is REST.

---

## Summary: REST vs. JSON-RPC

### ✅ Fully REST-based (MMM-Webuntis)
1. ✅ Lessons / timetable (via `webuntis` library)
2. ✅ Exams (via `/WebUntis/api/exams`)
3. ✅ Homework (via `/WebUntis/api/homeworks/lessons`)
4. ✅ Absences (via `/WebUntis/api/classreg/absences/students`)
5. ✅ Messages of Day (via `/WebUntis/api/public/news/newsWidgetData`)
6. ✅ Holidays (via `webuntis` library)
7. ✅ Session validation (via REST)

### 🔒 JSON-RPC (Authentication only)
- Login / logout (session cookie)
- No other JSON-RPC calls needed for data retrieval

---

## Endpoint overview (table)

| Data type | REST endpoint | Type | Params | Function |
|---|---|---|---|---|
| Timetable (week) | `/WebUntis/api/klassen/{id}/timeline` | GET | `week` | `getOwnTimetableForWeek()` |
| Timetable (range) | `/WebUntis/api/klassen/{id}/timetable` | GET | `from`, `to` | `getOwnTimetableForRange()` |
| Timetable (student) | `/WebUntis/api/students/{id}/timetable` | GET | `from`, `to` | `getTimetableForRange()` |
| Exams | `/WebUntis/api/exams` | GET | `startDate`, `endDate` (YYYYMMDD) | `_getExamsViaRest()` |
| Homework | `/WebUntis/api/homeworks/lessons` | GET | `startDate`, `endDate` (YYYYMMDD) | `_getHomeworkViaRest()` ⭐ Parallel arrays |
| Absences | `/WebUntis/api/classreg/absences/students` | GET | `startDate`, `endDate` (YYYYMMDD), `studentId` | `_getAbsencesViaRest()` |
| Holidays | `/WebUntis/api/holidays` | GET | - | `getHolidays()` |
| News widget | `/WebUntis/api/public/news/newsWidgetData` | GET | `date` | `getNewsWidget()` ⚠️ |
| Time grid | `/WebUntis/api/timegrid` | GET | - | `getTimegrid()` |
| Session validation | `/WebUntis/api/latest/importtime` | GET | - | `validateSession()` |
| Bearer token | `/WebUntis/api/token/new` | POST | - | *(not in module)* |

---

## Conclusion

**Yes, all module data is accessible via REST endpoints**. This is the current implementation in MMM-Webuntis:

- ✅ Lessons/timetable (via `webuntis` library)
- ✅ Exams = reliable via REST (`/WebUntis/api/exams`)
- ✅ Homework = reliable via REST (`/WebUntis/api/homeworks/lessons` with parallel arrays)
- ✅ Absences = reliable via REST (`/WebUntis/api/classreg/absences/students`)
- ✅ Messages of the day = reliable via REST (`/WebUntis/api/public/news/newsWidgetData`)

### Parent Account Support ✅
All REST endpoints support parent account access via `studentId` parameter (where applicable):
- Exams: Via `studentId` filtering in response
- Homework: Fetches all homework (no explicit studentId parameter, but shared endpoint)
- Absences: Via explicit `studentId` parameter
- Messages: Global messages (not student-specific)

### Key Implementation Notes

1. **Date Format:** All REST endpoints use YYYYMMDD format (e.g., `20251219`)
2. **Response Structure:** Most endpoints follow `{ data: { ... } }` nesting
3. **Homework Special Case:** `/WebUntis/api/homeworks/lessons` returns parallel arrays
   - `homeworks[]` array contains homework items
   - `lessons[]` array contains lesson metadata
   - Join via `homework.lessonId` → `lesson.id`
   - Use `lesson.subject` or `lesson.su[0]` for subject name
4. **HTML Sanitization:** Applied to all text fields to prevent XSS attacks


