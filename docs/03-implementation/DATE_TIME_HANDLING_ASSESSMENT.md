# Date/Time Handling Strategy Assessment: Strings vs. Date Objects

**Date:** December 2024
**Context:** Analysis of current string-based date handling in MMM-Webuntis and evaluation of parsing to Date objects early in the node_helper backend.

---

## Executive Summary

**Recommendation: CONTINUE STRING-BASED APPROACH** with the current architecture.

Current approach (numeric YYYYMMDD + HHMM strings) is **optimal** for this module because:
1. **No timezone complexity** - MagicMirror typically runs in a single school's timezone
2. **Direct API compatibility** - No parsing overhead; pass dates directly to REST endpoints (WebUntis API expects YYYYMMDD)
3. **Frontend simplicity** - Widgets perform date formatting only when displaying (via `Intl.DateTimeFormat`)
4. **Minimal memory footprint** - Integers and strings are lighter than Date objects
5. **Locale-aware formatting** - Browser's Intl API handles all locale variants automatically
6. **Lower error risk** - Fewer moving parts means fewer timezone/DST edge cases

---

## Current Architecture Analysis

### Backend (node_helper.js)

**Data Flow:**
```
REST API Response
  ↓
_getTimetableViaRest, _getExamsViaRest, etc.
  ↓
Raw data: dates as numeric YYYYMMDD (e.g., 20251217)
         times as numeric HHMM (e.g., 800 for 08:00)
  ↓
_normalizeDateToInteger(), _normalizeTimeToMinutes()
  ↓
Send to Frontend: { date: 20251217, startTime: 800, ... }
```

**Key normalization functions:**
- `_normalizeDateToInteger(date)` - Converts ISO "YYYY-MM-DD" → YYYYMMDD integer (1330-1450 lines)
- `_normalizeTimeToMinutes(time)` - Converts "HH:MM" → HHMM integer (1455-1475 lines)

**Examples from REST API responses:**
- Timetable: `date: "2025-12-17"` → `20251217`
- Exams: `examDate: 20251217`, `startTime: 800`
- Absences: `date: 20251217`, `startTime: 800`
- Homework: `dueDate: 20251217`

### Frontend (widgets)


## DATE FORMATS: `dateFormats.absences`

A new configuration key `dateFormats` was introduced to allow per-widget date format configuration in one place. The Absences widget now prefers the following lookup order for its displayed date format:

1. `studentConfig.dateFormats.absences` (per-student override)
2. `config.dateFormats.absences` (module-level per-widget format)
3. `config.dateFormats.default` (module-level default)
4. Legacy `config.dateFormat` (backwards compatibility)
5. Fallback `'dd.MM.'`

Example:

 - Per-student override:

 ```js
 // inside a student entry
 student: {
   title: 'Alice',
   dateFormats: { absences: 'd.M.yyyy' }
 }
 ```

 - Module-level minimal example (only absences overridden):

 ```js
 // in module config
 dateFormats: {
   absences: 'd.M.yyyy'
 }
 ```

This keeps backwards compatibility with existing single-value options such as `dateFormat`, while providing a clear and centralized way to control formats per widget.


**Data Flow:**
```
Backend sends: { date: 20251217, startTime: 800, ... }
  ↓
Widget receives via socketNotificationReceived
  ↓
Render row: util.formatDate(20251217) → "Do, 17.12."
           util.formatTime(800) → "08:00"
  ↓
Display in browser with Intl.DateTimeFormat
```

**Current `formatDate` implementation** (widgets/util.js):
```javascript
function formatDate(yyyymmdd, format = 'd.m.y') {
  const year = Math.floor(yyyymmdd / 10000);
  const month = Math.floor((yyyymmdd % 10000) / 100);
  const day = yyyymmdd % 100;

  const dt = new Date(year, month - 1, day); // Local timezone
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = formatter.formatToParts(dt);
  // ... token replacement
}
```

**This approach:**
- ✅ Accepts numeric YYYYMMDD (no string parsing needed)
- ✅ Creates Date object **only at display time** (lazy evaluation)
- ✅ Uses browser's locale for formatting
- ✅ No timezone issues (always uses local browser timezone)

---

## Option 1: Current String-Based Approach (RECOMMENDED)

### How It Works

1. **Backend:** API returns dates as numeric YYYYMMDD or ISO strings
2. **Normalization:** Convert to integers (`20251217`) / `HHMM` (`800`)
3. **Transport:** Send to frontend as plain integers
4. **Frontend:** Store in widgets as integers, format **only when displaying** via `Intl.DateTimeFormat`

