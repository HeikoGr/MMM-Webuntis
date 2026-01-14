# Data Transformations in MMM-Webuntis

**Last Updated**: 2026-01-14
**Status**: Complete analysis of all time, date, and data transformations

## Overview

Data flows through multiple transformation layers in MMM-Webuntis, from WebUntis REST API → Backend services → Frontend rendering. This document maps all transformations.

---

## 1. Data Flow Layers

```
WebUntis REST API
    ↓ (raw response)
webuntisApiService.js (getTimetable, getExams, getAbsences, etc.)
    ↓ (minor normalization)
payloadCompactor.js (compactArray with schemas)
    ↓ (heavy transformation)
payloadBuilder.js (buildGotDataPayload)
    ↓ (Socket → JSON)
Frontend: MMM-Webuntis.js
    ↓ (distribute to widgets)
widgets/*.js (render with formatDate, formatTime)
    ↓ (HTML output)
User sees final time/date
```

---

## 2. Time Transformations (HHMM Format)

### 2.1 API → Backend (webuntisApiService.js)

**Input Format**: WebUntis REST API returns times in **HHMM integer format**
- Example: `1350` = 13:50 (1 PM 50 minutes)
- `startTime: 1350, endTime: 1600` = 13:50 - 16:00

**Transformation in webuntisApiService.js**:
```javascript
// NO TRANSFORMATION - pass through as-is (since 2026-01-14 fix)
const startTimeHHMM = Number.isFinite(abs.startTime) ? abs.startTime : null;
// startTime: 1350 → 1350
```

**Output**: HHMM integer (e.g., `1350`)

