# WebUntis API Testing Guide

## Overview

This document describes the calendar-entry/detail API endpoint, its capabilities, limitations, and the testing infrastructure for exploring WebUntis REST APIs.

**Status**: Research completed (2026-03-16)
**Verdict**: Keep existing production API architecture - more efficient and complete
**Test Tool**: `scripts/test_api_endpoint.js` for future API exploration

---

## Calendar Entry Detail API
### Endpoint

```
GET /WebUntis/api/rest/view/v2/calendar-entry/detail
```

### Authentication

Requires Bearer token authentication with additional headers:
- `Authorization: Bearer <token>`
- `Tenant-Id: <tenantId>`
- `X-Webuntis-Api-School-Year-Id: <schoolYearId>`

### Query Parameters

| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `elementId` | integer | Yes | Student ID or other element identifier | `12345` |
| `elementType` | integer | Yes | Element type (5 = student) | `5` |
| `startDateTime` | ISO 8601 | Yes | Start of time range (inclusive) | `2026-03-17T00:00:00` |
| `endDateTime` | ISO 8601 | Yes | End of time range (inclusive) | `2026-03-17T23:59:00` |
| `homeworkOption` | string | No | Homework filter option | `DUE` |

#### Element Types

- `5` = Student (primary use case)
- Other types exist but are undocumented in this testing

#### Homework Options

- `DUE` - Only homework due in the specified period
- Other options undocumented

### Response Structure

**Original WebUntis API Response** (calendar-entry/detail endpoint):

```json
{
  "calendarEntries": [
    {
      "id": 123456,
      "lesson": {
        "id": 78901,
        "periodId": 567,
        "periodNumber": 1
      },
      "startDateTime": "2026-03-17T08:00:00",
      "endDateTime": "2026-03-17T08:45:00",
      "subject": {
        "id": 101,
        "shortName": "Ma",
        "longName": "Mathematics",
        "displayName": "Math"
      },
      "teachers": [
        {
          "id": 201,
          "shortName": "SMI",
          "longName": "Smith",
          "displayName": "Ms. Smith",
          "status": "REGULAR"
        }
      ],
      "rooms": [
        {
          "id": 301,
          "shortName": "101",
          "longName": "Room 101",
          "displayName": "101",
          "status": "REGULAR"
        }
      ],
      "mainStudentGroup": {
        "id": 401,
        "name": "5A"
      },
      "klasses": [
        {
          "id": 401,
          "shortName": "5A",
          "longName": "Class 5A"
        }
      ],
      "lessonInfo": "Regular lesson",
      "substText": null,
      "status": "TAKING_PLACE",
      "type": "NORMAL_TEACHING_PERIOD",
      "color": "#FF6B6B",
      "permissions": {
        "canEdit": false
      },
      "students": [],
      "homeworks": [
        {
          "id": 501,
          "dateTime": "2026-03-10T00:00:00",
          "dueDateTime": "2026-03-17T23:59:00",
          "text": "Complete exercises 1-10",
          "remark": "Study chapter 5",
          "completed": false,
          "attachments": []
        }
      ],
      "exam": {
        "id": 601,
        "name": "Chapter 5 Test",
        "description": "Topics: Algebra, Equations",
        "typeLongName": "Written test"
      },
      "teachingContent": "Introduction to quadratic equations",
      "teachingContentFiles": [],
      "notesAll": [],
      "notesAllFiles": [],
      "notesStaff": [],
      "notesStaffFiles": [],
      "videoCall": null,
      "originalCalendarEntry": null,
      "absenceReasonId": null
    }
  ]
}
```

### Key Features

**Embedded Data** (Rich single-source response):
- ✅ Lessons (with full details)
- ✅ Homeworks (embedded in lessons)
- ✅ Exams (embedded in lessons)
- ✅ Teaching content (text descriptions)
- ✅ Notes (teacher/student notes)
- ✅ Attachments (file references)
- ✅ Video call links (for online lessons)

