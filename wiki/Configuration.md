# Configuration

This page covers the options most users actually need. For a full example file, see `config/config.template.js` in the repository.

## Top-Level Options You Will Usually Touch

| Option | Default | What it does |
| --- | --- | --- |
| `header` | `MMM-Webuntis` | Module title shown by MagicMirror |
| `updateInterval` | `5 * 60 * 1000` | Refresh interval in milliseconds |
| `displayMode` | `lessons, exams` | Which widgets are enabled |
| `timezone` | `Europe/Berlin` | Timezone used for date handling |
| `useClassTimetable` | `false` | Use class timetable instead of personal timetable |
| `logLevel` | `none` | Backend logging level for troubleshooting |
| `debugDate` | `null` | Freeze the calendar date for testing |

## Choosing Widgets With `displayMode`

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

Some widgets can override these values individually. See [Widgets](Widgets).

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

Use these only when you need to investigate problems:

- `logLevel: 'debug'`
- `debugDate: 'YYYY-MM-DD'`
- `dumpBackendPayloads: true`
- `dumpRawApiResponses: true`

## Canonical Plugin Config

Widget-specific options live under `plugins.<id>.config`.

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

If you are migrating from an older config, `displayMode` is still the simplest public entry point. Detailed widget options are summarized in [Widgets](Widgets).