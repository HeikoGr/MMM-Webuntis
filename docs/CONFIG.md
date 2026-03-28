# Configuration Guide

This file is the canonical reference for MMM-Webuntis configuration.

Use it for:
- supported configuration keys
- valid authentication patterns
- student object shape
- widget-specific namespaces
- debug and demo options

The root [../README.md](../README.md) only shows shortened examples on purpose.

## Authentication Patterns

MMM-Webuntis supports these canonical config shapes:

### Per-student QR code

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    students: [
      {
        title: 'Alice',
        qrcode: 'untis://setschool?url=example.webuntis.com&school=example&user=alice&key=ABC123',
      },
    ],
  },
}
```

### Per-student direct credentials

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    students: [
      {
        title: 'Alice',
        username: 'alice.smith',
        password: 'secret',
        school: 'example',
        server: 'example.webuntis.com',
      },
    ],
  },
}
```

### Parent account with auto-discovery

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    username: 'parent@example.com',
    password: 'secret',
    school: 'example',
    server: 'example.webuntis.com',
    students: [],
  },
}
```

Notes:
- QR code is the preferred option for SSO-backed accounts.
- `students: []` is the switch that enables parent-account auto-discovery.
- Mixed credentials are supported across `students[]`.

## Global Options

The canonical defaults live in the `defaults` object in `MMM-Webuntis.js`. Global options are declared at the top level of `config` and can be overridden per student where supported.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `header` | string | `'MMM-Webuntis'` | Title displayed by MagicMirror for this module. |
| `updateInterval` | int | `5 * 60 * 1000` | Fetch interval in milliseconds. |
| `logLevel` | string | `'none'` | Log verbosity: `debug`, `info`, `warn`, `error`, or `none`. |
| `timezone` | string | `'Europe/Berlin'` | Timezone used for date calculations and debug-date handling. |
| `debugDate` | string\|null | `null` | Freeze "today" for testing (`YYYY-MM-DD`). |
| `demoDataFile` | string\|null | `null` | Relative path to a local fixture JSON for frontend-only demo mode. |
| `dumpBackendPayloads` | bool | `false` | Write backend payload snapshots to `debug_dumps/`. |
| `dumpRawApiResponses` | bool | `false` | Write raw REST responses to `debug_dumps/raw_api_*.json`. |
| `useClassTimetable` | bool | `false` | Use class timetable instead of personal timetable where required. |

## Display Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `displayMode` | string | `'lessons, exams'` | Comma-separated list of widgets to render. Supported: `grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`. |
| `mode` | string | `'verbose'` | Display mode for lists: `verbose` or `compact`. |

`list` remains a supported alias for `lessons, exams`.

## Timetable Fetch Range

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `nextDays` | int | `0` | Global fallback for days ahead. Widget-specific values have priority. |
| `pastDays` | int | `0` | Global fallback for past days. Widget-specific values have priority. |

Range calculation is today-inclusive.

Examples:
- `pastDays: 1, nextDays: 3` means yesterday, today, and three future days
- `pastDays: 0, nextDays: 7` means today and seven future days

## Student Credential Object

Each entry in `students[]` must contain:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `title` | string | yes | Display name for the student. |
| `qrcode` | string | auth-dependent | WebUntis QR code. |
| `username` | string | auth-dependent | Direct-login username. |
| `password` | string | auth-dependent | Direct-login password. |
| `school` | string | auth-dependent | School name for direct login. |
| `server` | string | no | WebUntis server hostname. Top-level value may be reused. |
| `studentId` | number | no | Used for parent-account mode and child-specific overrides. |
| `useClassTimetable` | bool | no | Override the timetable source for this student. |

Practical notes:
- Use `studentId` when you want to customize a single child discovered through a parent account.
- `server` is optional on student objects when a top-level value already exists.
- Per-student widget namespaces can override top-level widget namespaces.

## Parent Account Support

Use top-level parent credentials to access multiple children's data.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `username` | string | - | Parent account email or username. |
| `password` | string | - | Parent account password. |
| `school` | string | - | School name. |
| `server` | string | `'webuntis.com'` | WebUntis server hostname. |

## Auto-Discovery Feature

When using parent account credentials, the module can automatically discover all children.

How it works:
1. Provide parent credentials at module level.
2. Leave `students: []` empty.
3. The module reads `app/data` and populates the available children.

If you want to customize only one discovered child, add a `students[]` entry with the matching `studentId`.

## Widget-Specific Options

Widget options must be configured as nested objects, not with dot notation.

Correct:

```javascript
lessons: { dateFormat: 'EEEE' }
grid: { maxLessons: 8 }
```

Incorrect:

```javascript
// Invalid JavaScript syntax
lessons.dateFormat: 'EEEE'
```

### Lessons Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `lessons.dateFormat` | string | `'EEE'` | Date format. |
| `lessons.showStartTime` | bool | `false` | Show start time instead of lesson number. |
| `lessons.showRegular` | bool | `false` | Show regular lessons, not only changes. |
| `lessons.useShortSubject` | bool | `false` | Use short subject names when available. |
| `lessons.showTeacherMode` | string | `'full'` | Teacher display: `full`, `initial`, or falsy. |
| `lessons.showRoom` | bool | `false` | Show room in lessons rows. |
| `lessons.showSubstitution` | bool | `false` | Show substitution text and notes. |
| `lessons.naText` | string | `'N/A'` | Placeholder for removed values without a replacement. |

### Grid Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `grid.dateFormat` | string | `'EEE dd.MM.'` | Date format for grid header. |
| `grid.mergeGap` | int | `15` | Maximum gap in minutes between lessons to merge them. |
| `grid.maxLessons` | int | `0` | Limit lessons per day. `0` shows all. |
| `grid.pxPerMinute` | number | `0.8` | Vertical scaling factor. |
| `grid.showNowLine` | bool | `true` | Show current time line in the grid. |
| `grid.weekView` | bool | `false` | Show the current school week instead of `pastDays`/`nextDays`. |
| `grid.nextDays` | int | `4` | Days ahead to display when `weekView` is off. |
| `grid.pastDays` | int | `0` | Days past to display when `weekView` is off. |
| `grid.naText` | string | `'N/A'` | Placeholder for removed values without a replacement. |

### Grid Field Display Options

Use `grid.fields` to control which lesson properties are rendered in each grid cell.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `grid.fields.primary` | string | `'subject'` | Primary line in the lesson cell. |
| `grid.fields.secondary` | string | `'teacher'` | Secondary line in the lesson cell. |
| `grid.fields.additional` | string[] | `['room']` | Additional fields shown as badges or extra text. |
| `grid.fields.format.subject` | string | `'long'` | Subject display format: `short` or `long`. |
| `grid.fields.format.teacher` | string | `'long'` | Teacher display format: `short` or `long`. |
| `grid.fields.format.class` | string | `'short'` | Class display format: `short` or `long`. |
| `grid.fields.format.room` | string | `'short'` | Room display format: `short` or `long`. |
| `grid.fields.format.studentGroup` | string | `'short'` | Student group display format: `short` or `long`. |

Valid field names:
- `subject`
- `teacher`
- `room`
- `class`
- `studentGroup`

### Exams Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `exams.dateFormat` | string | `'EEE dd.MM.'` | Date format for exam dates. |
| `exams.nextDays` | int | `21` | Days ahead to fetch exams. |
| `exams.showSubject` | bool | `true` | Show subject for exams. |
| `exams.showTeacher` | bool | `true` | Show teacher for exams. |

### Homework Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `homework.dateFormat` | string | `'EEE dd.MM.'` | Date format for homework due dates. |
| `homework.showSubject` | bool | `true` | Show subject name with homework. |
| `homework.showText` | bool | `true` | Show homework text. |
| `homework.nextDays` | int | `28` | Days ahead override. |
| `homework.pastDays` | int | `0` | Days past override. |

### Absences Widget Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `absences.dateFormat` | string | `'EEE dd.MM.'` | Date format for absences. |
| `absences.pastDays` | int | `21` | Past days to fetch absences. |
| `absences.nextDays` | int | `7` | Future days to fetch absences. |
| `absences.showDate` | bool | `true` | Show absence date. |
| `absences.showExcused` | bool | `true` | Show excused or unexcused status. |
| `absences.showReason` | bool | `true` | Show reason or note. |
| `absences.maxItems` | int | `null` | Maximum displayed absences. |

### Messages Of Day Widget Options

There are currently no widget-specific config keys for `messagesofday`.

## Multiple Instances

You can run multiple independent MMM-Webuntis instances on the same MagicMirror.

Recommended approach:
- use separate module entries
- let identifiers auto-generate unless you need stable explicit names

Optional explicit instance id:

```javascript
{
  module: 'MMM-Webuntis',
  identifier: 'student_alice',
  config: {
    students: [{ title: 'Alice', qrcode: 'untis://...' }],
  },
}
```

## Debug / Development Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dumpBackendPayloads` | bool | `false` | Dump backend responses to `debug_dumps/`. |
| `dumpRawApiResponses` | bool | `false` | Dump raw REST responses to `debug_dumps/raw_api_*.json`. |
| `debugDate` | string | `null` | Override "today" for testing. |
| `timezone` | string | `'Europe/Berlin'` | Timezone for date calculations. |
| `demoDataFile` | string | `null` | Render fixture data in the frontend without backend/API calls. |

### Frontend Demo Fixtures

Use `demoDataFile` for screenshot and UI testing with fixture data:

```javascript
config: {
  demoDataFile: 'demo/fixtures/single-student-week.json',
  debugDate: '2026-03-02',
  displayMode: 'messagesofday, grid, lessons, exams, homework, absences',
}
```

Notes:
- the path is relative to the module root
- a single payload, an array of payloads, or `{ payloads: [...] }` is supported
- demo mode renders fixture data in the frontend and skips backend/API calls

## Additional Options

### Timetable Source

`useClassTimetable` is a top-level option with default `false`. It can also be overridden per student when only some students need class timetable mode.

## Related Docs

- [../README.md](../README.md) - quick start and installation
- [API_REFERENCE.md](API_REFERENCE.md) - external API behavior
- [SERVER_REQUEST_FLOW.md](SERVER_REQUEST_FLOW.md) - runtime fetch and retry behavior
- [CSS_CUSTOMIZATION.md](CSS_CUSTOMIZATION.md) - styling options