**Additional Fields**:
- Color coding (`color`)
- Substitution text (`substText`)
- Lesson information (`lessonInfo`)
- Entry status (`status`: TAKING_PLACE, CANCELLED, etc.)
- Entry type (`type`: NORMAL_TEACHING_PERIOD, etc.)
- Permissions (edit/view capabilities)

### Critical Limitations

#### 1. Single-Day Limitation ⚠️

**CRITICAL**: The API only returns data for the **FIRST DAY** of the requested range, regardless of date parameter values.

**Test Results**:
```bash
# Request: March 17-19 (3 days)
# Result: Only March 17 data returned

# Request: March 16-20 (5 days)
# Result: Only March 16 data returned

# Request: March 18 (1 day)
# Result: March 18 data returned correctly
```

**Implication**: To fetch a week of data, you must make **5 separate API calls** (one per school day).

#### 2. Missing Substitution History ⚠️

**IMPORTANT**: This comparison references MMM-Webuntis **internal transformed fields**, not the original API response.

**Original WebUntis Timetable API Format** (`/timetable/entries` endpoint - position-based with substitution tracking):

```json
{
  "position1": [
    {
      "current": {
        "type": "TEACHER",
        "status": "ADDED",
        "shortName": "SMI",
        "longName": "Smith"
      },
      "removed": {
        "type": "TEACHER",
        "status": "REMOVED",
        "shortName": "JON",
        "longName": "Jones"
      }
    }
  ],
  "position2": [...],  // SUBJECT
  "position3": [...],  // ROOM
  "position4": [...],  // CLASS/STUDENT_GROUP
  "position5": [...],  // Additional positions
  "position6": [...],
  "position7": [...]
}
```

**MMM-Webuntis Transformation** (in `lib/webuntisApiService.js#mapPositionsToFields`):

The module transforms the position-based format into named fields:
- `position1-7[].current` (type=TEACHER) → `te[]` array
- `position1-7[].current` (type=SUBJECT) → `su[]` array
- `position1-7[].current` (type=ROOM) → `ro[]` array
- `position1-7[].removed` (type=TEACHER) → `teOld[]` array
- `position1-7[].removed` (type=SUBJECT) → `suOld[]` array
- `position1-7[].removed` (type=ROOM) → `roOld[]` array
- Fields with `removed != null` → `changedFields[]` array

**Calendar-Entry API**: Does **not** have the `position1-7` structure with `current`/`removed` pairs. It only provides current values:
- `teachers[]` - Current teachers only (no `removed` equivalent)
- `subject` - Current subject only (no `removed` equivalent)
- `rooms[]` - Current rooms only (no `removed` equivalent)
- `originalCalendarEntry` - Exists but is `null` in tested responses

**Impact**: Without the original values, you cannot display substitution information like "Math changed to Physics, Ms. Smith replaces Mr. Jones".

#### 3. Absences Not Included

Despite including `exams` and `homeworks`, the calendar-entry API does **not** include absence information. Absences require a separate endpoint:

```
GET /WebUntis/api/rest/view/v1/students/{studentId}/absences
```

This means even with calendar-entry, you still need the absences endpoint.

---

## API Comparison: Production APIs vs calendar-entry/detail

### Field Coverage Comparison

**Important**: This section compares **original API responses** from WebUntis, not MMM-Webuntis internal formats.

#### Timetable Data

