# MMM-Webuntis CLI

The CLI wrapper runs the real backend flow without starting a full MagicMirror instance. Use it to validate config, fetch live data, inspect payloads, and narrow problems to backend logic.

## Quick Start

```bash
node --run debug
```

That command:
- auto-detects `config/config.js` when possible
- loads all configured MMM-Webuntis modules
- runs the real `node_helper.js` initialization and fetch flow
- prints a backend-focused summary to the terminal

## Usage

```bash
node --run debug -- [options]
```

Supported options:

| Option | Meaning |
| --- | --- |
| `--config`, `-c` | Path to `config.js` |
| `--student`, `-s` | Student index to test |
| `--action`, `-a` | Restrict fetch scope: `all`, `auth`, `lessons`, `grid`, `exams`, `homework`, `absences`, `messagesofday` |
| `--dump`, `-d` | Also write debug dumps to `debug_dumps/` |
| `--verbose`, `-v` | Show detailed output |
| `--debug-api`, `-x` | Show detailed API requests and truncated responses |
| `--help`, `-h` | Show built-in help |

## Common Commands

```bash
# Fetch all configured students
node --run debug

# Fetch one student only
node --run debug -- --student 0

# Check one student with detailed logs
node --run debug -- --student 0 --verbose

# Restrict to one widget family
node --run debug -- --action exams

# Only test auth behavior
node --run debug -- --action auth --verbose

# Write debug dumps while fetching
node --run debug -- --dump --verbose

# Use a custom config file
node --run debug -- --config ./config/config.js --student 1
```

## What The CLI Is For

Use the CLI when you need to:
- validate backend auth and fetch behavior
- confirm which student config is actually loaded
- generate backend payload dumps for fixture work
- inspect REST and JSON-RPC behavior without frontend noise

Do not use it as the source of truth for endpoint details, configuration semantics, or payload structure. Those belong in the main docs.

## Output And Dumps

With `--dump` or the corresponding config flags, the CLI writes files into `debug_dumps/`.

Typical uses:

```bash
# Inspect lesson data in the newest dump
cat debug_dumps/*.json | jq '.data.lessons' | head -20

# Count exams across dumps
cat debug_dumps/*.json | jq '.data.exams | length'
```

## Troubleshooting

### Config file not found

- Pass `--config <path>` explicitly.
- Check that the file exports an object with `modules`.

### Missing credentials

- Verify whether auth is top-level parent auth or per-student auth.
- For SSO-backed accounts, use QR code instead of direct credentials.

### REST API failed

- Re-run with `--verbose`.
- Re-run with `--debug-api` if the failure is endpoint-specific.
- Use `node --run test:auth:curl` to isolate raw auth problems.

### No data returned

- Check date-range related config such as `grid.nextDays`, `lessons.nextDays`, and `exams.nextDays`.
- Confirm the student really has data in WebUntis for the tested window.

## Related Documentation

- [../docs/CONFIG.md](../docs/CONFIG.md)
- [../docs/API_REFERENCE.md](../docs/API_REFERENCE.md)
- [../docs/SERVER_REQUEST_FLOW.md](../docs/SERVER_REQUEST_FLOW.md)
- [../docs/API_V2_MANIFEST.md](../docs/API_V2_MANIFEST.md)