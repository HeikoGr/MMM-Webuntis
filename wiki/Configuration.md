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
| `excludeLessons` | `[]` | Hide lessons **plus the homework and exams of the same subject** by name, see [Hiding and Adding Lessons](#hiding-and-adding-lessons) |
| `addLessons` | `[]` | Add own lessons, see [Hiding and Adding Lessons](#hiding-and-adding-lessons) |
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

## Hiding and Adding Lessons

Both options can be set at module level or per student (`students[].excludeLessons` / `students[].addLessons`); a student value replaces the module value.

| Option | `grid` | `lessons` | `homework` | `exams` |
| --- | --- | --- | --- | --- |
| `excludeLessons` | hidden | hidden | hidden (matching subject) | hidden (matching subject) |
| `addLessons` | shown | shown (with `showRegular: true`) | – | – |

### `excludeLessons`

Useful when the class timetable contains lessons a student does not attend (support lessons, clubs, optional courses).

> **Not only lessons:** `excludeLessons` also hides **homework** (`homework` widget) and **exams** (`exams` widget) whose subject matches an entry. A subject you exclude disappears from every widget, not just from the timetable.

What is compared:

| Collection | Compared fields |
| --- | --- |
| Lessons (`grid`, `lessons`) | subject (short and long name), student group, lesson text |
| Homework | subject (short and long name) – not the homework text |
| Exams | subject – not the exam name (e.g. "Klassenarbeit") |

Matching rules:

- a plain string matches as a **case-insensitive substring** (`'AG'` also hides `AG Chor`, but also any subject containing "ag")
- `'/pattern/flags'` is a **regular expression**, e.g. `'/^AG$/i'` for an exact match

```javascript
excludeLessons: ['Förderunterricht', '/^AG Chor$/i'],
```

### `addLessons`

Adds lessons WebUntis does not know about, e.g. music school or tutoring. Each entry needs `startTime`, `endTime` (`'HH:MM'`), `subject` and **either** `weekday` (recurring) **or** `date` (once):

| Field | Required | Meaning |
| --- | --- | --- |
| `weekday` | one of `weekday`/`date` | `'mon'`…`'sun'`, `'monday'`…, German `'mo'`…`'so'` / `'montag'`…, or `1`-`7` (Monday = 1); an array for several days |
| `date` | one of `weekday`/`date` | Single date `'YYYY-MM-DD'` |
| `startTime` / `endTime` | yes | `'HH:MM'` |
| `subject` | yes | Subject (long name) |
| `subjectShort` | no | Short name (defaults to `subject`) |
| `teacher`, `room`, `text` | no | Shown like the WebUntis fields |
| `from` / `until` | no | Limit a recurring lesson to a date range (`'YYYY-MM-DD'`) |
| `showInHolidays` | no | Default `false`: skipped on school holidays (holidays are only known when the `grid` widget is enabled) |

```javascript
addLessons: [
  { weekday: 'tue', startTime: '15:30', endTime: '16:15', subject: 'Violin', room: 'Music school' },
  { weekday: ['mon', 'thu'], startTime: '16:00', endTime: '17:30', subject: 'Football', until: '2027-06-30' },
  { date: '2026-10-07', startTime: '14:00', endTime: '15:00', subject: 'Tutoring', teacher: 'Mr. Smith' },
],
```

Added lessons are regular lessons: the `lessons` widget only lists them with `showRegular: true`, the `grid` always shows them. Invalid entries are ignored and reported as a configuration warning.

## Debug Options

Use these only when you need to investigate problems — see `logLevel`, `debugDate`, `dumpBackendPayloads`, `dumpRawApiResponses`, `demoDataFile`, `initRetryTimeout`, and `initRetryMaxAttempts` in the option table above.

**`debugDate` and past school years:** pick a date inside the *current* school year. WebUntis serves homework only for the school year your session was opened in, so a `debugDate` in an earlier school year shows no homework, while the timetable and exams still appear. Normal operation is unaffected. Details: [API_REFERENCE.md](../docs/API_REFERENCE.md#known-limitation-debugdate).

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