| Field | timetable/entries API (Original) | calendar-entry/detail API (Original) | Notes |
|-------|--------------------------------|-------------------------------------|-------|
| `id` | ✅ | ✅ | Lesson/entry ID |
| `lessonId` | ✅ | ✅ (`lesson.id`) | Unique lesson identifier |
| `startTime` | ✅ (HHMM int) | ✅ (`startDateTime` ISO) | Different formats |
| `endTime` | ✅ (HHMM int) | ✅ (`endDateTime` ISO) | Different formats |
| `date` | ✅ (YYYYMMDD int) | ✅ (ISO datetime) | Different formats |
| **Substitution Tracking** | | | |
| `position1` - `position7` | ✅ | ❌ | **timetable/entries only: position-based with `current`/`removed` pairs** |
| `position[].current` | ✅ | ❌ | **timetable/entries only: current teacher/subject/room** |
| `position[].removed` | ✅ | ❌ | **timetable/entries only: CRITICAL for substitution history** |
| `originalCalendarEntry` | ❌ | ⚠️ | **calendar-entry: exists but null in tests** |
| **Resource Fields** | | | |
| `teachers` | ✅ (in positions) | ✅ (direct array) | Different structure |
| `subject` | ✅ (in positions) | ✅ (direct object) | Different structure |
| `rooms` | ✅ (in positions) | ✅ (direct array) | Different structure |
| `klasses` | ✅ (in positions) | ✅ (direct array) | Class info |
| `mainStudentGroup` | ❌ | ✅ | calendar-entry: primary student group |
| **Status & Display** | | | |
| `status` | ✅ | ✅ | Status code (REGULAR, CHANGED, etc.) |
| `type` | ✅ | ✅ | Activity type |
| `substText` | ✅ (`substitutionText`) | ✅ | Substitution text |
| `lessonInfo` | ✅ | ✅ | Lesson information text |
| `color` | ❌ | ✅ | calendar-entry: color coding |
| **Additional Features (calendar-entry only)** | | | |
| `teachingContent` | ❌ | ✅ | **Lesson content description** |
| `teachingContentFiles` | ❌ | ✅ | **Attached teaching files** |
| `notesAll` | ❌ | ✅ | **Public notes** |
| `notesStaff` | ❌ | ✅ | **Staff-only notes** |
| `videoCall` | ❌ | ✅ | **Online lesson link** |
| `absenceReasonId` | ❌ | ⚠️ | **Always null in tests** |

**Key Difference**: The `timetable/entries` API uses `position1-7` arrays with `current`/`removed` pairs for substitution tracking. The `calendar-entry/detail` API provides direct `teachers`, `subject`, `rooms` arrays but no `removed` equivalents.

#### Homework Data

| Field | homeworks/lessons API (Original) | calendar-entry (embedded) | Notes |
|-------|--------------------------------|------------------------------|-------|
| `id` | ✅ | ✅ | Homework ID |
| `lessonId` | ✅ | ❌ | homeworks/lessons: associated lesson; calendar-entry: implicit via parent entry |
| `dueDate` | ✅ (YYYYMMDD int or date string) | ❌ | homeworks/lessons field name |
| `date` | ✅ (fallback) | ❌ | homeworks/lessons: assignment date |
| `dateTime` | ❌ | ✅ (ISO datetime) | calendar-entry: assignment date |
| `dueDateTime` | ❌ | ✅ (ISO datetime) | calendar-entry: due date |
| `text` | ✅ | ✅ | Homework description |
| `remark` | ✅ | ✅ | Additional notes |
| `completed` | ✅ | ✅ | Completion status |
| `attachments` | ✅ | ✅ | File attachments |

**Result**: Similar data, but different field names (`dueDate` vs `dueDateTime`).

#### Exam Data

**Important**: In the calendar-entry API, exams are embedded in calendar entries. Context (date, time, teachers, subject) comes from the parent `calendarEntry`, not the `exam` object itself.

