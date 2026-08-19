# Configuration

This page covers the options most users actually need. For a full example file, see `config/config.template.js` in the repository.

## Top-Level Options You Will Usually Touch

| Option | Default | What it does |
| --- | --- | --- |
| `header` | `MMM-Webuntis` | Module title shown by MagicMirror |
| `updateInterval` | `5 * 60 * 1000` | Refresh interval in milliseconds |
| `backgroundRefresh` | `true` | Keep refreshing while the module is hidden (e.g. under MMM-Carousel), so showing it never causes a request |
| `quietHours` | `null` | Optional window without any polling, e.g. `{ from: '22:00', to: '06:00' }` |
| `displayMode` | `lessons, exams` | Which built-in plugins are enabled |
| `mode` | `verbose` | `verbose` (per-student sections) or `compact` (combined view) |
| `timezone` | `Europe/Berlin` | Timezone used for date handling |
| `useClassTimetable` | `false` | Use class timetable instead of personal timetable |
| `logLevel` | `none` | Backend logging level for troubleshooting |
| `debugDate` | `null` | Freeze the calendar date for testing |
| `demoDataFile` | `null` | Relative JSON fixture path for frontend demo mode (skips backend/API entirely) |
| `initRetryTimeout` | `5000` | Timeout (ms) for the CONFIGURE → MODULE_READY watchdog before retrying |
| `initRetryMaxAttempts` | `4` | Max CONFIGURE attempts before the init retry gate reopens |
| `dumpBackendPayloads` | `false` | Dump raw payloads from the backend into `./debug_dumps/` |
| `dumpRawApiResponses` | `false` | Save raw WebUntis REST responses into `./debug_dumps/raw_api_*.json` |

## Choosing Plugins With `displayMode`

Use a comma-separated list:

- `grid`
- `lessons`
- `exams`
- `homework`
- `absences`
- `messagesofday`

Examples:

- `displayMode: 'lessons, exams'`
- `displayMode: 'grid, lessons, exams'`
- `displayMode: 'homework, absences'`

`list` is still accepted as an alias for `lessons, exams`.

## Timetable Range

These options control how far the module looks into the past and future:

| Option | Default | Meaning |
| --- | --- | --- |
| `nextDays` | `2` | Global fallback for days ahead |
| `pastDays` | `0` | Global fallback for days in the past |

Example:

- `pastDays: 1, nextDays: 3` means yesterday, today, and three future days.

Some plugins can override these values individually. See [Plugins](Plugins).

## Student Entries

Each entry in `students` normally contains:

- `title`
- either `qrcode` or `username` / `password` / `school`
- optionally `server`
- optionally `studentId` for parent-account customization

Example:

```javascript
students: [
  {
    title: 'Alice',
    qrcode: 'untis://setschool?url=myschool.webuntis.com&school=myschool&user=alice&key=ABC123...',
  },
]
```

## Debug Options

Use these only when you need to investigate problems — see `logLevel`, `debugDate`, `dumpBackendPayloads`, `dumpRawApiResponses`, `demoDataFile`, `initRetryTimeout`, and `initRetryMaxAttempts` in the option table above.

## Canonical Plugin Config

Plugin-specific options live under `plugins.<id>.config`.

Example:

```javascript
plugins: {
  lessons: {
    enabled: true,
    config: {
      dateFormat: 'EEEE',
      nextDays: 4,
    },
  },
  grid: {
    enabled: true,
    config: {
      weekView: true,
    },
  },
}
```

If you are migrating from an older config, `displayMode` is still the simplest public entry point. Detailed plugin options are summarized in [Plugins](Plugins) and documented per plugin on these pages:

- [Lessons Plugin](Plugin-Lessons)
- [Grid Plugin](Plugin-Grid)
- [Exams Plugin](Plugin-Exams)
- [Homework Plugin](Plugin-Homework)
- [Absences Plugin](Plugin-Absences)
- [Messages Of Day Plugin](Plugin-MessagesOfDay)