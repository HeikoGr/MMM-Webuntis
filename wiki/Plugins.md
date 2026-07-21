# Plugins

Use `displayMode` to decide which built-in plugins are active.

Every built-in plugin now has its own detail page with all supported configuration options:

- [Lessons Plugin](Plugin-Lessons)
- [Grid Plugin](Plugin-Grid)
- [Exams Plugin](Plugin-Exams)
- [Homework Plugin](Plugin-Homework)
- [Absences Plugin](Plugin-Absences)
- [Messages Of Day Plugin](Plugin-MessagesOfDay)

## Available Plugins

| Plugin | Purpose | Details |
| --- | --- |
| `grid` | Weekly or rolling timetable grid | [Grid Plugin](Plugin-Grid) |
| `lessons` | Lesson list with changes | [Lessons Plugin](Plugin-Lessons) |
| `exams` | Upcoming exams | [Exams Plugin](Plugin-Exams) |
| `homework` | Homework entries | [Homework Plugin](Plugin-Homework) |
| `absences` | Absence records | [Absences Plugin](Plugin-Absences) |
| `messagesofday` | WebUntis messages of day | [Messages Of Day Plugin](Plugin-MessagesOfDay) |

## Common `displayMode` Values

- `lessons, exams`
- `grid, lessons, exams`
- `grid`
- `homework, absences`

`displayMode` remains the simple public switch for the built-in plugins. Internally, the module normalizes this into `plugins.<id>.enabled`.

## Canonical Config Shape

Plugin-specific options should be configured under `plugins.<id>.config`.

Example:

```javascript
plugins: {
  lessons: {
    enabled: true,
    config: {
      nextDays: 4,
      dateFormat: 'EEEE',
      showRoom: true,
    },
  },
  grid: {
    enabled: true,
    config: {
      weekView: true,
      showNowLine: true,
      fields: {
        primary: 'subject',
        secondary: 'teacher',
        additional: ['room'],
      },
    },
  },
}
```

Per-student overrides are also supported:

```javascript
students: [
  {
    title: 'Alice',
    qrcode: 'untis://...',
    plugins: {
      lessons: {
        config: {
          nextDays: 5,
        },
      },
    },
  },
]
```

For compatibility, top-level namespaces such as `lessons`, `grid`, `exams`, `homework`, `absences`, and `messagesofday` are still accepted. New configurations should use `plugins.<id>.config`.

## Quick Option Map

| Plugin | Most-used options |
| --- | --- |
| `lessons` | `nextDays`, `pastDays`, `dateFormat`, `hideWeekends`, `showStartTime`, `showTeacherMode`, `showRoom`, `showSubstitution` |
| `grid` | `weekView`, `nextDays`, `pastDays`, `hideWeekends`, `showNowLine`, `maxLessons`, `pxPerMinute`, `fields.primary`, `fields.secondary`, `fields.additional` |
| `exams` | `nextDays`, `dateFormat`, `showSubject`, `showTeacher` |
| `homework` | `nextDays`, `pastDays`, `dateFormat`, `showSubject`, `showText` |
| `absences` | `pastDays`, `nextDays`, `dateFormat`, `showDate`, `showExcused`, `showReason`, `maxItems` |
| `messagesofday` | no plugin-specific options yet |

## Recommended Reading Order

- Start with [Lessons Plugin](Plugin-Lessons) or [Grid Plugin](Plugin-Grid), because those are the most commonly customized views.
- Then check [Exams Plugin](Plugin-Exams), [Homework Plugin](Plugin-Homework), and [Absences Plugin](Plugin-Absences) for list-style widgets.
- Use [Messages Of Day Plugin](Plugin-MessagesOfDay) if you want Untis announcements.

If you are just getting started, keep plugin configuration minimal and only add one or two display tweaks at a time.