| Field | exams API (Original) | calendar-entry.exam (Original) | Notes |
|-------|---------------------|-----------------------------------|-------|
| `id` | ✅ | ✅ | Exam ID |
| `name` | ✅ | ✅ | Exam name |
| `examDate` / `date` | ✅ (YYYYMMDD int) | ❌ | exams API: explicit date; calendar-entry: from parent `startDateTime` |
| `startTime` / `start` | ✅ (HHMM int) | ❌ | exams API: explicit time; calendar-entry: from parent |
| `endTime` / `end` | ✅ (HHMM int) | ❌ | exams API: explicit time; calendar-entry: from parent |
| `subject` / `lessonName` | ✅ | ❌ | exams API: explicit; calendar-entry: from parent `subject` |
| `teachers` | ✅ (array) | ❌ | exams API: explicit; calendar-entry: from parent `teachers` |
| `text` / `description` | ✅ | ✅ | Exam description |
| `examType` | ✅ | ❌ | exams API: exam type string |
| `typeLongName` | ❌ | ✅ | calendar-entry: exam type string |
| `assignedStudents` | ✅ | ❌ | exams API: student filtering |

**Result**: calendar-entry exams are simplified - contextual information (date, time, teachers, subject) must be obtained from the parent `calendarEntry` object.

### Performance Comparison

#### Existing Production API Architecture (5 calls per week)

```
Week data fetch (Mon-Fri):
1. GET /timetable/entries?startDate=20260316&endDate=20260320   → All lessons for 5 days
2. GET /exams?startDate=20260316&endDate=20260320                → All exams for 5 days
3. GET /homeworks/lessons?startDate=20260316&endDate=20260320    → All homeworks for 5 days
4. GET /students/{id}/absences?startDate=20260316&endDate=20260320 → All absences
5. GET /news?startDate=20260316&endDate=20260320                 → All messages

Total: 5 API calls
```

#### Hypothetical calendar-entry/detail Architecture (7 calls per week)

```
Week data fetch (Mon-Fri):
1. GET /calendar-entry/detail?...&startDateTime=2026-03-16T00:00:00&endDateTime=2026-03-16T23:59:00
2. GET /calendar-entry/detail?...&startDateTime=2026-03-17T00:00:00&endDateTime=2026-03-17T23:59:00
3. GET /calendar-entry/detail?...&startDateTime=2026-03-18T00:00:00&endDateTime=2026-03-18T23:59:00
4. GET /calendar-entry/detail?...&startDateTime=2026-03-19T00:00:00&endDateTime=2026-03-19T23:59:00
5. GET /calendar-entry/detail?...&startDateTime=2026-03-20T00:00:00&endDateTime=2026-03-20T23:59:00
6. GET /students/{id}/absences?startDate=20260316&endDate=20260320 → Still needed!
7. GET /news?startDate=20260316&endDate=20260320                   → Still needed!

Total: 7 API calls (40% MORE than existing architecture)
```

### Verdict

**❌ Do NOT migrate to calendar-entry/detail API**

**Reasons**:
1. **Performance**: 40% more API calls (7 vs 5)
2. **Missing substitution data**: No `position[].removed` fields to track original teachers/subjects/rooms before changes
3. **Absences still separate**: No reduction in endpoint count
4. **Single-day limitation**: Fundamentally incompatible with efficient batch fetching
5. **Date format complexity**: Requires conversion from integers to ISO 8601 strings

**Keep existing production architecture**: More efficient, complete data, designed for batch operations.

**Future use case**: Consider calendar-entry/detail for **supplemental data**:
- `teachingContent` - Lesson descriptions
- `notes` - Teacher/student notes
- `videoCall` - Online lesson links
- `attachments` - Additional materials

---

## API Testing Tool

### Purpose

`scripts/test_api_endpoint.js` provides a flexible way to test arbitrary WebUntis REST API endpoints without deep integration into the module.

### Features

- ✅ Flexible endpoint testing with any parameters
- ✅ Authentication via existing config (QR code, username/password, parent accounts)
- ✅ Auto-save all responses to `debug_dumps/` directory
- ✅ Metadata tracking (timestamp, endpoint, params, status, duration)
- ✅ CLI flags for different output modes
- ✅ Multi-student support

### Installation

No installation needed - uses existing project dependencies.

### Usage

#### Basic Syntax