**Files**:
- [getTimetable()](lib/webuntisApiService.js#L164) - passes timetable times as-is
- [getExams()](lib/webuntisApiService.js#L199) - passes exam times as-is
- [getAbsences()](lib/webuntisApiService.js#L377) - **FIXED: now passes absence times as-is**
- [getHomework()](lib/webuntisApiService.js#L234) - homework doesn't use times
- [getMessagesOfDay()](lib/webuntisApiService.js#L428) - messages don't use times

---

### 2.2 Backend → Compact (payloadCompactor.js - Explicit Transformers)

---

### 2.2 Backend → Compact (payloadCompactor.js - Explicit Transformers)

**Deterministic Logic**: No guessing needed - data source is always known

**Transformer Functions**:
```javascript
// REST API sends HHMM integers (1350 = 13:50)
// Simply validates and returns: MM must be 0-59, HH must be 0-23
function normalizeRestApiTime(hhmm) {
  const mm = hhmm % 100;
  const hh = Math.floor(hhmm / 100);
  if (mm >= 0 && mm <= 59 && hh >= 0 && hh <= 23) return hhmm;
  return null;
}

// Timegrid sends HH:MM strings ("13:50")
// Parse string to HHMM integer
function normalizeTimegridTime(hhmmStr) {
  const [hh, mm] = hhmmStr.split(':').map(x => parseInt(x, 10));
  if (mm >= 0 && mm <= 59 && hh >= 0 && hh <= 23) {
    return hh * 100 + mm;
  }
  return null;
}
```

**Schema Patterns**:
```javascript
// lesson: may come from REST API or timegrid
startTime: {
  transform: (v) => normalizeRestApiTime(v) ?? normalizeTimegridTime(v),
  default: null
}

// exam: always from REST API
startTime: {
  transform: (v) => normalizeRestApiTime(v),
  default: null
}

// absence: always from REST API
startTime: {
  transform: (v) => normalizeRestApiTime(v),
  default: null
}
```

**Files**:
- [payloadCompactor.js#161-178](lib/payloadCompactor.js#L161) - normalizeRestApiTime()
- [payloadCompactor.js#180-205](lib/payloadCompactor.js#L180) - normalizeTimegridTime()
- [payloadCompactor.js#50-72](lib/payloadCompactor.js#L50) - schemas.lesson
- [payloadCompactor.js#87-100](lib/payloadCompactor.js#L87) - schemas.exam
- [payloadCompactor.js#127-135](lib/payloadCompactor.js#L127) - schemas.absence

---

### 2.3 Compact → Socket (payloadBuilder.js)

**Transformation**: None - compact data is passed directly

```javascript
const compactAbsences = fetchAbsences ? compactArray(rawAbsences, schemas.absence) : [];
// Input: [{startTime: 1350, endTime: 1600, ...}]
// Output: [{startTime: 1350, endTime: 1600, ...}] (unchanged)
```

**Files**:
- [payloadBuilder.js#62-68](lib/payloadBuilder.js#L62) - compacting all data types

---

### 2.4 Socket → Frontend (widgets/util.js - formatTime)

**Input Format**: HHMM integer (e.g., `1350`)

**Transformation**:
```javascript
function formatTime(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (s.includes(':')) return s;  // already formatted

  const digits = s.replace(/\D/g, '').padStart(4, '0');
  // 1350 → "1350" → "1350".padStart(4, '0') → "1350"
  return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  // "13" + ":" + "50" = "13:50" ✓
}
```

**Examples**:
| Input | digits | Output |
|-------|--------|--------|
| `1350` | "1350" | "13:50" |
| `750` | "0750" | "07:50" |
| `830` | "0830" | "08:30" |
| `"13:50"` | "1350" | "13:50" |

**Files**:
- [widgets/util.js#137-143](widgets/util.js#L137) - formatTime implementation
- [widgets/absences.js#92](widgets/absences.js#L92) - used for absence times
- [widgets/lessons.js#...](widgets/lessons.js) - used for lesson times
- [widgets/exams.js#...](widgets/exams.js) - used for exam times
- [widgets/grid.js#...](widgets/grid.js) - used for grid display

---

## 3. Date Transformations (YYYYMMDD Format)

### 3.1 API → Backend (webuntisApiService.js)

**Input Format**: WebUntis REST API returns dates in **YYYYMMDD integer format**
- Example: `20260116` = 2026-01-16

**Transformation**: None - passed through as-is

```javascript
// In all data fetching functions:
date: abs.date ?? abs.startDate ?? abs.absenceDate ?? abs.day ?? null
// Input: 20260116 → Output: 20260116
```

**Files**:
- [webuntisApiService.js#164-200](lib/webuntisApiService.js#L164) - all data types

---

### 3.2 Backend → Compact (payloadCompactor.js)

**Transformation in schemas**:
```javascript
date: {
  from: 'date',
  transform: (v) => parseInt(String(v).replace(/\D/g, ''), 10) || 0
}
```

Removes all non-digits and parses as integer:
- `20260116` → `"20260116"` → `20260116` (unchanged)
- `"2026-01-16"` → `"20260116"` → `20260116` (dashes removed)

**Files**:
- [payloadCompactor.js#100](lib/payloadCompactor.js#L100) - lesson.date
- [payloadCompactor.js#125](lib/payloadCompactor.js#L125) - exam.examDate
- [payloadCompactor.js#165](lib/payloadCompactor.js#L165) - absence.date

---

### 3.3 Socket → Frontend (widgets/util.js - formatDate)

**Input Format**: YYYYMMDD integer (e.g., `20260116`)

**Transformation**:
```javascript
function formatDate(ymd, format = 'dd.MM.yyyy') {
  // ymd = 20260116
  const day = ymd % 100;              // 16
  const month = Math.floor(ymd / 100) % 100;  // 01
  const year = Math.floor(ymd / 10000);  // 2026

  // Create Date object
  const dt = new Date(year, month - 1, day);

  // Format using Intl.DateTimeFormat (respects language/locale)
  return new Intl.DateTimeFormat(locale, {...}).format(dt);
  // Result: "Do, 16.01.2026" or "Thursday, 01/16/2026" depending on locale
}
```

**Supported Format Tokens**:
| Token | Example Output |
|-------|----------------|
| `yyyy` | 2026 |
| `yy` | 26 |
| `dd` | 16 |
| `d` | 16 |
| `mm` | 01 |
| `m` | 1 |
| `EEE` | Do (German), Thu (English) |
| `EEEE` | Donnerstag (German), Thursday (English) |

**Files**:
- [widgets/util.js#50-90](widgets/util.js#L50) - formatDate implementation
- [widgets/absences.js#80](widgets/absences.js#L80) - used for absence dates
- [widgets/lessons.js#...](widgets/lessons.js) - used for lesson dates
- [widgets/exams.js#...](widgets/exams.js) - used for exam dates

---

## 4. Other Data Transformations

### 4.1 HTML Sanitization (payloadCompactor.js - sanitizeHtml)

**Used For**: reason, text, name, subject fields

**Transformation**:
```javascript
function sanitizeHtml(text, allowMarkdown = false) {
  // 1. Convert line break tags to newlines
  result.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')...

  // 2. Strip all tags EXCEPT allowed formatting tags
  // Allowed: <b>, <strong>, <i>, <em>, <u>, <s>, <strike>, <del>, <sub>, <sup>, <small>

  // 3. Decode HTML entities (&nbsp;, &amp;, &lt;, &gt;, &quot;, &#39;)

  // 4. Remove extra whitespace and clean up
  result.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ')
}
```

**Example**:
```
Input:  "Arztbesuch&nbsp;&nbsp;Zahnarzt<br/>Visit"
Output: "Arztbesuch  Zahnarzt\nVisit"
```

**Used In**:
- [payloadCompactor.js#123](lib/payloadCompactor.js#L123) - exam.name, exam.subject
- [payloadCompactor.js#180](lib/payloadCompactor.js#L180) - homework.text
- [payloadCompactor.js#169](lib/payloadCompactor.js#L169) - absence.reason

**Files**:
- [payloadCompactor.js#280-320](lib/payloadCompactor.js#L280) - sanitizeHtml implementation

---

### 4.2 Subject Formatting (payloadCompactor.js - formatSubject)

**Input**: Subject object or array from API

**Transformation**:
```javascript
function formatSubject(su) {
  if (typeof su === 'object' && !Array.isArray(su)) {
    return { name: su.name || '', longname: su.longname || '' };
  }
  if (Array.isArray(su) && su[0]) {
    return { name: su[0].name || '', longname: su[0].longname || '' };
  }
  return null;
}
```

**Used In**: homework.su

---

## 5. Architecture Decision: No Compatibility Layers

### Synchronous Updates Principle

**Decision**: Frontend and backend always update together in production (MagicMirror² module versioning). No need for compatibility layers or guessing logic.

**Example: Absence Time Transformation**

Before (with guessing):
```javascript
// normalizeToHHMM() tries to guess if 1350 is HHMM or minutes-since-midnight
// This is fragile and leads to bugs
function normalizeToHHMM(v) {
  // Complex heuristic that sometimes gets it wrong
  if (n >= 0 && n < 24 * 60) {  // 1350 < 1440 = TRUE ❌
    const hh = Math.floor(1350 / 60);  // Treats as minutes → 22
    const mm = 1350 % 60;              // → 30
    return 2230;  // WRONG! (displayed as 22:10 - 16:00)
  }
}
```

After (deterministic):
```javascript
// REST API contract: always sends HHMM integers (1350 = 13:50)
// No guessing needed
function normalizeRestApiTime(hhmm) {
  const mm = hhmm % 100;           // 50 (valid minutes)
  const hh = Math.floor(hhmm / 100);  // 13 (valid hours)
  if (mm >= 0 && mm <= 59 && hh >= 0 && hh <= 23) {
    return hhmm;  // 1350 ✓ (displayed as 13:50 - 16:00)
  }
  return null;
}
```

**Files Changed** (2026-01-14):
- `lib/payloadCompactor.js` - Removed `normalizeToHHMM()`, kept explicit transformers only
- Updated all schemas to use `normalizeRestApiTime() ?? normalizeTimegridTime()`
- `.github/copilot-instructions.md` - Documented "no compatibility layer" principle


---

## 6. Transformation Chains (Complete Examples)

### Example 1: Absence Time

```
API Response:
{
  "startDate": 20260116,
  "startTime": 1350,
  "endTime": 1600,
  "reason": "Arztbesuch"
}
  ↓ getAbsences() [webuntisApiService.js#L377]
{
  "date": 20260116,
  "startTime": 1350,
  "endTime": 1600,
  "reason": "Arztbesuch"
}
  ↓ compactArray(rawAbsences, schemas.absence) [payloadCompactor.js#165-180]
{
  "date": 20260116,           // parseInt("20260116") = 20260116
  "startTime": 1350,          // normalizeRestApiTime(1350) = 1350 ✓
  "endTime": 1600,            // normalizeRestApiTime(1600) = 1600 ✓
  "reason": "Arztbesuch",     // sanitizeHtml("Arztbesuch") = "Arztbesuch"
  "excused": true,
  ...
}
  ↓ Socket.IO to Frontend
{
  "date": 20260116,
  "startTime": 1350,
  "endTime": 1600,
  ...
}
  ↓ absences.js renders each absence
formatDate(20260116, 'EEE dd.MM.') → "Do 16.01."
formatTime(1350) → "13:50"
formatTime(1600) → "16:00"
  ↓ HTML Output
"Do 16.01. - 13:50-16:00 Arztbesuch"
```

### Example 2: Lesson Time

```
API Response (getTimetable):
{
  "date": 20260114,
  "startTime": 750,     // 07:50
  "endTime": 840        // 08:40
}
  ↓ webuntisApiService.getTimetable() - pass through as-is
{
  "date": 20260114,
  "startTime": 750,
  "endTime": 840
}
  ↓ compactArray(timetable, schemas.lesson)
{
  "date": 20260114,     // parseInt("20260114") = 20260114
  "startTime": 750,     // normalizeRestApiTime(750) → 750 ✓
  "endTime": 840,       // normalizeRestApiTime(840) → 840 ✓
  ...
}
  ↓ Widget renders
formatTime(750) → "07:50"
```

### Example 3: Grid Display (uses minutes internally)

```
API Response:
timegrid[0] = {
  "startTime": "07:50",    // HH:MM format from API
  "endTime": "08:40"
}
  ↓ Transform in payloadCompactor
"07:50" → normalizeTimegridTime("07:50") → 750
  → split(":")  → ["07", "50"]
  → hh=7, mm=50
  → 7*100+50 = 750 ✓

Grid widget internally converts for time calculations:
  → _toMinutes(750)
  → 7*60 + 50 = 470 minutes

Then back to display:
  → formatTime(750) → "07:50"
```

---

## 7. Configuration & Locale Impact

### Date Formatting Respects Config

```javascript
// In MMM-Webuntis.js config:
{
  language: "de",  // German
  modules: [{
    config: {
      lessons: { dateFormat: "EEE dd.MM." },
      exams: { dateFormat: "EEE dd.MM." },
      absences: { dateFormat: "EEE dd.MM." }
    }
  }]
}
```

**Impact**:
- `EEE` with language="de" → "Do" (Donnerstag)
- `EEE` with language="en" → "Thu" (Thursday)
- `dd.MM.yyyy` → German format (16.01.2026)
- `MM/dd/yyyy` → US format (01/16/2026)

**Files**:
- [widgets/util.js#50-90](widgets/util.js#L50) - uses `config.language` for Intl.DateTimeFormat

---

## 8. Summary Table: Where Transformations Happen

| Data Type | Format | Layer 1 (API) | Layer 2 (Backend) | Layer 3 (Compact) | Layer 4 (Widget) | Final Display |
|-----------|--------|---------------|------------------|-------------------|------------------|---------------|
| **Time (startTime, endTime)** | HHMM int (1350) | Pass-through | Pass-through | normalizeRestApiTime | formatTime | "13:50" |
| **Date (date, examDate)** | YYYYMMDD int (20260116) | Pass-through | Pass-through | parseInt (remove dashes) | formatDate | "Do 16.01." |
| **Reason/Text** | HTML string | As-is | As-is | sanitizeHtml | As-is | Clean text |
| **Subject** | obj/array | As-is | As-is | formatSubject | Display name | "Deutsch" |
| **Timegrid** | HH:MM string ("07:50") | As-is | As-is | normalizeTimegridTime | formatTime | "07:50" |

---

## 9. Testing & Validation

### Test Cases for Time Transformation

```javascript
// normalizeRestApiTime test cases (REST API HHMM integers)
normalizeRestApiTime(1350)   // → 1350 ✓
normalizeRestApiTime(750)    // → 750 ✓
normalizeRestApiTime(1600)   // → 1600 ✓
normalizeRestApiTime(830)    // → 830 ✓
normalizeRestApiTime(null)   // → null ✓

// normalizeTimegridTime test cases (Timegrid HH:MM strings)
normalizeTimegridTime("13:50")   // → 1350 ✓
normalizeTimegridTime("07:50")   // → 750 ✓
normalizeTimegridTime("16:00")   // → 1600 ✓
normalizeTimegridTime("08:30")   // → 830 ✓
normalizeTimegridTime(null)      // → null ✓
```

### Frontend Test Cases (formatTime)

```javascript
formatTime(1350) → "13:50" ✓
formatTime(750)  → "07:50" ✓
formatTime("13:50") → "13:50" ✓ (already formatted)
formatTime(null) → "" ✓
```

---

## References

- [WebUntis API Discovery](docs/01-research/API_ARCHITECTURE.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Issue History](docs/ISSUES.md)
