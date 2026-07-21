# Plugins

Use `displayMode` to decide which built-in plugins are active.

## Available Plugins

| Plugin | Purpose |
| --- | --- |
| `grid` | Weekly or rolling timetable grid |
| `lessons` | Lesson list with changes |
| `exams` | Upcoming exams |
| `homework` | Homework entries |
| `absences` | Absence records |
| `messagesofday` | WebUntis messages of day |

## Common `displayMode` Values

- `lessons, exams`
- `grid, lessons, exams`
- `grid`
- `homework, absences`

`displayMode` remains the simple public switch for the built-in plugins. Internally, the module normalizes this into `plugins.<id>.enabled`.

## Common Plugin Options

### Lessons Plugin

Useful options:

- `lessons.nextDays`
- `lessons.pastDays`
- `lessons.dateFormat`
- `lessons.hideWeekends`
- `lessons.showStartTime`
- `lessons.showTeacherMode`
- `lessons.showRoom`
- `lessons.showSubstitution`

### Grid Plugin

Useful options:

- `grid.weekView`
- `grid.nextDays`
- `grid.pastDays`
- `grid.hideWeekends`
- `grid.showNowLine`
- `grid.maxLessons`
- `grid.fields.primary`
- `grid.fields.secondary`
- `grid.fields.additional`

### Exams, Homework, And Absences Plugins

The most common options are the date range and the date format:

- `exams.nextDays`
- `homework.nextDays`
- `absences.pastDays`
- `absences.nextDays`
- `*.dateFormat`

## Canonical Plugin Config Example

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

If you are just getting started, keep plugin configuration minimal and only add one or two display tweaks at a time.