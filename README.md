# MMM-Webuntis

> ⚠️ **Disclaimer / Haftungsausschluss**:
>
> **English:** This project is **not** an official Untis product, is **not** affiliated with, endorsed by, or supported by Untis GmbH or any of its subsidiaries. WebUntis is a registered trademark of Untis GmbH. This is an independent, community-developed module for MagicMirror² that interfaces with WebUntis APIs. Use at your own risk.
>
> **Deutsch:** Dieses Projekt ist **kein** offizielles Untis-Produkt und steht in **keiner** Verbindung zu Untis GmbH oder deren Tochtergesellschaften. Es wird **nicht** von Untis unterstützt oder empfohlen. WebUntis ist eine eingetragene Marke der Untis GmbH. Dies ist ein unabhängiges, von der Community entwickeltes Modul für MagicMirror², das die WebUntis-APIs nutzt. Nutzung auf eigene Gefahr.

> ⚠️ **Important Notice**:
>
> This project contains substantial AI-generated code. Review, test, and audit all files, web UI, and documentation before using it in production or safety-relevant contexts. Treat defaults and generated logic as untrusted until verified.

A MagicMirror² module that shows cancelled, irregular or substituted lessons from WebUntis for configured students. It fetches timetable, exams and homework data from WebUntis and presents them in a compact list or a multi-day grid.

## BREAKING CHANGES in 0.4.0

This release consolidates several configuration keys and changes how the module handles config compatibility.

Important notes:

- The module contains a compatibility mapper that automatically translates several deprecated keys from older configs to the new key names during startup. By design, when a deprecated key is present its value will now take precedence — legacy values "win" and overwrite the new key. This makes upgrades safer for users who still have old keys in place, but you should still update your `config.js` to the canonical names.

Mapper behavior and warnings:

- When deprecated keys are detected the frontend emits a conspicuous browser console warning (styled in red) that lists the detected legacy keys and their location (e.g. `students[0].days`). This helps you find and update old keys during MagicMirror startup.
- Additionally, the backend will log an informational message for fetch operations; however, the compatibility mapping and the red console warning are produced in the frontend module so you can see them in the browser devtools when MagicMirror starts.

Common legacy → new mappings (applied automatically if present):

- `fetchInterval` → `fetchIntervalMs`
- `days` → `daysToShow`
- `examsDays` → `examsDaysAhead`
- `mergeGapMin` → `mergeGapMinutes`
- legacy `debug` / `enableDebug` (boolean) → `logLevel: 'debug'` or `'none'`
- `displaymode` → `displayMode` (normalized to lowercase)

Quick tip: find deprecated keys in your `config.js` with this command (run from your MagicMirror folder):

```bash
grep -n "fetchInterval\|days\|mergeGapMin\|displaymode\|enableDebug\|debug" config/config.js || true
```

Upgrade notes:

1. The mapper will translate legacy keys automatically at startup, but it's recommended to update your `config.js` to the new key names listed above.
2. Use the red console warning and the quick grep above to find legacy keys and replace them.
3. Restart MagicMirror after editing `config.js` to ensure the new keys are used consistently.

## Installation

1. Go to your MagicMirror² `modules` folder and run:

```bash
git clone https://github.com/HeikoGr/MMM-Webuntis
cd MMM-Webuntis
npm ci --omit=dev
```

2. Add the module to your MagicMirror `config/config.js` (see example below).

## Update

To update to the latest version:

```bash
cd ~/MagicMirror/modules/MMM-Webuntis
git pull
npm ci --omit=dev
```

Restart MagicMirror after updating.

## Quick start

Add `MMM-Webuntis` to your `config/config.js` inside the `modules` array. The example below shows the most common global options and a minimal per-student credential configuration.

```javascript
{
    module: "MMM-Webuntis",
    position: "top_right",
    header: "Untis",
    config: {
        // global options
    logLevel: "debug",
        fetchIntervalMs: 15 * 60 * 1000, // 15 minutes
        daysToShow: 7,
        pastDaysToShow: 0,
        mergeGapMinutes: 15,

        // per-student credentials
        students: [
            { title: "Alice", qrcode: "untis://setschool?..." },
            { title: "Bob", qrcode: "untis://setschool?..." }
        ]
    }
},
```

