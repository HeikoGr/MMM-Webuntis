# API v2 Manifest (Backend <-> Frontend)

Normative transport contract for MMM-Webuntis runtime payloads.

Scope of this document:
- frontend -> backend request shape used by `INIT_MODULE` and `FETCH_DATA`
- backend -> frontend `GOT_DATA` payload shape
- canonical field names and stability rules

Out of scope:
- external WebUntis REST / JSON-RPC details
- historical migration notes
- implementation TODOs

For external endpoint behavior, see [API_REFERENCE.md](API_REFERENCE.md).

---

## 1. Contract Principles

- Frontend and backend are shipped together.
- Runtime contract version is fixed at `2`.
- No legacy alias fields are part of the supported contract.
- Anything not documented here should be treated as implementation detail, not public contract.

---

## 2. Frontend -> Backend Request Shape

`INIT_MODULE` and `FETCH_DATA` currently send the effective module config as a flat payload plus session metadata.

Canonical shape:

```json
{
  "id": "MMM-Webuntis_0",
  "sessionId": "abc123xyz",
  "reason": "periodic",
  "displayMode": "grid, lessons, exams",
  "mode": "verbose",
  "timezone": "Europe/Berlin",
  "updateInterval": 300000,
  "students": [
    {
      "title": "Student A",
      "studentId": 1001
    }
  ],
  "grid": {
    "nextDays": 4,
    "pastDays": 0
  }
}
```

Rules:
- `id` identifies the module instance.
- `sessionId` identifies the active browser-window session.
- `reason` is optional operational metadata.
- The remaining top-level fields are the effective module config payload.
- This request shape is not versioned separately from the runtime code and is therefore documented here as the current canonical behavior.

---

## 3. Backend -> Frontend `GOT_DATA`

Top-level shape:

```json
{
  "contractVersion": 2,
  "meta": {},
  "context": {},
  "data": {},
  "state": {}
}
```

### 3.1 Required Top-level Fields

| Field | Type | Meaning |
|-------|------|---------|
| `contractVersion` | number | Must be `2` |
| `meta` | object | Technical metadata |
| `context` | object | Student/config/runtime frame |
| `data` | object | Render-relevant domain data |
| `state` | object | Runtime and reliability state |

---

## 4. `meta`

Example:

```json
{
  "moduleVersion": "<package-version>",
  "generatedAt": "2026-03-10T12:00:00.000Z",
  "moduleId": "MMM-Webuntis_0",
  "sessionId": "abc123xyz"
}
```

Required fields:
- `moduleVersion`
- `generatedAt`
- `moduleId`
- `sessionId`

Additional technical debug metadata may be present, but frontend logic should only rely on the fields above unless code explicitly introduces a new documented requirement.

---

## 5. `context`

Example:

```json
{
  "student": {
    "id": 1001,
    "title": "Student A"
  },
  "config": {
    "title": "Student A",
    "displayMode": "grid, lessons, exams",
    "debugDate": null
  },
  "timezone": "Europe/Berlin",
  "todayYmd": 20260310,
  "range": {
    "startYmd": 20260310,
    "endYmd": 20260314
  },
  "display": {
    "mode": "verbose",
    "widgets": ["grid", "lessons", "exams"]
  }
}
```

Required fields:
- `student.id`
- `student.title`
- `config`
- `timezone`
- `todayYmd`
- `range.startYmd`
- `range.endYmd`
- `display.mode`
- `display.widgets`

Notes:
- `context.config` is currently part of the runtime contract because frontend rendering resolves per-student widget configuration from it.
- `display.widgets` uses canonical widget names: `grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`.

---

## 6. `data`

Example:

```json
{
  "timeUnits": [],
  "lessons": [],
  "exams": [],
  "homework": [],
  "absences": [],
  "messages": [],
  "holidays": {
    "ranges": [],
    "current": null
  }
}
```

Required collections:
- `timeUnits`
- `lessons`
- `exams`
- `homework`
- `absences`
- `messages`
- `holidays.ranges`
- `holidays.current`

Canonical naming rules:
- `homework` is singular
- `messages` is the canonical transport field even though the upstream endpoint returns `messagesOfDay`
- No alias fields such as `homeworks`, `messagesOfDay`, or `_warnings` belong to the contract

