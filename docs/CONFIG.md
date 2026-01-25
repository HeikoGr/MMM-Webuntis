# Configuration Guide

Comprehensive documentation of all configuration options for MMM-Webuntis.

## Table of Contents

- [Global Options](#global-options)
- [Display Options](#display-options)
- [Timetable Fetch Range](#timetable-fetch-range)
- [Widget-Specific Options](#widget-specific-options)
  - [Lessons Widget](#lessons-widget-options)
  - [Grid Widget](#grid-widget-options)
  - [Exams Widget](#exams-widget-options)
  - [Homework Widget](#homework-widget-options)
  - [Absences Widget](#absences-widget-options)
  - [Messages of Day Widget](#messages-of-day-widget-options)
- [Multiple Instances](#multiple-instances-multi-student--multi-family-setups)
- [Parent Account Support](#parent-account-support)
- [Student Credential Object](#student-credential-object)
- [Auto-Discovery Feature](#auto-discovery-feature)
- [Debug / Development Options](#debug--development-options)

---

## Global Options

All configuration options are documented in [MMM-Webuntis.js](MMM-Webuntis.js#L1-L48) in the `defaults` object. Global options can be declared at the top level of `config` and can be overridden per-student.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `header` | string | `'MMM-Webuntis'` | Title displayed by MagicMirror for this module. |
| `updateInterval` | int | `5 * 60 * 1000` | Fetch interval in milliseconds (default 5 minutes). |
| `logLevel` | string | `'none'` | Log verbosity: `'debug'`, `'info'`, `'warn'`, `'error'`, or `'none'`. |

---

## Display Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `displayMode` | string | `'lessons,exams'` | Comma-separated list of widgets to render (top-to-bottom). Supported: `grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`. |
| `mode` | string | `'verbose'` | Display mode for lists: `'verbose'` (per-student sections) or `'compact'` (combined). |

---

## Timetable Fetch Range

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `nextDays` | int | `7` | Number of upcoming days to display **starting from tomorrow**. |
| `pastDays` | int | `0` | Number of past days to display **before today**. |

**Range Calculation:** `totalDays = pastDays + 1 (today) + nextDays`

Examples:
- `pastDays: 1, nextDays: 3` = Yesterday + Today + 3 future days = **5 days total**
- `pastDays: 0, nextDays: 7` (default) = Today + 7 future days = **8 days total**

---

## Widget-Specific Options

> **Important:** Widget options **must be configured as nested objects**, not with dot notation.
>
> ✅ Correct: `lessons: { dateFormat: 'EEEE' }`, `grid: { maxLessons: 8 }`
>
> ❌ Wrong: `lessons.dateFormat: 'EEEE'` (invalid JavaScript syntax)

---

### Lessons Widget Options

Configure lessons widget behavior using the `lessons` namespace:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `lessons.dateFormat` | string | `'EEE'` | Date format. Supports tokens: `EEE` (short weekday), `EEEE` (long weekday), `dd`, `mm`, `yyyy`. |
| `lessons.showStartTime` | bool | `false` | Show start time instead of lesson number. |
| `lessons.showRegular` | bool | `false` | Show regular lessons (not only substitutions/cancellations). |
| `lessons.useShortSubject` | bool | `false` | Use short subject names where available. |
| `lessons.showTeacherMode` | string | `'full'` | Teacher display: `'full'` (full name), `'initial'` (initials), or null/falsy. |
| `lessons.showSubstitution` | bool | `false` | Show substitution text/notes for changed lessons. |

**Example:**
```javascript
lessons: {
  dateFormat: 'EEEE',
  showStartTime: false,
  showTeacherMode: 'full',
}
```

---

### Grid Widget Options

Configure grid widget behavior using the `grid` namespace:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `grid.dateFormat` | string | `'EEE dd.MM.'` | Date format for grid header. |
| `grid.mergeGap` | int | `15` | Maximum gap (minutes) between lessons to merge them. |
| `grid.maxLessons` | int | `0` | Limit lessons per day. `0` = show all; `>=1` limits to first N timeUnits. |
| `grid.showNowLine` | bool | `true` | Show current time line in grid. |
| `grid.weekView` | bool | `false` | **Calendar week view (Mon-Fri only)**. Overrides `nextDays`/`pastDays`. Auto-switches to next week on Friday after 16:00, Saturday, and Sunday. |
| `grid.nextDays` | int | - | Days ahead to display. Ignored when `weekView: true`. |
| `grid.pastDays` | int | - | Days past to display. Ignored when `weekView: true`. |

**Example (5-day view):**
```javascript
grid: {
  dateFormat: 'EEE dd.MM.',
  mergeGap: 15,
  maxLessons: 8,
  showNowLine: true,
  nextDays: 3,
  pastDays: 1,
}
```

**Example (calendar week view):**
```javascript
grid: {
  weekView: true,  // Mon-Fri of current/next week
  dateFormat: 'EEE dd.MM.',
  mergeGap: 15,
  maxLessons: 8,
  showNowLine: true,
}
```

---

### Exams Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `exams.dateFormat` | string | `'dd.MM.'` | Date format for exam dates. |
| `exams.nextDays` | int | `21` | Days ahead to fetch exams (0 = off). |
| `exams.showSubject` | bool | `true` | Show subject for exams. |
| `exams.showTeacher` | bool | `true` | Show teacher for exams. |

---

### Homework Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `homework.dateFormat` | string | `'dd.MM.'` | Date format for homework due dates. |
| `homework.showSubject` | bool | `true` | Show subject name with homework. |
| `homework.showText` | bool | `true` | Show homework description/text. |
| `homework.nextDays` | int | `28` | Widget-specific days ahead override. |
| `homework.pastDays` | int | `0` | Widget-specific days past override. |

---

### Absences Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `absences.dateFormat` | string | `'dd.MM.'` | Date format for absence dates. |
| `absences.pastDays` | int | `21` | Past days to fetch absences. |
| `absences.nextDays` | int | `7` | Future days to fetch absences. |
| `absences.showDate` | bool | `true` | Show absence date. |
| `absences.showExcused` | bool | `true` | Show excused/unexcused status. |
| `absences.showReason` | bool | `true` | Show reason/note for absence. |
| `absences.maxItems` | int | `null` | Max absences to display (null = unlimited). |

---

### Messages of Day Widget Options

Currently no specific configuration options. The widget displays all messages for the configured date range.

---

## Multiple Instances (Multi-Student / Multi-Family Setups)

You can run **multiple independent instances** of MMM-Webuntis on the same MagicMirror screen.

### Auto-Generated Instance IDs (Recommended)

By default, each instance automatically generates a unique identifier based on:
- Module position (e.g., `top_left`, `bottom_right`)
- Configuration content (hashed for uniqueness)

**Multiple instances work out-of-the-box:**

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_left',
  config: {
    header: 'Alice',
    students: [{ title: 'Alice', qrcode: 'untis://...' }],
  },
},
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    header: 'Bob',
    students: [{ title: 'Bob', qrcode: 'untis://...' }],
  },
},
```

### Explicit Instance IDs (Optional)

For more control, add an `identifier` field:

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_left',
  identifier: 'student_alice',
  config: { /* ... */ },
},
```

**Why use explicit identifiers?**
- Scripting/remote control
- Stable, human-readable instance names
- Easier debugging

---

## Parent Account Support

Use parent account credentials to access multiple children's data.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `username` | string | - | Parent account email/username. |
| `password` | string | - | Parent account password. |
| `school` | string | - | School name (can be overridden per student). |
| `server` | string | `'webuntis.com'` | WebUntis server hostname. |

---

## Student Credential Object

Each entry in the `students` array:

### Required

- `title` (string) — Display name for the student.

### Credentials (choose one)

**Option A: QR Code (Recommended)**
- `qrcode` (string) — WebUntis QR code (`untis://setschool?url=...&school=...&user=...&key=...`).

**Option B: Direct Credentials**
- `username` (string)
- `password` (string)
- `school` (string)
- `server` (string, optional)

### Optional

- `studentId` (number) — For parent account mode.
- Per-student option overrides — any global option can be overridden per student.

**Example:**
```javascript
{
  title: "Alice",
  qrcode: "untis://setschool?url=example.webuntis.com&school=example&user=alice&key=ABC123",
  homework: {
    nextDays: 45, // Override for this student
  }
}
```

---

## Auto-Discovery Feature

When using **parent account credentials**, the module can automatically discover all children.

### How it works

1. Provide parent credentials (`username`, `password`, `school`, `server`)
2. Leave `students: []` empty
3. Module fetches and displays all children automatically

**Example:**
```javascript
{
  module: "MMM-Webuntis",
  config: {
    username: "parent@example.com",
    password: "password123",
    school: "myschool",
    server: "myschool.webuntis.com",
    students: [],  // Empty = auto-discovery
  }
}
```

**Output:**
```
✓ Auto-discovered 2 student(s):
  • Emma Schmidt (ID: 12345)
  • Jonas Schmidt (ID: 12346)
```

### Customizing Discovered Students

Configure specific students using their `studentId`:

```javascript
students: [
  {
    studentId: 12345,  // Must match auto-discovered ID
    // title omitted = uses auto-discovered name
    homework: { nextDays: 45 },
  },
  {
    studentId: 12346,
    title: "Jonas (custom)",  // Override name
  },
]
```

### Getting studentId from Logs

1. Enable auto-discovery temporarily (empty `students: []`)
2. Check MagicMirror logs for discovered IDs
3. Copy IDs to your config

**Troubleshooting:**
- Set `logLevel: 'debug'` to see more details
- Verify parent credentials are correct
- Check terminal logs (not just browser console)

---

## Debug / Development Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dumpBackendPayloads` | bool | `false` | Dump backend responses to `debug_dumps/` folder. |
| `dumpRawApiResponses` | bool | `false` | Dump raw REST API responses to `debug_dumps/raw_api_*.json`. |
| `debugDate` | string | `null` | Override "today" for testing (format: `YYYY-MM-DD`). |
| `timezone` | string | `'Europe/Berlin'` | Timezone for date calculations. |

---

## Additional Options

### Timetable Source

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `useClassTimetable` | bool | `false` | Use class timetable instead of student timetable (some schools only provide class data). |

---

For troubleshooting and advanced configuration, see:
- [README.md](README.md) - Quick start and installation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture
- [docs/CSS_CUSTOMIZATION.md](docs/CSS_CUSTOMIZATION.md) - Styling options