Note: The option names listed here are the canonical names. A small compatibility mapper exists (see "BREAKING CHANGES" above) that will translate commonly-used legacy aliases during startup and print a console warning; however, you should still rename keys in your `config.js` to the canonical names for clarity and future compatibility.

## Template-based config workflow

- This repository ships with templates in `config/` so you can bootstrap a MagicMirror setup quickly without committing personal credentials or styling tweaks.

- Copy the template files to `config.js` / `custom.css` inside the same folder (both paths are listed in `.gitignore`) and customize them locally. A simple helper command is:

```bash
cp config/config.template.js config/config.js
cp config/custom.template.css config/custom.css
```

- The DevContainer now mounts the whole `config/` folder into `/opt/magic_mirror/config/` (see `mounts` in `.devcontainer/devcontainer.json`). During startup the container copies `config.template.js` → `config.js` and `custom.template.css` → `custom.css` when the user files are missing, and it also syncs `config/custom.css` into `/opt/magic_mirror/css/custom.css`. That means editing the repo files inside the container updates them directly, and your overrides are kept in sync while the templates continue acting as safe defaults.

If you are not using the DevContainer, you can still treat the template files as examples—copy them into your MagicMirror core folder manually and adjust them there.

## Configuration options

The following configuration options are supported. Global options can be declared at the top level of `config` and can be overridden per-student by adding the same property in a student object.

| Option | Type | Default | Description |
| --- | --: | --: | --- |
| `students` | array | required | Array of student credential objects (see below). |
| `header` | string | none | Optional title printed by MagicMirror for this module instance. |
| `daysToShow` | int | `7` | Number of upcoming days to fetch/display (0..10). Set to `0` to disable. Can be overridden in a student object. |
| `pastDaysToShow` | int | `0` | How many past days to include in the grid (useful for debugging). |
| `absencesPastDays` | int | `14` | How many past days to include when fetching absences from WebUntis. Can be set globally or per-student. |
| `absencesFutureDays` | int | `0` | How many future days to extend the absences fetch beyond the normal `daysToShow` range. Can be set globally or per-student. |
| `fetchIntervalMs` | int | `15 * 60 * 1000` | Fetch interval in milliseconds (default 15 minutes). |
| `mergeGapMinutes` | int | `15` | Allowed gap in minutes between consecutive lessons to consider them mergeable. Lower = stricter merging. |
| `showStartTime` | bool | `false` | When `true` show the lesson start time; when `false` show the lesson number (if available). |
| `useClassTimetable` | bool | `false` | Some schools only provide a class timetable; set `true` to request class timetable instead of the student timetable. |
| `showRegularLessons` | bool | `false` | Show regular lessons (not only substitutions/cancellations). |
| `showTeacherMode` | string | `'full'` | How to show teacher names: `'initial'` , `'full'` , `'none'`. |
| `useShortSubject` | bool | `false` | Use short subject names where available. |
| `showSubstitutionText` | bool | `false` | Show substitution text from WebUntis (if present). |
| `fetchHomeworks` | bool | deprecated | Deprecated: homework is fetched automatically when `displayMode` includes the `homework` widget. |
| `examsDaysAhead` | int | `0` | How many days ahead to fetch exams. `0` disables exams. |
| `showExamSubject` | bool | `true` | Show subject for exams. |
| `showExamTeacher` | bool | `true` | Show teacher for exams. |
| `mode` | string | `'compact'` | Display mode for lists: `'verbose'` (per-student sections) or `'compact'` (combined). |
| `displayMode` | string | `'list'` | Comma-separated list of widgets to render (top-to-bottom). Supported: `grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`. Backwards-compatible single values: `list` = `lessons, exams` and `grid` = `grid`. |
| `maxGridLessons` | int | `0` | Limit number of periods/timeUnits shown in grid view. `0` = show all. `>=1` is interpreted as the number of `timeUnits` (periods) to display starting from the first period; when `timeUnits` are not available the module falls back to a simple count-based limit. This option can be set globally or per-student. |
| `fetchAbsences` | bool | deprecated | Deprecated: absences are fetched automatically when `displayMode` includes the `absences` widget. |
| `dateFormat` | string | `'dd.MM.'` | Format string used when displaying dates in lists (supports `dd`, `mm`, `yyyy`, `yy`). Use `d`, `m` variants for non-zero padded numbers (e.g., `d.m.yyyy`). |
| `examDateFormat` | string | `'dd.MM.'` | Same as `dateFormat` but for exam widgets. |
| `homeworkDateFormat` | string | `'dd.MM.'` | Same as `dateFormat` but for homework widgets. |
| `logLevel` | string | `'none'` | string to enable debugging: `'debug'`. |

