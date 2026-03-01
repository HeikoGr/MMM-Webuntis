# Demo Fixtures

Synthetic fixture payloads for screenshot generation and local UI testing.

## Rules

- Never copy personal data from real users.
- Keep all names, IDs, rooms, and free text anonymized.
- Keep payload shape compatible with `GOT_DATA` frontend payloads.
- Prefer realistic but deterministic school-week data.

## Files

- `single-student-week.json` – one anonymized student with one full week and all widgets populated.

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
