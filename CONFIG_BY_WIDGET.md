# MMM-Webuntis — Configuration Options Per Widget

This document summarizes the effective configuration keys that each widget reads (based on current code). The goal is to present each widget's options as a grouped object (like `dateFormats`) so future refactors can move widget options under widget-specific namespaces.

Guiding rules:
- Widgets prefer per-student overrides (`studentConfig.widgetName?.option`) then module-level (`config.widgetName?.option`), then legacy keys, then defaults.
- `dateFormats` is already used as a per-widget map (e.g. `dateFormats.lessons`). A migration to `lessons.dateFormat` / `grid.dateFormat` etc. is recommended.
- Do not remove legacy keys until a small compatibility mapper is in place (see `config/legacy-config-mapper.js`).

---

**Module-level / Common**
- `header` (string)
- `fetchIntervalMs` (ms)
- `logLevel` (none|error|warn|info|debug)
- `displayMode` (comma list: grid, lessons, exams, homework, absences, messagesofday)
- `mode` (verbose|compact)
- `daysToShow`, `pastDaysToShow`
- `students` (array)
- `dumpBackendPayloads` (boolean)

---

**Suggested Widget-Namespace Structure**
(Recommended new shape; legacy mapper will populate these from existing keys.)

- `lessons` (object)
  - `dateFormat` (string) — formerly `dateFormats.lessons` or `dateFormat`
  - `showStartTime` (boolean)
  - `showRegularLessons` (boolean)
  - `useShortSubject` (boolean)
  - `showTeacherMode` ("full"|"initial"|null)
  - `showSubstitutionText` (boolean)
  - (removed) `weekday` — use `dateFormat` tokens `EEE` / `EEEE` instead

- `grid` (object)
  - `dateFormat` (string) — formerly `dateFormats.grid`
  - `mergeGapMinutes` (number)
  - `maxGridLessons` (number)
  - `showNowLine` (boolean)

- `exams` (object)
  - `dateFormat` (string) — formerly `dateFormats.exams`
  - `examsDaysAhead` (number)
  - `showExamSubject` (boolean)
  - `showExamTeacher` (boolean)

- `homework` (object)
  - `dateFormat` (string) — formerly `dateFormats.homework` or `homeworkDateFormat`

- `absences` (object)
  - `dateFormat` (string) — formerly `dateFormats.absences`
  - `absencesPastDays` (number)
  - `absencesFutureDays` (number)

- `messagesofday` (object)
  - (no date-specific options currently)

---

**Legacy keys that are still in use in code**
- `dateFormats` (map: default, lessons, grid, exams, homework, absences)
- `dateFormat` (legacy single date format)
- `homeworkDateFormat`, `examDateFormat` (older single keys)
- `showStartTime`, `showRegularLessons`, `useShortSubject`, etc. at module-level

These will be mapped into the widget namespaces by the compatibility mapper.

---

**Migration notes / recommendations**
- Introduce widget namespaces in `defaults` in `MMM-Webuntis.js` and `config.template.js` (non-breaking: leave legacy keys in place for now).
- Add `config/legacy-config-mapper.js` that exports `normalizeConfig(cfg)` to convert old keys into the new shape at runtime (used by frontend before sending to backend and by backend when normalizing).
- Once adequate time has passed and users have migrated, remove legacy fallbacks.

---

**Testing expectation**
- After mapper is in place, the module should behave the same for existing configs.
- Example acceptance: For child `M`, the backend log should include: `Data ready: timetable=21 exams=2 hw=11 abs=1` when fetching with the provided configuration.