```bash
node scripts/test_api_endpoint.js "<endpoint-with-params>" [options]
```

#### Options

| Flag | Description |
|------|-------------|
| `--debug` | Show detailed auth and request information |
| `--raw` | Output raw JSON response (no formatting) |
| `--student=N` | Test with specific student (0-based index) |

#### Example: Calendar Entry Detail

```bash
# Test calendar-entry for March 17, 2026 (student ID: 12345)
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v2/calendar-entry/detail?elementId=12345&elementType=5&startDateTime=2026-03-17T00:00:00&endDateTime=2026-03-17T23:59:00&homeworkOption=DUE"

# With debug information
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v2/calendar-entry/detail?elementId=12345&elementType=5&startDateTime=2026-03-17T00:00:00&endDateTime=2026-03-17T23:59:00&homeworkOption=DUE" \
  --debug

# Test with second student in config
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v2/calendar-entry/detail?elementId=67890&elementType=5&startDateTime=2026-03-17T00:00:00&endDateTime=2026-03-17T23:59:00&homeworkOption=DUE" \
  --student=1

# Raw JSON output (for piping)
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v2/calendar-entry/detail?elementId=12345&elementType=5&startDateTime=2026-03-17T00:00:00&endDateTime=2026-03-17T23:59:00" \
  --raw | jq '.calendarEntries[] | {subject: .subject.longName, start: .startDateTime}'
```

#### Example: Other Endpoints

```bash
# Test timetable/entries API
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v1/timetable/entries?elementId=12345&elementType=5&startDate=20260317&endDate=20260321"

# Test exams API
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v1/exams?studentId=12345&startDate=20260317&endDate=20260321"

# Test homework API
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v1/homeworks/lessons?studentId=12345&startDate=20260317&endDate=20260321"

# Test absences API
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v1/students/12345/absences?startDate=20260301&endDate=20260331"

# Test news/messages API
node scripts/test_api_endpoint.js \
  "/WebUntis/api/rest/view/v1/news?studentId=12345&startDate=20260317&endDate=20260321"
```

### Output

#### Console Output

```
=== WebUntis API Test ===

Endpoint: /WebUntis/api/rest/view/v2/calendar-entry/detail
Status: 200 OK (543 ms)

=== Response ===
{
  "calendarEntries": [
    {
      "id": 123456,
      "lesson": {"id": 78901},
      "startDateTime": "2026-03-17T08:00:00",
      "endDateTime": "2026-03-17T08:45:00",
      "subject": {"id": 42, "shortName": "Ma", "longName": "Mathematics"},
      "teachers": [{"id": 201, "shortName": "SMI"}],
      ...
    }
  ]
}

=== Analysis ===
Total entries: 5
Unique dates: 1 (2026-03-17)
```

#### Debug Dump File

Automatically saved to `debug_dumps/<timestamp>_<endpoint-slug>_api-test.json`:

```json
{
  "metadata": {
    "timestamp": "2026-03-16T11:25:03.123Z",
    "endpoint": "/WebUntis/api/rest/view/v2/calendar-entry/detail",
    "params": "elementId=12345&elementType=5&startDateTime=2026-03-17T00:00:00&endDateTime=2026-03-17T23:59:00&homeworkOption=DUE",
    "status": 200,
    "duration": 543,
    "studentConfig": {
      "name": "Student A",
      "studentId": 12345
    }
  },
  "response": {
    "calendarEntries": [...]
  }
}
```

### Analyzing Results

Use `jq` for JSON analysis:

