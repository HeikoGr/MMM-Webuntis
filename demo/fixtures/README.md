# Demo Fixtures

Synthetic fixture payloads for screenshot generation and local UI testing.

## Rules

- Never copy personal data from real users.
- Keep all names, IDs, rooms, and free text anonymized.
- Keep payload shape compatible with `DATA_UPDATE` frontend payloads.
- Prefer realistic but deterministic school-week data.

## Files

- `single-student-week.json` – one anonymized student with one full week and all built-in plugins populated.

## Usage

Set in module config:

```js
{
  module: 'MMM-Webuntis',
  config: {
    demoDataFile: 'demo/fixtures/single-student-week.json',
    debugDate: '2026-03-02',
    displayMode: 'messagesofday, grid, lessons, exams, homework, absences',
  }
}
```

When `demoDataFile` is set, frontend demo mode skips backend/API and renders this fixture directly.

**Known limitation:** the plugins read their options from `context.config.plugins.<id>.config`
inside the fixture, but `single-student-week.json` still carries them under the legacy keys
(`context.config.grid`, `.lessons`, …), which only the backend normalizes. In demo mode the
widgets therefore fall back to their defaults: the grid shows a single day, exams are missing and
homework shows no text. The fixture also contains no messages of day.
