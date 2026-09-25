# Screenshots

All screenshots in the README and the wiki are rendered from the synthetic demo fixtures in
[demo/fixtures/](../demo/fixtures/), never from real WebUntis data. One command regenerates all of them:

```bash
node scripts/take-screenshots.mjs
```

It takes about ten seconds and writes:

| File | Content | Used in |
| --- | --- | --- |
| `screenshot-all.png` | messages of day, grid (3 days), exams, homework, absences combined | repository main screenshot |
| `img/grid.png` | grid in week view | README, wiki |
| `img/lessons.png` | lessons list | README, wiki |
| `img/exams-homework-absences.png` | exams, homework and absences | README, wiki |
| `img/messagesofday.png` | messages of day | README, wiki |
| `img/features/day-notices.png` | weekend and holiday notices in the grid | wiki feature overview |
| `img/features/compact-mode.png` | two children in compact mode | wiki feature overview |
| `img/features/grid-changes.png` | close-up of today and tomorrow in the week view (2x) | wiki feature overview |
| `img/features/grid-popover.png` | lesson detail popover (2x) | wiki feature overview |

Look at every image before committing. The tests check the demo data for consistency, but only a
person can tell whether a screenshot looks right.

## Requirements

- A MagicMirror² installation this module lives in (`<MagicMirror>/modules/MMM-Webuntis`).
  Set `MM_ROOT` if it is somewhere else.
- Playwright, either installed locally or globally (`npm i -g playwright`). The devcontainer already
  has it; there the script uses the installed Google Chrome, because the devcontainer skips the
  Playwright browser download.

Your own `config/config.js` and a mirror that is already running are not touched: the script starts
a second, throwaway MagicMirror server on port `8081` (`MM_PORT`) with
[demo/screenshots/config.js](../demo/screenshots/config.js) and stops it again at the end.

## How It Works

1. **Throwaway server.** MagicMirror reads `MM_CONFIG_FILE` and `MM_PORT`, so
   `MM_CONFIG_FILE=…/demo/screenshots/config.js MM_PORT=8081 node serveronly` serves the screenshot
   config next to the regular mirror.
2. **One module instance per screenshot.** The screenshot config adds MMM-Webuntis once per image,
   each with `demoDataFile`, its own plugin options and a CSS class `shot-<id>`. In demo mode the
   widgets follow the module config just like live data does (see
   [demo/fixtures/README.md](../demo/fixtures/README.md#usage)), so an instance shows exactly the
   options it sets - e.g. `weekView: true` for the week view, a different `debugDate` for the
   holiday notices, or two fixtures and `mode: 'compact'` for the compact mode.
3. **Frozen time.** `debugDate` only swaps the date and keeps the real wall-clock time. The script
   therefore freezes the browser clock (`SHOT_TIME`, default Wednesday `2026-09-30 10:50` Berlin
   time), so past lessons, the now line and the list filters look the same on every run.
4. **Neutral styling.** The installation's `css/custom.css` is replaced by an empty stylesheet, so
   local style tweaks do not end up in the images.
5. **Screenshots.** The script gives each instance a fixed width (`WIDTHS`), hides all others and
   shoots it with a small black margin. The two close-ups are taken in a second browser context with
   `deviceScaleFactor: 2`; the grid close-up finds its columns by date, derived from `SHOT_TIME`.

Environment variables: `MM_ROOT`, `MM_PORT` (default `8081`), `SHOT_TIME`
(default `2026-09-30T10:50:00+02:00`).

## Adding Or Changing A Screenshot

- **New widget combination or options:** add a `shot("<id>", { <plugin>: { enabled: true, config } })`
  entry to `demo/screenshots/config.js`, then add `<id>` to `WIDTHS` and `SHOTS` in the script.
- **New close-up:** extend `takeFeatureShots()`. Build the clip from element bounding boxes, not
  hard-coded coordinates, so it survives layout changes.

## Changing The Demo Data

Follow the rules in [demo/fixtures/README.md](../demo/fixtures/README.md) - that is the single place
they are written down. `node --test tests/demo-fixture.test.js` checks them.

Moving the demo week to a new date: shift every `date`, `examDate`, `dueDate`, `todayYmd`, `range`,
holiday range and timestamp in **all** fixtures, then update `SHOT_TIME` in the script,
the `debugDate` values in `demo/screenshots/config.js` and the example in `demo/fixtures/README.md`.
Monday to Friday must stay Monday to Friday. The test suite fails if the fixtures, the script and the
screenshot config disagree on "today".