### Pros

| Advantage | Impact |
|-----------|--------|
| **No parsing overhead** | Integers are faster to work with than Date objects; no ISO string → Date conversion needed |
| **Direct API compatibility** | REST endpoints expect YYYYMMDD (e.g., `/api/exams?startDate=20251217`); no re-encoding needed |
| **Single timezone** | MagicMirror module runs on one device in one school's timezone; no need to handle timezones |
| **Memory efficient** | Integer (8 bytes) + integer (2 bytes) vs. Date object (internal representation) |
| **Locale-agnostic storage** | Data is stored as numbers; formatting happens at display time using `Intl` |
| **Lazy formatting** | `formatDate()` only called when rendering to DOM; unused data never formatted |
| **Simple logic** | Direct number comparisons: `if (dateNum >= start && dateNum <= end)` (see lessons.js:17) |
| **Browser-native locale** | `Intl.DateTimeFormat` automatically respects user's system locale and language |
| **No DST edge cases** | No need to handle daylight saving time transitions; just display local time |
| **Backward compatible** | Existing widgets and config already use this format |

### Cons

| Drawback | Mitigation |
|----------|-----------|
| **Not a true Date object** | Not needed—MagicMirror doesn't do complex date math, just filtering and display |
| **Arithmetic is awkward** | Rare: `date + 1` would fail; use `addDays(date, 1)` helper instead |
| **No timezone support** | Feature: module assumes single-timezone environment (intentional) |
| **String-based in API calls** | Already handled: `_getTimetableViaRest` and friends format to YYYYMMDD string when calling REST API |

### Current Usage in Codebase

**String-based date comparisons (lessons.js:11-17):**
```javascript
function isDateInHoliday(dateYmd, holidays) {
  const dateNum = Number(dateYmd);
  if (holidays) {
    const start = Number(holiday.startDate);  // e.g., 20251220
    const end = Number(holiday.endDate);      // e.g., 20260101
    if (dateNum >= start && dateNum <= end) return true;
  }
}
```

**Grouping by date (lessons.js:50-52):**
```javascript
const lessonsByDate = {};
timetable.forEach((entry) => {
  const dateYmd = Number(entry.date);  // Convert string to number
  if (!lessonsByDate[dateYmd]) lessonsByDate[dateYmd] = [];
  lessonsByDate[dateYmd].push(entry);
});
```

**Display formatting (all widgets):**
```javascript
const dateStr = util.formatDate(entry.date, 'd.m.y');  // 20251217 → "17.12.25"
```

---

## Option 2: Early Date Object Parsing (NOT RECOMMENDED)

### How It Works

1. **Backend:** API returns dates as ISO strings or numeric YYYYMMDD
2. **Parsing:** Convert to `new Date(year, month-1, day)` in node_helper
3. **Transport:** Send to frontend as ISO strings: `"2025-12-17T00:00:00"`
4. **Frontend:** Store as ISO strings, parse to Date objects in widgets when needed

### Pros

| Advantage | Reality |
|-----------|---------|
| **Familiar API** | Date methods like `getFullYear()` are standard; but not needed here |
| **Potential for complex date math** | E.g., `date.getTime() + 86400000` for +1 day; overkill for this module |
| **Time-of-day support** | Not needed: times are separate (`startTime: 800`) and handled independently |

### Cons

| Drawback | Severity |
|----------|----------|
| **Extra parsing step** | Every date from API needs conversion; doubles work at backend → frontend boundary |
| **Serialization complexity** | `JSON.stringify(new Date())` → ISO string automatically; `JSON.parse()` doesn't reverse it |
| **Timezone ambiguity** | `new Date("2025-12-17")` is interpreted in UTC, not local timezone; frontend must re-parse |
| **Larger payload** | ISO strings (`"2025-12-17T00:00:00"`) are longer than integers (`20251217`) |
| **Frontend re-parsing** | Widgets must convert ISO → Date again for display or arithmetic |
| **Fragile round-trips** | ISO string → Date → Intl formatting can introduce subtle bugs with timezones |
| **REST API re-encoding** | When sending date ranges to REST endpoints, must convert Date → ISO/YYYYMMDD string again |
| **DST issues** | If timezone awareness is added later, DST transitions become complex |
| **Slower comparisons** | `date1.getTime() > date2.getTime()` vs. `20251217 > 20251216` |

### Example Implementation (NOT DONE)

