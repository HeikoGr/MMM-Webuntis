# Lessons Plugin

The lessons plugin shows lesson changes as a list. It is best if you mainly care about substitutions, cancellations, moved lessons, and other irregular timetable entries.

## Enable The Plugin

Simple activation via `displayMode`:

```javascript
displayMode: 'lessons'
```

Canonical activation via `plugins.lessons`:

```javascript
plugins: {
  lessons: {
    enabled: true,
    config: {
      nextDays: 2,
    },
  },
}
```

The old top-level namespace `lessons: { ... }` is still accepted for compatibility, but `plugins.lessons.config` is the canonical form.

## All Configuration Options

| Option | Type / Values | Default | Effect |
| --- | --- | --- | --- |
| `nextDays` | number `>= 0` | `2` | How many future days are shown after today |
| `pastDays` | number `>= 0` | `0` | How many previous visible days are shown before today |
| `dateFormat` | string | `EEE` | Date label format for each lesson day |
| `hideWeekends` | boolean | `false` | Hides weekend rows unless that weekend day actually contains lessons |
| `showStartTime` | boolean | `false` | Shows clock times like `08:15` instead of period labels |
| `showRegular` | boolean | `false` | Also shows normal, unchanged lessons instead of mostly focusing on irregular ones |
| `useShortSubject` | boolean | `false` | Uses the short subject label when both short and long names exist |
| `showTeacherMode` | `off`, `initial`, `full` | `full` | Controls teacher display: hidden, initials, or full name |
| `showRoom` | boolean | `false` | Appends room information to each lesson row |
| `showSubstitution` | boolean | `false` | Adds substitution text below the lesson when available |
| `naText` | string | `N/A` | Fallback text when a changed field exists but no replacement value is available |

## Notes On Behavior

- With `showRegular: false`, the plugin mainly shows irregular entries such as substitutions, cancellations, and visible changes.
- Past lessons are hidden in normal operation. If `logLevel` is `debug`, past entries stay visible for troubleshooting.
- If `showStartTime` is `false`, the plugin uses timetable period labels when the backend provides time-unit data.
- `hideWeekends` only removes empty weekend days. Weekend days with lessons still appear.

## Typical Config

```javascript
plugins: {
  lessons: {
    enabled: true,
    config: {
      nextDays: 3,
      pastDays: 1,
      dateFormat: 'EEEE dd.MM.',
      hideWeekends: true,
      showStartTime: true,
      showTeacherMode: 'initial',
      showRoom: true,
      showSubstitution: true,
    },
  },
}
```

## Per-Student Override Example

```javascript
students: [
  {
    title: 'Alice',
    qrcode: 'untis://...',
    plugins: {
      lessons: {
        config: {
          nextDays: 5,
          showTeacherMode: 'off',
        },
      },
    },
  },
]
```