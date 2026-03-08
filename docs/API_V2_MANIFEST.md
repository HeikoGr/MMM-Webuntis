# API v2 Manifest (Backend ↔ Frontend)

**Status:** Implemented (runtime contract v2 in production)
**Date:** 2026-03-02
**Scope:** `node_helper.js` ↔ `MMM-Webuntis.js` payload contract

---

## 1) Decision (binding)

- A clean break is allowed and intended.
- Frontend and backend are always shipped together.
- No fallback paths, no legacy wrappers, no dual-path runtime behavior.
- V2 is a strict contract with clearly defined required fields.

---

## 2) Goals of API v2

- **Deterministic contract:** one field name = one meaning = one type.
- **Bidirectional contract:** FE→BE request contract and BE→FE response contract are both explicitly documented.
- **Clear separation of layers:**
  - domain data (`data`)
  - runtime/reliability state (`state`)
  - technical metadata (`meta`)
- **No transport legacy baggage:** no mixed alias fields such as `homeworks|homework`, `warnings|_warnings`.
- **Widget logic remains in frontend:** presentation decisions stay in `widgets/*.js`.
- **Clean debug separation:** debug dump can be rich, runtime payload stays lean.
- **Data minimization in docs:** no personal data in examples.

---

## 3) Findings from current dumps (basis for v2)

### 3.1 `*_api.json` (current structure)

Currently observed weaknesses:
- `config` contains too much runtime/internal material (including full defaults and internal markers).
- Warnings were historically inconsistent (`warnings` vs `_warnings`).
- Status/fetch information used to be scattered at top level instead of grouped.
- Payload can contain more than what rendering strictly needs.

Interpretation:
- **Config is mandatory on request path** (FE → BE), because the backend must work correctly even after restarts.
- **Current runtime state:** BE still sends `context.config` in `GOT_DATA` so frontend can reliably resolve per-student widget configuration.

### 3.2 `raw_api_*.json` (WebUntis raw data)

Useful raw-data properties:
- Timetable provides rich position objects (`position1..7`, `status`, `activityType`, `layoutWidth`).
- Absences provide clear fields (`isExcused`, `reason`, `startDate`, `startTime`, `endTime`).
- Messages include HTML text that must be controlled via backend sanitizing.
- Homework and exams include ID-based relations and student-specific assignment.

**Consequence for v2:** Raw data stays internal; frontend receives normalized, render-friendly objects only.

---

## 4) API v2 Contract (new, bidirectional)

## 4.0 FE → BE (request contract, mandatory)

This contract applies to `INIT_MODULE` and `FETCH_DATA`.

```json
{
  "contractVersion": 2,
  "moduleId": "module_1_MMM-Webuntis",
  "sessionId": "session-uuid",
  "config": {
    "updateInterval": 300000,
    "timezone": "Europe/Berlin",
    "displayMode": "grid,lessons,exams",
    "students": [
      { "id": 1001, "title": "Student A" }
    ]
  }
}
```

Rules:
- `config` is sent on **every** `FETCH_DATA`.
- No implicit dependency on persistent backend process memory.
- Self-healing after backend restart must work without special-case paths.

---

## 4.1 BE → FE (response contract, `GOT_DATA`)

## 4.1 Top level

```json
{
  "contractVersion": 2,
  "meta": {},
  "context": {},
  "data": {},
  "state": {}
}
```

### A) `contractVersion` (required)

- Type: `number`
- Value: `2`
- Strictly validated by frontend on receive.

### B) `meta` (technical)

```json
{
  "generatedAt": "2026-03-02T12:22:21.968Z",
  "moduleVersion": "0.7.2",
  "sessionId": "...",
  "moduleId": "module_1_MMM-Webuntis"
}
```

### C) `context` (domain frame)

```json
{
  "student": {
    "id": 1001,
    "title": "Student A"
  },
  "timezone": "Europe/Berlin",
  "todayYmd": 20260302,
  "range": {
    "startYmd": 20260302,
    "endYmd": 20260306
  },
  "display": {
    "mode": "verbose",
    "widgets": ["lessons", "exams", "grid", "messagesofday", "absences"]
  }
}
```

### D) `data` (render-relevant, stable)

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