```javascript
// Backend: node_helper.js
async _getTimetableViaRest(...) {
  // ...
  lessons.forEach((lesson) => {
    // Current: date is "2025-12-17" string
    // Proposed: convert to Date
    const dateStr = lesson.date; // "2025-12-17"
    const [y, m, d] = dateStr.split('-');
    const dt = new Date(y, m - 1, d); // ❌ Assumes local timezone
    // ...
    return { date: dt.toISOString(), ... }; // ❌ Sends ISO string
  });
}

// Frontend: widgets/lessons.js
function renderLessonsForStudent(...) {
  timetable.forEach((lesson) => {
    const date = new Date(lesson.date); // ❌ Re-parses ISO string
    const dateStr = util.formatDate(date, 'd.m.y'); // ❌ Extra conversion
  });
}
```

**Problems:**
1. **Redundant conversions:** String → Date (backend) → JSON → String (transport) → Date (frontend) → Intl
2. **Timezone confusion:** Backend `new Date("2025-12-17")` uses UTC; frontend may expect local time
3. **API boundary breakage:** REST endpoints expect YYYYMMDD or ISO; must convert Date back to string
4. **No performance gain:** More object creation, more GC pressure, slower comparisons

---

## API Data Formats (Reference)

### REST API Response Examples

**Timetable (days.date):**
```javascript
{
  date: "2025-12-17T00:00:00",  // ISO string in API
  gridEntries: [
    {
      duration: {
        start: "2025-12-17T08:00:00",  // ISO string
        end: "2025-12-17T08:45:00"     // ISO string
      }
    }
  ]
}
```

**Exams (examDate, startTime):**
```javascript
{
  examDate: "2025-12-17",  // ISO date string
  startTime: "08:00",      // Time string (HH:MM)
  endTime: "09:30"         // Time string (HH:MM)
}
```

**Homework (dueDate):**
```javascript
{
  dueDate: "2025-12-17",   // ISO date string
  completed: false
}
```

**Holidays (start/end):**
```javascript
{
  start: "2024-05-01T00:00:00",  // ISO string with time
  end: "2024-05-01T23:59:59"     // ISO string with time
}
```

**Current transformation (node_helper.js):**
```
"2025-12-17" → 20251217
"2025-12-17T08:00:00" → date: 20251217, startTime: 800
```

### Frontend Receives

```javascript
{
  date: 20251217,      // Numeric YYYYMMDD
  startTime: 800,      // Numeric HHMM (8:00 AM)
  endTime: 845,        // Numeric HHMM
  // ... other fields
}
```

### Formatted for Display

```javascript
util.formatDate(20251217, 'd.m.y')
→ new Date(2025, 11, 17)
→ Intl.DateTimeFormat(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
→ "17.12.25" (German) or "12/17/25" (English, depending on browser locale)
```

---

## Comparison Table

| Aspect | Strings (YYYYMMDD + HHMM) | Date Objects (ISO + Date) |
|--------|---------------------------|---------------------------|
| **Storage size** | Integers: 20251217 (8 bytes) | ISO string or Date object (~24+ bytes) |
| **Parsing needed** | Simple number extraction: `Math.floor(d / 10000)` | Complex: `new Date(iso)` or `ISO → split → Date` |
| **API compatibility** | ✅ Direct: `?startDate=20251217` | ❌ Indirect: must convert Date → YYYYMMDD |
| **Comparison speed** | ✅ Fast: `20251217 >= 20251214` | ❌ Slower: `date1.getTime() >= date2.getTime()` |
| **Timezone handling** | ✅ None needed (local timezone assumed) | ❌ Complex: UTC vs. local interpretation |
| **Display formatting** | ✅ Lazy: format only when rendering | ⚠️ Must parse ISO, then format |
| **Browser locale support** | ✅ Full via Intl.DateTimeFormat | ✅ Full via Intl.DateTimeFormat |
| **Memory per entry** | ~16 bytes (date + time integers) | ~50+ bytes (Date object overhead) |
| **Error risk** | Low (simple math) | Medium (timezone + parsing) |
| **Learning curve** | Trivial for this module | Unnecessary complexity |

---

## When to Switch to Date Objects

**Only if the module needs one or more of:**

1. ✅ **Timezone conversion** - Display student timetables in different timezones
2. ✅ **Complex date arithmetic** - Calculate school weeks, semesters, age at graduation
3. ✅ **Recurring events** - Handle icalendar or RRULE patterns
4. ✅ **Cross-timezone comparison** - Compare exams across schools in different timezones
5. ✅ **Client-side date filtering** - Dynamic ranges with validation