```bash
# Count entries
cat debug_dumps/2026-03-16T11-25-03_v2-calendar-entry-detail_api-test.json | jq '.response.calendarEntries | length'

# Extract unique dates
cat debug_dumps/2026-03-16T11-25-03_v2-calendar-entry-detail_api-test.json | jq '[.response.calendarEntries[].startDateTime | split("T")[0]] | unique'

# Show only subjects
cat debug_dumps/2026-03-16T11-25-03_v2-calendar-entry-detail_api-test.json | jq '.response.calendarEntries[] | {subject: .subject.longName, start: .startDateTime}'

# Check for homeworks
cat debug_dumps/2026-03-16T11-25-03_v2-calendar-entry-detail_api-test.json | jq '.response.calendarEntries[] | select(.homeworks | length > 0) | {subject: .subject.longName, homework: .homeworks[0].text}'

# Check for exams
cat debug_dumps/2026-03-16T11-25-03_v2-calendar-entry-detail_api-test.json | jq '.response.calendarEntries[] | select(.exam != null) | {subject: .subject.longName, exam: .exam.name}'
```

### Authentication

The script uses your existing `config/config.js` configuration:

- **QR Code Auth**: Uses `qrCodeData` if present
- **Username/Password**: Uses `username`, `password`, `school`, `server`
- **Parent Auth**: Uses `parentUsername`, `parentPassword`
- **Multi-student**: Automatically loads correct config for `--student=N` flag

### Troubleshooting

#### Authentication Failed (401)

```
Error: Request failed: 401 Unauthorized
```

**Solution**: Check your config file has valid credentials:
```bash
# Test auth explicitly
node scripts/test_api_endpoint.js "/WebUntis/api/rest/view/v1/timetable/entries?elementId=12345&elementType=5&startDate=20260317&endDate=20260317" --debug
```

#### Bad Request (400)

```
Error: Request failed: 400 Bad Request
```

**Solution**: Check parameter format:
- `elementId` must be an integer
- `elementType` must be valid (5 = student)
- Dates must be `YYYY-MM-DDTHH:MM:SS` for calendar-entry/detail or `YYYYMMDD` for other endpoints
- No extra spaces in URL

#### No Data Returned

```
Total entries: 0
```

**Possible causes**:
1. No lessons scheduled for that date (weekend/holiday)
2. Wrong `elementId` (student ID)
3. Date out of current school year
4. API limitation (calendar-entry/detail only returns first day)

**Verify date**:
```bash
date -d "2026-03-17" +"%A"  # Should be a weekday
```

---

## Recommendations

### For Production Use

1. **Keep existing production API architecture**
   - More efficient (5 calls vs 7 calls)
   - Complete substitution data
   - Designed for batch operations

2. **Use test_api_endpoint.js for exploration**
   - Test new endpoints before integration
   - Debug API issues
   - Compare data structures

3. **Consider calendar-entry/detail for supplemental data only**
   - Fetch once per day (not per week)
   - Use for `teachingContent`, `notes`, `videoCall`, `attachments`
   - Don't replace primary timetable/homework/exam APIs

### For API Development

1. **Always test multi-day ranges**
   - Some APIs may have single-day limitations
   - Verify actual returned date ranges

2. **Compare field coverage**
   - Check for missing fields critical to your use case
   - Especially substitution history fields

3. **Measure performance impact**
   - Count total API calls required
   - Consider rate limiting

4. **Document limitations**
   - Update this document with findings
   - Share discoveries with community

---

## Related Documentation

- [API_REFERENCE.md](API_REFERENCE.md) - Full WebUntis API reference
- [API_V2_MANIFEST.md](API_V2_MANIFEST.md) - Internal payload format
- [ARCHITECTURE.md](ARCHITECTURE.md) - System architecture
- [SERVER_REQUEST_FLOW.md](SERVER_REQUEST_FLOW.md) - Runtime fetch and retry behavior

Endpoint discovery is handled by the testing workflow and `scripts/discover_endpoints.sh`; there is no separate endpoint-discovery document.

---

## Changelog

**2026-03-16**: Initial documentation
- Documented calendar-entry/detail API
- Identified single-day limitation
- Created comprehensive API comparison
- Documented test_api_endpoint.js tool
- Verdict: Keep existing production architecture
