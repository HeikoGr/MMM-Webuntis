# API v3 Manifest (Current Runtime Contract)

Status:
- current shipped runtime contract
- runtime contract version is `3`
- this document describes the payload currently emitted and consumed by the module

Scope of this document:
- describe the current backend -> frontend runtime contract for widget-agnostic, canonically normalized data
- define which logic belongs in transport and which stays frontend-owned
- document the reusable domain contract consumed by the shipped frontend plugins

Out of scope:
- external WebUntis REST and JSON-RPC details
- historical compatibility fields
- CSS, DOM, animation, or widget layout details

For the historical V2 contract, see [API_V2_MANIFEST.md](API_V2_MANIFEST.md).

---

## 1. Contract Principles

- Frontend and backend are shipped together.
- Runtime contract version is fixed at `3`.
- No legacy alias fields are required inside V3.
- V3 is plugin-agnostic.
- V3 transports reusable domain data, not plugin-specific view models.
- The backend may normalize field names, value formats, status values, and text sanitization.
- The backend must not emit arrays or objects whose meaning depends on one specific plugin.
- V3 does not ship HTML layout fragments, CSS class decisions, animation directives, or plugin placement instructions as part of the contract.

Meaning of the split:
- `data` contains canonical normalized domain facts.
- `context` contains the runtime frame needed to interpret those facts.
- `state` contains runtime reliability and warning state.
- frontend plugins consume the same domain contract and build their own sorting, grouping, filtering, and presentation decisions in the frontend.
- if multiple plugins need the same derivation, that derivation belongs in shared frontend utilities rather than in the transport contract.

---

## 2. Contract Intent

V3 keeps the transport focused on normalized domain data instead of plugin-specific view models.

Practical consequences:

- field names are readable rather than transport-shortened
- date and time values are normalized consistently
- domain collections are reusable across multiple plugins
- plugins derive their own sorting, grouping, and display decisions in the frontend

---

## 3. Explicit Non-Goals

The following logic remains frontend-owned and is not part of the V3 transport contract:

- plugin-specific view arrays or slices such as lessons lists, exams lists, absence lists, or grid-only structures
- day-window expansion for one specific plugin
- empty-day rows or placeholder entries for one specific plugin
- sort orders whose only purpose is one plugin layout
- primary-field selection such as "first teacher to show in this plugin"
- short-vs-long display choices that depend on plugin config
- localized display labels and browser-locale formatting
- now-line position
- live minute-based past-state updates between fetches
- DOM layout, ticker animation, split-view placement, or CSS class assembly
- viewport-specific rendering behavior

Current constraint:
- teacher-specific break supervision behavior is important, but not reliably testable in the current environment
- V3 keeps the canonical lesson-level markers required by grid rendering, especially `displayIcons`, activity and change markers, and enough lesson structure for `BREAK_SUPERVISION` handling
- V3 does not flatten grid semantics into an opaque backend layout model

---

## 4. Top-level Shape

Canonical V3 shape:

```json
{
	"contractVersion": 3,
	"meta": {},
	"context": {},
	"data": {},
	"state": {}
}
```

Required top-level fields:

| Field | Type | Meaning |
| --- | --- | --- |
| `contractVersion` | number | Must be `3` |
| `meta` | object | Technical metadata |
| `context` | object | Student/config/runtime frame |
| `data` | object | Canonical normalized domain facts |
| `state` | object | Runtime reliability and warning state |

V3 intentionally has no `views` top-level section.

---

## 5. `meta`

V3 keeps the current metadata pattern.

Required fields:
- `moduleVersion`
- `generatedAt`
- `moduleId`
- `sessionId`

Optional technical additions:
- `apiVersion` for a human-readable transport label such as `"v3"`

Allowed technical additions:
- runtime environment details such as platform and process metadata
- debug metadata that does not change the transport meaning

---

## 6. `context`