### 6.1 `data.timeUnits[]`

```json
{
  "startTime": 750,
  "endTime": 845,
  "name": "1"
}
```

Rules:
- times are transported as HHMM integers
- leading zeros are formatting concern, not transport concern

### 6.2 `data.lessons[]`

Representative shape:

```json
{
  "id": 500001,
  "date": 20260310,
  "start": 750,
  "end": 935,
  "status": "REGULAR",
  "displayIcons": ["HOMEWORK", "EXAM"],
  "subject": [{ "name": "SUB", "long": "Subject" }],
  "teacher": [{ "name": "TCH", "long": "Teacher" }],
  "room": [{ "name": "R.01", "long": "Room 01" }],
  "class": [],
  "studentGroup": [],
  "info": [],
  "texts": {
    "substitution": "",
    "lesson": ""
  },
  "changes": {
    "fields": [],
    "oldTeacher": [],
    "oldSubject": [],
    "oldRoom": []
  }
}
```

The exact lesson schema is intentionally rich because grid and lessons widgets depend on change-state and normalized display markers.
`displayIcons[]` contains normalized lesson markers derived from timetable metadata, for example `HOMEWORK`, `EXAM`, `EVENT`, `BREAK_SUPERVISION`, or `MOVED`.

### 6.3 `data.exams[]`

```json
{
  "date": 20260312,
  "start": 750,
  "end": 935,
  "name": "Exam 1",
  "subject": "SUB",
  "teachers": ["TCH"],
  "text": "Exam description"
}
```

### 6.4 `data.homework[]`

```json
{
  "id": 700001,
  "lessonId": 500001,
  "studentId": 1001,
  "dueDate": 20260314,
  "completed": false,
  "subject": { "name": "SUB", "long": "Subject" },
  "text": "Homework text",
  "remark": "",
  "elementIds": [1001]
}
```

`homework.lessonId` references `lesson.id` from `data.lessons[]`.

### 6.5 `data.absences[]`

```json
{
  "id": 800001,
  "date": 20260311,
  "start": 950,
  "end": 1225,
  "excused": true,
  "reason": "Medical appointment",
  "text": "Excused absence"
}
```

### 6.6 `data.messages[]`

```json
{
  "id": 900001,
  "subject": "",
  "text": "<b>Message text</b>",
  "expanded": false
}
```

### 6.7 `data.holidays`

```json
{
  "ranges": [
    {
      "id": 3001,
      "name": "Holiday",
      "longName": "Holiday period",
      "startDate": 20260315,
      "endDate": 20260315
    }
  ],
  "current": null
}
```

Rule:
- a day-level holiday lookup map is frontend-derived runtime state, not part of transport contract

---

## 7. `state`

Example:

```json
{
  "fetch": {
    "timegrid": true,
    "timetable": true,
    "exams": true,
    "homework": true,
    "absences": true,
    "messages": true
  },
  "api": {
    "timetable": 200,
    "exams": 200,
    "homework": 200,
    "absences": 200,
    "messages": 200
  },
  "warnings": [],
  "warningMeta": []
}
```

Required fields:
- `fetch`
- `api`
- `warnings`
- `warningMeta`

Rules:
- `warnings` contains user-visible warning strings.
- `warningMeta` contains deterministic metadata per warning message.
- warning transport remains valid even for fallback payloads after per-student fetch failures.

Representative `warningMeta[]` entry:

```json
{
  "message": "Cannot reach WebUntis server for Student A",
  "kind": "network",
  "severity": "critical",
  "status": 0,
  "code": "NETWORK_ERROR"
}
```

---

## 8. Stability Rules

- Frontend code should reject any payload where `contractVersion !== 2`.
- Canonical transport field names are:
  - `lessons`
  - `exams`
  - `homework`
  - `absences`
  - `messages`
- Internal compatibility aliases are not part of the public contract.
- Any newly required field must be added here before it is relied upon by frontend code.

---

## 9. Debug Dumps

Debug dumps may contain richer structures than runtime transport.

They are useful for:
- tracing raw API input to normalized payload output
- investigating payload compaction and warning assembly
- reproducing frontend rendering with offline fixtures

They are not the runtime contract and should never be treated as one.
