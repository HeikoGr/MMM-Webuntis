# MMM-Webuntis — Configuration Options Per Widget

This document describes the per-widget configuration structure used by MMM-Webuntis.

## Configuration Lookup Order

Widgets follow this priority for configuration:
1. Student-specific override (`studentConfig.widgetName?.option`)
2. Module-level widget namespace (`config.widgetName?.option`)
3. Hardcoded defaults in widget code

## Widget Configuration Namespaces

All widgets now use the new widget-namespaced configuration structure.

### Module-level Common Options

- `header` (string) — displayed module title
- `fetchIntervalMs` (milliseconds) — fetch interval
- `logLevel` (string) — 'none'|'error'|'warn'|'info'|'debug'
- `displayMode` (string) — comma-separated widget list: grid, lessons, exams, homework, absences, messagesofday
- `mode` (string) — 'verbose' (per-student sections) or 'compact' (combined)
- `daysToShow` (number) — days to display/fetch per student
- `pastDaysToShow` (number) — past days to include
- `students` (array) — student configurations
- `dumpBackendPayloads` (boolean) — debug option

---

## Per-Widget Configuration

### Lessons Widget

- `lessons.dateFormat` (string, default: `'EEE'`) — date format for lessons (supports `EEE`, `EEEE`, `dd`, `mm`, `yyyy`)
- `lessons.showStartTime` (boolean, default: `false`)
- `lessons.showRegular` (boolean, default: `false`)
- `lessons.useShortSubject` (boolean, default: `false`)
- `lessons.showTeacherMode` (string, default: `'full'`) — `'full'`, `'initial'`, or null/falsy
- `lessons.showSubstitution` (boolean, default: `false`)

### Grid Widget

- `grid.dateFormat` (string, default: `'EEE dd.MM.'`)
- `grid.mergeGap` (number, default: `15`) — in minutes
- `grid.maxLessons` (number, default: `0`)
- `grid.showNowLine` (boolean, default: `true`)

### Exams Widget

- `exams.dateFormat` (string, default: `'dd.MM.'`)
- `exams.daysAhead` (number, default: `21`)
- `exams.showSubject` (boolean, default: `true`)
- `exams.showTeacher` (boolean, default: `true`)

### Homework Widget

- `homework.dateFormat` (string, default: `'dd.MM.'`)

### Absences Widget

- `absences.dateFormat` (string, default: `'dd.MM.'`)
- `absences.pastDays` (number, default: `21`)
- `absences.futureDays` (number, default: `7`)

### Messages of Day Widget

- `messagesofday` (currently no options)

---

## Legacy Configuration Support

The module includes a compatibility mapper (in `lib/configValidator.js` via `applyLegacyMappings()`) that automatically translates old configuration keys to the new widget-namespaced structure at runtime. Old keys such as:

- `dateFormat` (global)
- `homeworkDateFormat`, `examDateFormat`
- `showStartTime`, `showRegularLessons`, etc. at module-level

are automatically mapped to their widget-namespaced equivalents. However, **widgets now read ONLY from the new widget namespaces** in the code (see `widgets/*.js` for current lookup order).

---

## Testing & Verification

The module should work correctly with both new widget-namespaced configs and legacy configs (via the compatibility mapper). Example acceptance criterion:

For a student `M`, the backend should report: `✓ Data ready: timetable=21 exams=2 hw=11 abs=1`

This confirms all widgets are fetching and rendering data correctly.



