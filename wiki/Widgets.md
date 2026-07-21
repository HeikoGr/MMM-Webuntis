# Widgets

Use `displayMode` to decide which widgets are active.

## Available Widgets

| Widget | Purpose |
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

## Common Widget Options

### Lessons

Useful options:

- `lessons.nextDays`
- `lessons.pastDays`
- `lessons.dateFormat`
- `lessons.hideWeekends`
- `lessons.showStartTime`
- `lessons.showTeacherMode`
- `lessons.showRoom`
- `lessons.showSubstitution`

### Grid

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

### Exams, Homework, Absences

The most common options are the date range and the date format:

- `exams.nextDays`
- `homework.nextDays`
- `absences.pastDays`
- `absences.nextDays`
- `*.dateFormat`

## Canonical Config Example

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

If you are just getting started, keep widget configuration minimal and only add one or two display tweaks at a time.