### Student credential object

A single `students` entry is an object with credential and per-student overrides. Common fields:

- `title` (string) — displayed name for the student.
- `qrcode` (string) — preferred: QR-code login string from WebUntis (`untis://...`). If provided this is used for login.
- `school`, `username`, `password`, `server` — alternative credentials if QR code is not used.
- `class` — name of the class (used in anonymous/class mode).
- Per-student overrides: any global option (like `daysToShow`, `examsDaysAhead`, `logLevel`, `enableDebug`, etc.) can be supplied inside the student object to override the global value for that student.

Example student entry:

```javascript
{
  title: "Alice",
  qrcode: "untis://setschool?url=...&school=...&user=...&key=..."
  // optional override:
  // daysToShow: 3,
  // logLevel: 'debug'
}
```

## How the timetable grid works (developer notes)

- The backend (`node_helper.js`) fetches raw WebUntis data only. The frontend builds `timeUnits` from the timegrid and computes minute values from `startTime`/`endTime` strings when rendering.
- The frontend merges consecutive lessons with identical subject/teacher/code when the gap is within `mergeGapMinutes`. A merged block keeps a `lessonIds` array; `lessonId` is set when available.
- There is no explicit caching layer. Parallel fetches for the same credential are coalesced to avoid duplicate work.

Additional grid rendering notes:

- When `maxGridLessons` is set to `>=1` and `timeUnits` are available, the grid vertical range (time axis, hour lines and lesson blocks) is clipped to the end/start of the Nth `timeUnit` so periods below the cutoff are not shown. A small "... more" badge appears in the day's column when additional lessons are hidden.

### Date format customization

- `dateFormat`, `examDateFormat`, and `homeworkDateFormat` were introduced so you can control how dates are shown in the list/exam/homework widgets. They accept the placeholders `dd`, `mm`, `yyyy`, `yy` and support single-digit variants by dropping the leading zero (e.g., `d.m.yyyy`). Since the values are resolved inside the widgets, you can set formats per student by adding these keys directly to a student object.

## Log levels and debugging

- Use `logLevel` to control logging verbosity. For normal usage `info` or `none` is fine. Use `debug` for troubleshooting.

## Troubleshooting

- If you see empty results, check credentials and try `useClassTimetable: true` — some schools expose only class timetables.
- Enable `logLevel: 'debug'` to get more information in the MagicMirror server log.
- If a student uses MS365 or SSO logins that cannot be automated, prefer generating a WebUntis data-access QR code inside the student's account and use that value.

## CLI tool (config check)

This module includes a small interactive CLI tool that reads your MagicMirror config, lists all configured students (duplicates are allowed), and lets you query a selected student for:

- current timetable (today, with changes)
- next exams
- homeworks
- absences

Run from the module directory:

```bash
node --run check
```

If your config is not in a standard location, pass it explicitly:

```bash
node cli/cli.js --config /path/to/config.js
```

## Dependencies

- [TheNoim/WebUntis](https://github.com/TheNoim/WebUntis) — installed via `npm install` in the module directory.

## Holiday Display

The `lessons` and `grid` widgets now automatically display holiday information from the WebUntis API:

- **Lessons widget:** Shows a holiday notice between lessons with the 🏖️ emoji and holiday name when a holiday period is detected
- **Grid widget:** Displays a semi-transparent overlay with the 🏖️ emoji and holiday name on days that fall within a holiday period

Holiday data is automatically fetched from WebUntis alongside timetable data. No additional configuration is required.

## Screenshot

displayMode: "list", mode: "verbose":

![Screenshot](screenshot-list.png 'Screenshot verbose mode')

displayMode: "messagesofday,grid,exams,homework,absences":

![Screenshot](screenshot-all.png 'Screenshot with all widgets (except lessons)')

## Attribution

This project is based on work done by Paul-Vincent Roll in the MMM-Wunderlist module. (<https://github.com/paviro/MMM-Wunderlist>)