### E) `state` (runtime/reliability)

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
  "warningMeta": [
    {
      "message": "Cannot reach WebUntis server for ...",
      "kind": "network",
      "severity": "critical",
      "status": 0,
      "code": "NETWORK_ERROR"
    }
  ]
}
```

Important:
- `warnings` is allowed **only** in `state.warnings`.
- `warningMeta` carries deterministic classification (`kind`, `severity`, optional `status`/`code`) for warning handling in frontend.
- `_warnings` is fully removed.
- `absencesUnavailable` is replaced by `state.api.absences` + `warnings`.
- On per-student fetch exceptions, backend still emits a valid `GOT_DATA` fallback payload (empty `data.*`, populated `state.warnings`/`state.warningMeta`) so frontend can always show and clear runtime warnings deterministically.

---

## 4.2 Field definitions by data type

## `data.timeUnits[]`

```json
{
  "startTime": 750,
  "endTime": 845,
  "name": "1"
}
```

- Primary fields are `startTime`/`endTime`/`name`.
- Time values are HHMM (typically integers; frontend also accepts string formats for compatibility).
- Leading zero is not stored numerically: `0750` is transported as `750`.
- Rendering/formatting uses zero-padding (`750` → `"07:50"`).
- Validation: minute range `00..59`, hour range `00..23`.

## `data.lessons[]`

```json
{
  "id": 500001,
  "date": 20260302,
  "start": 750,
  "end": 935,
  "status": "REGULAR",
  "statusDetail": null,
  "activityType": "NORMAL_TEACHING_PERIOD",
  "layoutWidth": 1000,
  "subject": [{ "name": "SUB", "long": "Subject" }],
  "teacher": [{ "name": "TCH", "long": "Teacher" }],
  "room": [{ "name": "R.01", "long": "Room 01" }],
  "class": [],
  "studentGroup": [{ "name": "G1", "long": "Group 1" }],
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

## `data.exams[]`

```json
{
  "date": 20260309,
  "start": 750,
  "end": 935,
  "name": "Exam 1",
  "subject": "SUB",
  "teachers": ["TCH"],
  "text": "Exam description"
}
```

## `data.homework[]`

```json
{
  "id": 700001,
  "lessonId": 500001,
  "studentId": 1001,
  "dueDate": 20260304,
  "completed": false,
  "subject": { "name": "SUB", "long": "Subject" },
  "text": "Homework text",
  "remark": "",
  "elementIds": [1001]
}
```

## `data.absences[]`

```json
{
  "id": 800001,
  "date": 20260211,
  "start": 950,
  "end": 1225,
  "excused": true,
  "reason": "Medical appointment",
  "text": "Excused absence"
}
```

## `data.messages[]`

```json
{
  "id": 900001,
  "subject": "",
  "text": "<b>Message text</b>",
  "expanded": false
}
```

## `data.holidays`

```json
{
  "ranges": [
    { "id": 3001, "name": "Holiday", "longName": "Holiday period", "startDate": 20260305, "endDate": 20260305 }
  ],
  "current": null
}
```

Note:
- Single-day holidays are modeled via `startDate === endDate` in `ranges`.
- A day-level lookup (`byDate`) is a **derived frontend runtime cache**, not part of the transport contract.

---

## 5) Hard naming rules (v2)

- Only these plural forms are valid in the contract:
  - `lessons`, `exams`, `homework`, `absences`, `messages`
- No historical alternatives.
- No technical prefixes in domain fields (`_warnings`, `__legacyUsed`, etc.).

---

## 6) Runtime vs debug dump separation

## 6.1 Runtime payload (socket `GOT_DATA`)

- Minimal, stable, render-oriented.
- No internal backend objects.
- Includes deterministic warning classification via `state.warningMeta`.
- Guarantees warning transport even on per-student fetch exceptions (fallback `GOT_DATA` envelope).

Note:
- Full config remains mandatory in the **request contract** (`INIT_MODULE`/`FETCH_DATA`).
- Current runtime still includes `context.config` for deterministic frontend config resolution.

## 6.2 Debug dump (`debug_dumps/*_api.json`)

- May be richer, but with its own structure:

```json
{
  "snapshotVersion": 2,
  "meta": {},
  "input": {
    "raw": {
      "timetable": "raw_api_..._timetable.json",
      "exams": "raw_api_..._exams.json",
      "homework": "raw_api_..._homework.json",
      "absences": "raw_api_..._absences.json",
      "messages": "raw_api_..._messagesofday.json"
    }
  },
  "output": {
    "payload": { "contractVersion": 2, "...": "..." }
  },
  "state": {
    "warnings": [],
    "api": {}
  }
}
```

**Benefit:** Clear traceability from raw input to transformed v2 payload.

---

## 7) TODO (without legacy/fallback behavior)

## Phase A – Freeze contract
- [ ] Confirm `docs/API_V2_MANIFEST.md` as single source of truth
- [ ] Freeze final field names
- [ ] Document required/optional status per field
- [ ] Define nullability rules per field

## Phase B – Backend alignment
- [x] Migrate `buildGotDataPayload()` to v2 shape
- [ ] Align `payloadCompactor` schemas with v2 naming
- [x] Unify warning source to `state.warnings`
- [ ] Generate `context.display.widgets` from `displayMode`
- [ ] Keep response payload lean while preserving deterministic config behavior

## Phase C – Frontend alignment
- [x] Make `MMM-Webuntis.js` accept only `contractVersion === 2`
- [x] Move ingestion to `data.*` + `state.*`
- [x] Remove normalization/alias fallback paths
- [ ] Map widget renderers fully to finalized field names

## Phase D – Debug/observability
- [ ] Move dump format to `snapshotVersion: 2`
- [ ] Add explicit linkage to `raw_api_*` dumps
- [x] Keep sensitive-field redaction

## Phase E – Cleanup
- [ ] Remove old payload paths in backend and frontend
- [ ] Remove remaining `_warnings`/legacy readers
- [ ] Keep docs aligned (`ARCHITECTURE.md`, `API_REFERENCE.md`, `CONFIG.md`)

---

## 8) Acceptance criteria (Definition of Done)

- Frontend renders all widgets correctly with v2 payload.
- No legacy aliases/fallbacks remain in runtime code.
- `GOT_DATA` contains exactly `contractVersion/meta/context/data/state`.
- Debug dumps clearly show raw data → v2 output mapping.
- Lint/check/debug run without new warnings.

---

## 9) Non-goals

- No backward-compatible mixed runtime mode.
- No support for older payload versions.
- No extra compatibility abstraction layer only for legacy support.
