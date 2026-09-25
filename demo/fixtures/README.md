# Demo Fixtures

Synthetic fixture payloads for screenshot generation and local UI testing.

## Files

- `single-student-week.json` – Avery Finch, one full school week (28.09.–02.10.2026) with every
  built-in plugin populated: substitutions, room changes, a moved and a cancelled lesson, exams,
  homework, an absence, messages and the following autumn break.
- `sibling-week.json` – Avery's younger sibling Robin Finch at the same school in the same week, with
  a smaller timetable. Together with the first file it shows several students in one module.

## Rules

- Never copy personal data from real users.
- Keep all names, IDs, rooms, and free text anonymized.
- Keep the payload shape compatible with `DATA_UPDATE` frontend payloads
  ([API_V3_MANIFEST.md](../../docs/API_V3_MANIFEST.md)), but leave out `context.config`: the backend
  fills it in from the module config.
- Keep the story consistent. The free texts (lesson text, substitution text, messages) must match the
  data:
  - a lesson whose text says the room is missing has no room (and a `room` change);
  - homework is due in a lesson of its subject that is not cancelled, and that lesson carries the
    `HOMEWORK` display icon - WebUntis marks it that way, and the grid shows no marker without it;
  - an exam sits in a lesson of its subject that carries the `EXAM` display icon;
  - `MOVED` is only set on both halves of a move (the cancelled original and its replacement);
  - a message about a day must not contradict that day's timetable;
  - all fixtures describe the same school: no teacher or room is booked twice at the same time.

`node --test tests/demo-fixture.test.js` checks every rule that can be checked mechanically, for every
JSON file in this folder. The free texts still need a human read.

## Usage

Set in module config:

```js
{
  module: 'MMM-Webuntis',
  config: {
    demoDataFile: 'demo/fixtures/single-student-week.json',
    debugDate: '2026-09-30',
    displayMode: 'messagesofday, grid, lessons, exams, homework, absences',
  }
}
```

When `demoDataFile` is set, the backend serves the fixture instead of fetching from WebUntis - no
students or credentials needed. Everything else works like live operation, so the widgets follow the
module config and you can try options such as `plugins.grid.config.weekView` or `mode: 'compact'` with
the demo data. The fixture is re-read on every refresh, so edits show up without a restart.

Several fixtures can be combined in a comma-separated list, one student each - pair them with the
configured `students` by position:

```js
demoDataFile: 'demo/fixtures/single-student-week.json, demo/fixtures/sibling-week.json',
students: [{ title: 'Avery Finch' }, { title: 'Robin Finch' }],
```

## Screenshots

The README and wiki screenshots are generated from these fixtures with
`node scripts/take-screenshots.mjs` (config: [`../screenshots/config.js`](../screenshots/config.js)).
See [docs/SCREENSHOTS.md](../../docs/SCREENSHOTS.md) for the steps and for moving the demo week to a
new date.
