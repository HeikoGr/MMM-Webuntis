# MMM-Webuntis

A MagicMirror² module that shows cancelled, irregular or substituted lessons from WebUntis for configured students. It fetches timetable, exams and homework data from WebUntis and presents them in a compact list or a multi-day grid.

## Installation

1. Go to your MagicMirror² `modules` folder and run:

```bash
git clone https://github.com/HeikoGr/MMM-Webuntis
cd MMM-Webuntis
npm install
```

2. Add the module to your MagicMirror `config/config.js` (see example below).

## Update

To update to the latest version:

```bash
cd ~/MagicMirror/modules/MMM-Webuntis
git pull
npm install
```

Restart MagicMirror after updating.

## Quick start

Add `MMM-Webuntis` to your `config/config.js` inside the `modules` array. The example below shows the most common global options and a minimal per-student credential configuration.

```javascript
{
    module: "MMM-Webuntis",
    position: "top_right",
    header: "Untis",
    config: {
        // global options
        logLevel: "trace",
        fetchIntervalMs: 15 * 60 * 1000, // 15 minutes
        daysToShow: 7,
        pastDaysToShow: 0,
        mergeGapMinutes: 15,

        // per-student credentials
        students: [
            { title: "Alice", qrcode: "untis://setschool?..." },
            { title: "Bob", qrcode: "untis://setschool?..." }
        ]
    }
}
```

Legacy keys: the module accepts several legacy key names and will map them to the canonical names automatically. Examples: `debug` → `enableDebug`, `fetchInterval` → `fetchIntervalMs`, `mergeGapMin` → `mergeGapMinutes`, `days` → `daysToShow`. Prefer the canonical names in new configs.

## Configuration options

The following configuration options are supported. Global options can be declared at the top level of `config` and can be overridden per-student by adding the same property in a student object.

| Option | Type | Default | Description |
|---|---:|---:|---|
| `students` | array | required | Array of student credential objects (see below). |
| `header` | string | none | Optional title printed by MagicMirror for this module instance. |
| `daysToShow` | int | `7` | Number of upcoming days to fetch/display (0..10). Set to `0` to disable. Can be overridden in a student object. |
| `pastDaysToShow` | int | `0` | How many past days to include in the grid (useful for debugging). |
| `fetchIntervalMs` | int | `15 * 60 * 1000` | Fetch interval in milliseconds (default 15 minutes). |
| `mergeGapMinutes` | int | `15` | Allowed gap in minutes between consecutive lessons to consider them mergeable. Lower = stricter merging. |
| `showStartTime` | bool | `false` | When `true` show the lesson start time; when `false` show the lesson number (if available). |
| `useClassTimetable` | bool | `false` | Some schools only provide a class timetable; set `true` to request class timetable instead of the student timetable. |
| `showRegularLessons` | bool | `false` | Show regular lessons (not only substitutions/cancellations). |
| `showTeacherMode` | string | `'full'` | How to show teacher: `'initial'` | `'full'` | `'none'`. |
| `useShortSubject` | bool | `false` | Use short subject names where available. |
| `showSubstitutionText` | bool | `false` | Show substitution text from WebUntis (if present). |
| `examsDaysAhead` | int | `0` | How many days ahead to fetch exams. `0` disables exams. |
| `showExamSubject` | bool | `true` | Show subject for exams. |
| `showExamTeacher` | bool | `true` | Show teacher for exams. |
| `mode` | string | `'compact'` | Display mode for lists: `'verbose'` (per-student sections) or `'compact'` (combined). |
| `displayMode` | string | `'grid'` | How to display lessons: `'list'` or `'grid'` (multi-day grid with exact positioning). |
| `logLevel` | string | `'none'` | string to enable debugging: `'debug'`. |



### Student credential object

A single `students` entry is an object with credential and per-student overrides. Common fields:

- `title` (string) — displayed name for the student.
- `qrcode` (string) — preferred: QR-code login string from WebUntis (`untis://...`). If provided this is used for login.
- `school`, `username`, `password`, `server` — alternative credentials if QR code is not used.
- `class` — name of the class (used in anonymous/class mode).
- Per-student overrides: any global option (like `daysToShow`, `examsDaysAhead`, `logLevel`, `enableDebug`, etc.) can be supplied inside the student object to override the global value for that student.

Example student entry:

```javascript
{
  title: "Alice",
  qrcode: "untis://setschool?url=...&school=...&user=...&key=..."
  // optional override:
  // daysToShow: 3,
  // logLevel: 'debug'
}
```

## How the timetable grid works (developer notes)

- The backend (`node_helper.js`) normalizes times and adds numeric fields `startMin` and `endMin` (minutes since midnight). The frontend relies on these numeric fields to position lesson blocks precisely in the multi-day grid.
- The backend tries to preserve stable lesson IDs (when available) and the frontend preserves a `lessonIds` array when it merges consecutive lessons. After merging the `lessonId` is kept for backward compatibility.
- Caching: the helper uses short in-memory caches for timegrid and weekly timetables to reduce redundant WebUntis API calls.

## Log levels and debugging

- Use `logLevel` to control logging verbosity. For normal usage `info` or `none` is fine. Use `debug` for troubleshooting.

## Troubleshooting

- If you see empty results, check credentials and try `useClassTimetable: true` — some schools expose only class timetables.
- Enable `logLevel: 'debug'` to get more information in the MagicMirror server log.
- If a student uses MS365 or SSO logins that cannot be automated, prefer generating a WebUntis data-access QR code inside the student's account and use that value.

## Dependencies

- [TheNoim/WebUntis](https://github.com/TheNoim/WebUntis) — installed via `npm install` in the module directory.

## Screenshot

"mode: verbose":

![Screenshot](screenshot.png "Screenshot verbose mode")

## Attribution

This project is based on work done by Paul-Vincent Roll in the MMM-Wunderlist module. (<https://github.com/paviro/MMM-Wunderlist>)