**Currently implemented:** None of the above. Module assumes:
- Single school (single timezone)
- Date display only (no arithmetic)
- No recurring events
- No timezone conversion

---

## Recommendations by Component

### 1. Backend (node_helper.js)

**Status:** ✅ **Keep as-is**

- Continue using `_normalizeDateToInteger()` and `_normalizeTimeToMinutes()`
- Rationale: Simplest form to work with in backend; directly compatible with REST API calls
- Action: None needed

### 2. Frontend Transport (WebSocket payload)

**Status:** ✅ **Keep integers**

- Continue sending `{ date: 20251217, startTime: 800, ... }`
- Rationale: Minimal payload size; no parsing needed on frontend
- Action: None needed

### 3. Widget Display (util.formatDate)

**Status:** ✅ **Keep Intl-based approach** (recently implemented)

Current implementation:
```javascript
function formatDate(yyyymmdd, format = 'd.m.y') {
  // Convert integer to Date
  const year = Math.floor(yyyymmdd / 10000);
  const month = Math.floor((yyyymmdd % 10000) / 100);
  const day = yyyymmdd % 100;

  const dt = new Date(year, month - 1, day);

  // Format using browser's locale
  const formatter = new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  return formatter.formatToParts(dt)
    .reduce((acc, part) => {
      if (part.type === 'year') return acc.replace('y', part.value);
      if (part.type === 'month') return acc.replace('m', part.value);
      if (part.type === 'day') return acc.replace('d', part.value);
      return acc;
    }, format);
}
```

**Why this is optimal:**
- ✅ Parses integer YYYYMMDD to Date (lightweight, local timezone)
- ✅ Uses `Intl.DateTimeFormat` (browser's native locale support)
- ✅ Supports custom format tokens (`d.m.y`, `m/d/y`, etc.)
- ✅ Zero dependencies (pure JavaScript)

- Action: Keep as-is; this is already implemented and working

### 4. Date Arithmetic in Widgets

**Current pattern (lessons.js):**
```javascript
// Don't need: date + 1
// Instead: numeric comparison
if (dateNum >= start && dateNum <= end) { /* in holiday */ }
```

**Status:** ✅ **Keep numeric comparisons**

- Rationale: Simpler, faster, no need for Date arithmetic
- Action: None needed; current code already does this correctly

---

## Migration Path (If Needed in Future)

**Only if requirements change to include timezone support:**

1. **Phase 1:** Add timezone field to config
   ```javascript
   config.timezone = 'Europe/Berlin';  // TZ identifier
   ```

2. **Phase 2:** Update backend to parse dates with timezone
   ```javascript
   const dt = new Date(year, month - 1, day);
   const formatter = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin' });
   ```

3. **Phase 3:** Update frontend to respect timezone
   ```javascript
   // Send timezone in WebSocket, use in formatDate
   ```

4. **Phase 4:** Update REST API calls to handle school calendar (which may span timezones)

**Current status:** Not needed; all MagicMirror modules run in a single timezone

---

## Conclusion

**Recommendation: CONTINUE CURRENT APPROACH**

The string-based (numeric YYYYMMDD + HHMM) strategy is **optimal** for MMM-Webuntis because:

1. ✅ **Matches API exactly** - No re-encoding when calling REST endpoints
2. ✅ **Memory efficient** - Integers are small; Date objects are not needed
3. ✅ **Simple logic** - Direct number comparisons work perfectly
4. ✅ **Zero timezone complexity** - Module assumes single timezone (MagicMirror's reality)
5. ✅ **Locale support** - Intl.DateTimeFormat handles all languages/regions
6. ✅ **Fast comparisons** - Integer math is faster than Date.getTime()
7. ✅ **No round-trip overhead** - No need to convert Date back to strings for API calls

**Do not** switch to Date objects unless:
- Requirements change to include timezone conversion, or
- Complex date arithmetic becomes needed, or
- Recurring events (icalendar) are implemented

**Current action items:** None—the architecture is already optimal for the module's use case.

---

## References

- [REST_ENDPOINTS_OVERVIEW.md](./REST_ENDPOINTS_OVERVIEW.md) - API endpoint details and date formats
- [APP_DATA_ANALYSIS.md](./APP_DATA_ANALYSIS.md) - App data structures including timeGrid units
- [node_helper.js:1330-1475](../../node_helper.js#L1330-L1475) - Normalization functions
- [widgets/util.js](../../widgets/util.js) - formatDate implementation with Intl.DateTimeFormat
- [widgets/lessons.js:11-17](../../widgets/lessons.js#L11-L17) - Date comparison examples