Representative shape:

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
	}
}
```

Required fields remain:
- `student.id`
- `student.title`
- `config`
- `timezone`
- `todayYmd`
- `range.startYmd`
- `range.endYmd`

Rule changes for V3:
- `context.config` remains part of the contract
- the contract does not derive plugin-specific helper arrays from config
- frontend may use `context.config` for presentation and plugin-local derivation
- backend may internally use config for fetch decisions, but those decisions must not appear as plugin-specific transport structures

---

## 7. `data` Domain Layer

`data` is the center of V3.

It contains reusable normalized facts that are valid independently of any single plugin. A plugin may derive its own view from these facts, but the transport itself stays at the domain layer.

Representative shape:

```json
{
	"timeUnits": [],
	"lessons": [],
	"dayNotices": [],
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

Required canonical collections:
- `timeUnits`
- `lessons`
- `dayNotices`
- `exams`
- `homework`
- `absences`
- `messages`
- `holidays.ranges`
- `holidays.current`

Why these remain in V3:
- they are reusable domain inputs across current plugins
- they allow additional plugins to be implemented without requiring backend plugin-specific slices
- cross-plugin relationships remain visible instead of being hidden behind one plugin's derived output
- grid still depends on canonical lesson data and related calendar inputs

### 7.1 Common normalization rules

V3 should normalize shared structural concerns consistently across collections.

Dates:
- all date fields are normalized to `YYYYMMDD` integers such as `20260310`

Times:
- all time fields are normalized to `HHMM` integers such as `750` or `1335`
- missing times are `null`

Field naming:
- transport field names use readable canonical names rather than compact abbreviations
- naming must be consistent across collections for the same domain concept

Text fields:
- transport may sanitize upstream text content
- transport must not inject widget markup or layout-specific HTML
- if upstream rich-text content is preserved, it must stay semantic and sanitized, not widget-owned presentation markup

Enums and statuses:
- transport may normalize awkward upstream value sets into stable canonical values
- transport should avoid mutually exclusive boolean pairs when one structural value communicates the same fact more clearly

### 7.2 `data.lessons[]`

V3 keeps a rich canonical lesson schema.

It must still include enough information for:
- change-state rendering
- `HOMEWORK`, `EXAM`, `EVENT`, `MOVED`, and `BREAK_SUPERVISION` markers
- teacher, class, student-group, and room context
- period references and time-based calculations
- frontend-derived sorting, grouping, empty-day detection, and lesson-display choices

Representative fields:
- `id`
- `date`
- `startTime`
- `endTime`
- `status`
- `displayIcons[]`
- `subjects[]`
- `teachers[]`
- `rooms[]`
- `classes[]`
- `studentGroups[]`
- `info[]`
- `substitutionText`
- `lessonText`
- `changedFields[]`
- `previousSubjects[]`
- `previousTeachers[]`
- `previousRooms[]`

Field naming rule for V3 lesson data:
- `subjects[]` replaces `su[]`
- `teachers[]` replaces `te[]`
- `rooms[]` replaces `ro[]`
- `classes[]` replaces `cl[]`
- `studentGroups[]` replaces `sg[]`
- `substitutionText` replaces `substText`
- `lessonText` replaces `lstext`
- `previousSubjects[]` replaces `suOld[]`
- `previousTeachers[]` replaces `teOld[]`
- `previousRooms[]` replaces `roOld[]`
- `changedFields[]` should use readable field identifiers such as `subject`, `teacher`, `room`, `class`, `studentGroup`, or `info`

Implementation warning for the `changedFields[]` rename:
Renaming the values inside `changedFields[]` is not an adapter-internal change. Two frontend files embed the V2 abbreviation strings as literal lookup values:
- `lib/frontendShared.js#getChangedFieldSet()` synthesizes the change set from `suOld`/`teOld`/`roOld` presence and explicitly adds the strings `'su'`, `'te'`, `'ro'`
- `plugins/grid/frontend.js` checks `changedFields.has('su')`, `.has('te')`, `.has('ro')` and uses string literals `'te'` and `'ro'` in a filter expression at multiple call sites

Both files must be updated in the same change that renames the transport values. If only the adapter emits the new names while these callers still expect the old abbreviations, change rendering in both the grid and lessons plugins will break silently.

### 7.3 `data.exams[]`

V3 keeps exams as canonical domain records rather than as a plugin-specific list.

Representative fields:
- `examDate`
- `startTime`
- `endTime`
- `name`
- `subject`
- `teachers[]`
- `text`

Design rule:
- do not add fields such as `teacherPrimary`, `sortKey`, or list-only flags whose only purpose is one exam widget layout

### 7.4 `data.absences[]`

V3 keeps absences as canonical domain records rather than as a plugin-specific list.

Representative fields:
- `date`
- `startTime`
- `endTime`
- `reason`
- `excused`
- `student`
- `subjects[]`
- `teachers[]`
- `lessonId`

Field naming rule for V3 absence data:
- `subjects[]` replaces `su[]`
- `teachers[]` replaces `te[]`

Excused-state rule:
- the excused state remains a single canonical domain field
- if V3 keeps the current raw tri-state, `excused` must be `true`, `false`, or `null`
- V3 must not introduce mutually exclusive booleans such as `isExcused` and `isUnexcused`

Design rule:
- do not add plugin-only date-window flags, prefiltered list slices, or display labels for the absences plugin

### 7.5 `data.homework[]`

Homework remains canonical domain data.

Representative fields:
- `id`
- `lid`
- `lessonId`
- `studentId`
- `elementIds[]`
- `dueDate`
- `completed`
- `text`
- `remark`
- `subject`

Field naming rule for V3 homework data:
- `subject` replaces `su`

Design rule:
- keep homework structural and reusable; do not bake plugin-specific sorting or grouping into the transport

### 7.6 `data.messages[]`

Messages remain canonical domain data.

Representative fields:
- `id`
- `subject`
- `text`
- `isExpanded`

Design rule:
- message content may be sanitized, but the transport must not add widget-owned markup or expansion layout structures

### 7.7 `data.dayNotices[]`, `data.holidays`, and `data.timeUnits[]`

These collections remain explicit because they are reusable primitives for multiple frontend derivations.

Examples:
- lessons plugins can derive empty-day states from `lessons[]`, `dayNotices[]`, and `holidays`
- grid can derive headers, day boundaries, and time-based placement from `timeUnits[]`
- other plugins can derive calendar summaries or attendance overlays from the same shared sources

Design rule:
- transport should ship the primitive facts required for these derivations, not prebuilt empty-day rows, day windows, or plugin-grouped slices

---

## 8. Frontend Responsibilities

Because V3 is plugin-agnostic, the frontend remains responsible for turning canonical data into plugin-specific views.

This includes:
- sorting within a plugin view
- filtering by plugin-specific date windows or visibility rules
- grouping by day, period, or section
- deriving empty-day placeholders from `lessons[]`, `dayNotices[]`, and `holidays`
- deciding whether short or long field names are displayed
- deciding which teacher, room, or subject is shown as the primary display value
- deriving past-state or live-state flags from `todayYmd`, local time, and current clock state
- localized label selection and browser-locale date formatting
- grid-specific overlap handling, break supervision placement, and now-line rendering

Recommended frontend architecture consequence:
- if more than one plugin needs the same derivation, implement it in shared frontend helpers
- do not push the derivation into the backend unless it becomes a genuine domain fact instead of a plugin concern

Rationale:
- this keeps the transport reusable for new plugins
- this avoids backend coupling to today's plugin inventory
- this prevents the API contract from becoming a grab bag of one-off list shapes

---

## 9. `state`

V3 keeps the current runtime-state structure.

Representative shape:

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

No plugin-specific changes are required here.

---

## 10. Stability Rules

- Frontend code must reject any runtime payload where `contractVersion !== 3` once the V3 implementation is activated.
- V3 canonical collection names remain:
  - `lessons`
  - `exams`
  - `homework`
  - `absences`
  - `messages`
- V3 has no `views` top-level section.
- New transport additions should prefer canonical domain fields over plugin-derived helper arrays.
- If a new plugin needs data that is missing, add the missing domain fact rather than a plugin-specific slice.
- New live UI behavior must not be smuggled into the contract as pseudo-static flags.

---

## 11. Migration Strategy

Recommended implementation order:

1. Finalize the plugin-agnostic V3 contract: `meta`, `context`, `data`, and `state` only.
2. Rename transport abbreviations to readable canonical field names across domain collections.
3. Switch frontend payload acceptance from V2 to V3 in one coordinated change.
4. Update frontend plugins and shared utilities to consume the renamed canonical fields from `data.*`.
5. Move repeated derivation logic into shared frontend helpers instead of backend payload builders.
6. Keep grid on canonical lesson data until teacher break supervision and overlap behavior are covered better.

Atomic deployment requirement:
The field renames inside `data.*` cannot be staged independently. Current plugins and frontend helpers read the old field names directly. Therefore the following files must all change in a single coordinated update:
- `lib/mmm-adapter/mmmPayloadMapper.js` - adapter schema field renames + `contractVersion: 3`
- `lib/frontendShared.js#getChangedFieldSet()` - rename the synthesized strings `'su'`, `'te'`, `'ro'` to `'subject'`, `'teacher'`, `'room'`
- `plugins/grid/frontend.js` - update all `changedFields.has('su'|'te'|'ro')` and the filter expression using these strings, update `el.substText` -> `el.substitutionText`, `el.lstext` -> `el.lessonText`, `el.suOld` -> `el.previousSubjects`, `el.teOld` -> `el.previousTeachers`, `el.roOld` -> `el.previousRooms`, and the `su`/`te`/`ro`/`cl`/`sg` field accesses
- `plugins/lessons/frontend.js` - update `su`/`te`/`ro`/`suOld`/`teOld`/`roOld`/`substText`/`lstext` field accesses
- `plugins/absences/frontend.js` - update frontend absence field access to canonical absence field names
- `plugins/homework/frontend.js` - update frontend homework field access to the canonical homework field name
- `MMM-Webuntis.js` - update `contractVersion` check from `2` to `3`

Explicitly deferred:
- plugin-specific backend view models
- removal of canonical `data.lessons[]`
- collapsing calendar primitives into one widget-owned structure

---

## 12. Testing Implications

What should be testable during V3 implementation:
- payload version handling
- absence of a `views` top-level section
- canonical field-name migration across `lessons`, `absences`, and `homework`
- frontend helper derivations that replace former plugin-local transport assumptions
- grid compatibility with renamed lesson fields and renamed `changedFields[]` values

What is currently difficult to test reliably and should therefore stay conservative:
- teacher-specific break supervision rendering behavior
- complex grid overlap combinations that depend on live CSS layout and animation behavior

Implementation rule derived from that constraint:
- do not let V3 remove canonical grid-relevant lesson markers before those scenarios have practical regression coverage
