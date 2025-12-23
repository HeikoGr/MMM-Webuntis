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

Add `MMM-Webuntis` to your `config/config.js` inside the `modules` array. Here's a **minimal** example:

```javascript
{
  module: "MMM-Webuntis",
  position: "top_right",
  config: {
    students: [
      { title: "Alice", qrcode: "untis://setschool?..." },
    ]
  }
},
```

For a more complete example with common options, see [config/config.template.js](config/config.template.js).

## Template-based config workflow

- This repository ships with templates in `config/` so you can bootstrap a MagicMirror setup quickly without committing personal credentials or styling tweaks.

- Copy the template files to `config.js` / `custom.css` inside the same folder (both paths are listed in `.gitignore`) and customize them locally:

```bash
cp config/config.template.js config/config.js
cp config/custom.template.css config/custom.css
```

If you are not using the DevContainer, you can still treat the template files as examples—copy them into your MagicMirror core folder manually and adjust them there.

## Configuration options

All configuration options are documented in [MMM-Webuntis.js](MMM-Webuntis.js#L1-L48) in the `defaults` object, organized by feature area. Global options can be declared at the top level of `config` and can be overridden per-student by adding the same property in a student object.

### Global Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `header` | string | `'MMM-Webuntis'` | Title displayed by MagicMirror for this module. |
| `fetchIntervalMs` | int | `15 * 60 * 1000` | Fetch interval in milliseconds (default 15 minutes). |
| `logLevel` | string | `'none'` | Log verbosity: `'none'` or `'debug'`. |

### Display Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `displayMode` | string | `'list'` | Comma-separated list of widgets to render (top-to-bottom). Supported: `grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`. Backwards-compatible: `'list'` = `lessons, exams`; `'grid'` = `grid`. |
| `mode` | string | `'verbose'` | Display mode for lists: `'verbose'` (per-student sections) or `'compact'` (combined). |

### Timetable Fetch Range

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `daysToShow` | int | `7` | Number of upcoming days to fetch/display per student (0 = off). Can be overridden per-student. |
| `pastDaysToShow` | int | `0` | Number of past days to include (useful for debugging). |

### Lessons Widget

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `showStartTime` | bool | `false` | Show start time instead of lesson number in listings. |
| `showRegularLessons` | bool | `true` | Show regular lessons (not only substitutions/cancellations). |
| `showTeacherMode` | string | `'full'` | How to show teacher names: `'initial'` (first name), `'full'` (full name), or `'none'`. |
| `useShortSubject` | bool | `false` | Use short subject names where available. |
| `showSubstitutionText` | bool | `false` | Show substitution text from WebUntis (if present). |

### Exams Widget

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `examsDaysAhead` | int | `7` | Number of days ahead to fetch exams (0 = off). |
| `showExamSubject` | bool | `true` | Show subject for exams. |
| `showExamTeacher` | bool | `true` | Show teacher for exams. |

### Grid View

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `mergeGapMinutes` | int | `15` | Maximum gap (in minutes) between consecutive lessons to consider them mergeable. Lower = stricter merging. |
| `maxGridLessons` | int | `0` | Limit lessons per day in grid view. `0` = show all. `>=1` limits to the first N `timeUnits` (periods). |
| `showNowLine` | bool | `true` | Show the current time line in grid view. |

### Absences Widget

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `absencesPastDays` | int | `14` | Number of past days to include when fetching absences. Can be overridden per-student. |
| `absencesFutureDays` | int | `7` | Number of future days to extend the absences fetch beyond `daysToShow`. |

### Date Formats

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dateFormat` | string | `'dd.MM.'` | Format for timetable/lessons dates. Supports `dd`, `mm`, `yyyy`, `yy`, and non-padded variants `d`, `m` (e.g., `d.m.yyyy`). |
| `examDateFormat` | string | `'dd.MM.'` | Format for exam widget dates. |
| `homeworkDateFormat` | string | `'dd.MM.'` | Format for homework widget dates. |

### Timetable Source

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `useClassTimetable` | bool | `false` | Use class timetable instead of student timetable (some schools only provide class data). |

### Parent Account Support (Optional)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `parentUsername` | string | - | Parent account email/username for accessing multiple children's data. |
| `parentPassword` | string | - | Parent account password. |
| `school` | string | - | School name (can be overridden per student). |
| `server` | string | `'webuntis.com'` | WebUntis server hostname. |

## Auto-Discovery Feature

The module includes an **automatic student discovery** feature that eliminates the need to manually configure each child's `studentId` when using parent account credentials.

### How it works

When you provide **parent account credentials** (`username`, `password`, `school`, `server`) and leave the `students` array **empty**, the module will:

1. Authenticate with the parent account credentials
2. Fetch the list of children from WebUntis (`app/data` endpoint)
3. Automatically populate the `students` array with all children's names and IDs
4. Display all discovered children in the MagicMirror logs for reference

**Important:** Auto-discovery only happens when `students: []` is empty. If you manually configure ANY student, auto-discovery is skipped (respecting your explicit configuration).

### Example: Auto-Discovery Configuration

```javascript
{
  module: "MMM-Webuntis",
  position: "top_right",
  config: {
    // Parent account credentials
    username: "parent@example.com",
    password: "parentPassword123",
    school: "myschool",
    server: "myschool.webuntis.com",

    // Empty students array triggers auto-discovery
    students: [],

    // Rest of your config
    displayMode: "grid,exams,homeworks",
    daysToShow: 7,
  }
},
```

When MagicMirror starts, you'll see output like:

```
✓ Auto-discovered 2 student(s):
  • Emma Schmidt (ID: 12345)
  • Jonas Schmidt (ID: 12346)
```

### Customizing discovered students

If you want to customize the display names or settings for auto-discovered students, you can **add custom student entries** to override the auto-discovered defaults:

```javascript
{
  module: "MMM-Webuntis",
  position: "top_right",
  config: {
    // Parent account credentials
    username: "parent@example.com",
    password: "parentPassword123",
    school: "myschool",
    server: "myschool.webuntis.com",

    // Configure only the students you want to customize
    students: [
      {
        title: "Emma (11th grade)",  // Custom display name
        studentId: 12345,             // Must match the auto-discovered ID
        daysToShow: 5,                // Custom settings per student
      },
      // Jonas will still use auto-discovered name and defaults
    ],

    displayMode: "grid,exams,homeworks",
  }
},
```

This way, Emma will display as "Emma (11th grade)" while Jonas keeps the auto-discovered "Jonas Schmidt".

### How to get the `studentId` from logs

If you need to manually add a `studentId` to your configuration, follow these steps:

#### Step 1: Enable Auto-Discovery Temporarily

Create a config with empty `students` array and parent credentials:

```javascript
{
  module: "MMM-Webuntis",
  config: {
    username: "parent@example.com",
    password: "parentPassword123",
    school: "myschool",
    server: "myschool.webuntis.com",
    students: [],  // Empty = trigger auto-discovery
  }
},
```

#### Step 2: Check the MagicMirror Logs

Start MagicMirror and look at the **console logs or server terminal output**. You'll see:

```
✓ Auto-discovered 2 student(s):
  • Emma Schmidt (ID: 12345)
  • Jonas Schmidt (ID: 12346)
```

**The ID in parentheses is the `studentId` you need.**

#### Step 3: Copy the IDs to Your Config

Now update your config with the student IDs and custom names:

```javascript
{
  module: "MMM-Webuntis",
  config: {
    username: "parent@example.com",
    password: "parentPassword123",
    school: "myschool",
    server: "myschool.webuntis.com",

    students: [
      {
        title: "Emma",
        studentId: 12345,  // From the auto-discovery log
      },
      {
        title: "Jonas",
        studentId: 12346,  // From the auto-discovery log
      },
    ],

    displayMode: "grid,exams,homeworks",
  }
},
```

#### Troubleshooting: No logs visible?

If you don't see the auto-discovery message:

1. **Verify parent credentials** — Make sure `username`, `password`, `school`, and `server` are correct
2. **Check logLevel** — Set `logLevel: 'debug'` temporarily to see more details:
   ```javascript
   config: {
     username: "parent@example.com",
     password: "parentPassword123",
     school: "myschool",
     server: "myschool.webuntis.com",
     students: [],
     logLevel: 'debug',  // Enable debug output
   }
   ```
3. **Check MagicMirror logs** — Look at the terminal where you started MagicMirror (not just the browser console)

### Debug / Development Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `dumpBackendPayloads` | bool | `false` | Dump backend API responses to `debug_dumps/` folder for troubleshooting. |

### Student Credential Object

Each entry in the `students` array is an object with the following fields:

#### Required

- `title` (string) — displayed name for the student in the module output.

#### Credentials (choose one)

**Option A: QR Code (Recommended)**
- `qrcode` (string) — WebUntis QR code string (`untis://setschool?url=...&school=...&user=...&key=...`).
  - To get the QR code: log into WebUntis → Account → Data Access → generate QR code for this app.

**Option B: Direct Credentials**
- `username` (string) — student's WebUntis username or email.
- `password` (string) — student's WebUntis password.
- `school` (string) — school name in WebUntis.
- `server` (string, optional) — WebUntis server hostname (defaults to `webuntis.com`).

#### Optional Fields

- `class` (string) — class name (only needed if `useClassTimetable: true` and you want to fetch class timetable data).
- `studentId` (number) — when using parent account mode (see [Parent Account Support](README.md#parent-account-support-optional)), use this to configure children by their ID instead of individual credentials.
- Per-student option overrides — any global option (like `daysToShow`, `examsDaysAhead`, `logLevel`, etc.) can be supplied here to override the global value for this student only.

#### Example with QR Code

```javascript
{
  title: "Alice",
  qrcode: "untis://setschool?url=https://example.webuntis.com&school=example&user=alice&key=ABC123XYZ",
  daysToShow: 5, // override global daysToShow for this student
}
```

#### Example with Direct Credentials

```javascript
{
  title: "Bob",
  username: "bob.smith@school.edu",
  password: "password123",
  school: "Example School",
  server: "example.webuntis.com",
}
```

#### Example with Parent Account (studentId)

When using parent account credentials (see [Parent Account Support](README.md#parent-account-support-optional)), you can also configure children by `studentId`:

```javascript
{
  title: "Child 1",
  studentId: 12345, // retrieved from parent account API
}
```

## How the timetable grid works (developer notes)

- The backend (`node_helper.js`) fetches raw WebUntis data only. The frontend builds `timeUnits` from the timegrid and computes minute values from `startTime`/`endTime` strings when rendering.
- The frontend merges consecutive lessons with identical subject/teacher/code when the gap is within `mergeGapMinutes`. A merged block keeps a `lessonIds` array; `lessonId` is set when available.
- There is no explicit caching layer. Parallel fetches for the same credential are coalesced to avoid duplicate work.

Additional grid rendering notes:

- When `maxGridLessons` is set to `>=1` and `timeUnits` are available, the grid vertical range (time axis, hour lines and lesson blocks) is clipped to the end/start of the Nth `timeUnit` so periods below the cutoff are not shown. A small "... more" badge appears in the day's column when additional lessons are hidden.

## Debugging and Logging

- Use `logLevel: 'debug'` to enable detailed logging. For normal usage, `'none'` is sufficient.
- Enable `dumpBackendPayloads: true` to save API responses to the `debug_dumps/` folder for detailed inspection.

## Troubleshooting

- **Empty results:** Check credentials and try `useClassTimetable: true` — some schools expose only class timetables.
- **Debug info:** Enable `logLevel: 'debug'` in the config and check the MagicMirror server log.
- **SSO/MS365 logins:** If a student uses corporate SSO, generate a WebUntis data-access QR code inside the student's account and use that instead of direct credentials.
- **Absences with parent accounts:** The WebUntis API does not support retrieving absences through parent account logins. Absences are only available when logged in directly as the student. If `displayMode` includes `absences` but uses parent account credentials, the module will silently skip absences.

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
