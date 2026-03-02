# WebUntis CLI - Comprehensive Guide

Command-line utilities for testing and debugging WebUntis API integration. The CLI provides a production-like interface for testing node_helper functions, validating API integration, and debugging WebUntis data fetching without requiring a full MagicMirror instance startup.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Core Features](#core-features)
3. [Commands Reference](#commands-reference)
4. [Configuration](#configuration)
5. [Real-World Examples](#real-world-examples)
6. [Technical Architecture](#technical-architecture)
7. [Troubleshooting](#troubleshooting)
8. [API Reference](#api-reference)

---

## Quick Start

The CLI is invoked through npm:

```bash
node --run debug -- [command] [options]
```

### Fastest Way: Auto-Detect Everything

```bash
# Test all students with auto-detected config
node --run debug

# Show help
node --run debug -- --help
```

### Common Quick Tests

```bash
# Fetch all data for first student (config auto-loads)
node --run debug

# With verbose output (shows sample data)
node --run debug -- --verbose

# Test specific student
node --run debug -- --student 1

# Test all configured students
node --run debug -- --all

# Use custom config file
node --run debug -- --config ./custom-config.js

# Combine options
node --run debug -- --student 0 --verbose
```

---

## Core Features

### ✅ Config Auto-Loading

The CLI automatically detects and loads your configuration:

- Auto-detects `config/config.js` in standard locations
- Supports custom config paths: `--config <path>`
- Handles both parent account and QR-code login modes
- No manual credential entry required (reuse existing config)

### ✅ Production-Grade Testing

Uses the same production initialization/fetch flow as the frontend (`_handleInitModule()` → `_handleFetchData()`):

- Tests actual production code paths
- Full REST API integration
- Automatic HTML sanitization
- Date/time normalization included
- No code duplication with actual implementation

### ✅ Flexible Data Fetching

Control how students are tested:

- Test individual students or run batch tests
- Date range configuration from config file

### ✅ Debug Dump Creation

Generate JSON files for offline testing:

- Saves payloads to `debug_dumps/` via module config (`dumpBackendPayloads`, `dumpRawApiResponses`)
- Test frontend widgets without live WebUntis access
- Use for automated CI/CD testing
- Sample data viewing with `--verbose`

### ✅ Comprehensive Logging

Enhanced console output for debugging:

- Color-coded log levels (info, debug, error, warn)
- Structured student/action information
- Token information with privacy masking
- API response sampling
- Timing information

---

## Commands Reference

### Default Command: Data Fetch

Fetches data for configured students using auto-loaded config.

**Signature:**
```bash
node --run debug [options]
```

**Options:**

| Option | Short | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--help` | `-h` | boolean | - | Show command help |
| `--config` | `-c` | string | auto | Path to config.js file |
| `--student` | `-s` | number | 0 | Student index to test |
| `--verbose` | `-v` | boolean | false | Show detailed output including sample data |
| `--all` | - | boolean | false | Iterate all students in the module config |

**Examples:**

```bash
# Test all data for first student (simplest)
node --run debug

# Verbose output for second student
node --run debug -- --student 1 -v

# Test all configured students in module
node --run debug -- --all -v

# Use custom config
node --run debug -- --config ./my-config.js --student 0
```

---

## Configuration

### Configuration File Format

The CLI reads from `config.js` or a custom path. Example:

```javascript
module.exports = {
  modules: [
    {
      module: "MMM-Webuntis",
      config: {
        // Parent account (recommended)
        username: "parent@example.com",
        password: "password123",
        school: "myhighschool",
        server: "myhighschool.webuntis.com",

        // Display configuration
        displayMode: "list", // or "grid"
        daysToShow: 14,
        pastDaysToShow: 0,
        exams: { daysAhead: 60 },
        absences: { pastDays: 30, futureDays: 60 },

        // Students
        students: [
          {
            title: "Alice",
            studentId: 12345,
            // Optional: override parent credentials
            // username: "alice.user",
            // password: "alice.password"
          },
          {
            title: "Bob",
            studentId: 67890,
          }
        ]
      }
    }
  ]
};
```

### Config Auto-Detection

The wrapper searches for config.js in this order (if `--config` not specified):

1. `./config/config.js` (relative to current directory)
2. `../config/config.js`
3. `../../config/config.js`

### Credential Modes

#### Mode 1: Parent Account (Recommended)

Module-level credentials apply to all students:

```javascript
config: {
  username: "parent@example.com",
  password: "password",
  // ... server, school, students
}
```

**Advantages:**
- Single set of credentials to manage
- Works across all students
- REST API provides comprehensive data access
- Supports absences, exams, homework, etc.

#### Mode 2: Individual Student Credentials

Each student can have their own credentials:

```javascript
students: [
  {
    title: "Alice",
    studentId: 123,
    username: "alice.user",      // optional override
    password: "alice.password"   // optional override
  }
]
```

**Usage:** Fallback if parent account is unavailable for a specific student.

#### Mode 3: QR Code Login

QR code can be provided instead of credentials:

```javascript
students: [
  {
    title: "Alice",
    qrcode: "https://...token..."  // or base64-encoded OTP
  }
]
```

**Note:** QR login uses REST API automatically.

---

## Real-World Examples

### Example 1: Validate Setup After Installation

```bash
# Test if config is readable
node --run debug -- --help

# Test with verbose output (includes auth + fetch flow)
node --run debug -- --verbose

# If auth passes, fetch all data
node --run debug

# Check console output for "successfully fetched data" message
```

### Example 2: Debug a Specific Student's Data

```bash
# List all configured students with index
node --run debug -- --verbose

# Test student at index 1
node --run debug -- --student 1 --verbose

# Inspect the JSON dump
cat debug_dumps/TIMESTAMP_StudentName_api.json | jq '.data.lessons' | head -20
```

### Example 3: Generate Offline Test Data

```bash
# Create fresh dumps for all students
node --run debug -- --all --verbose

# Use dumps in your widget tests
cp debug_dumps/*.json test_data/
```

### Example 4: CI/CD Pipeline Testing

```bash
#!/bin/bash
set -e

echo "Testing WebUntis configuration..."

# Fetch data for each student
for i in {0..2}; do
  echo "Testing student $i..."
  node --run debug -- --student $i || exit 1
done

# Optional: run once in verbose mode for snapshot output
node --run debug -- --verbose

echo "✓ All tests passed!"
```

### Example 5: Troubleshooting API Failures

```bash
# Get detailed output about what's failing
node --run debug -- --verbose

# Narrow scope to one student
node --run debug -- --student 0 --verbose

# Check the log output for specific error messages
# Look for patterns like "REST API failed" or "parse error"
```

---

## Technical Architecture

### Node Helper Wrapper Architecture

The `cli/node_helper_wrapper.js` bridges the CLI and production code:

```
User Input (CLI args)
       ↓
    [Parse arguments]
       ↓
    [Load config.js]
       ↓
    [Build INIT payload]
       ↓
    [_handleInitModule()]
       ↓
    [_handleFetchData()]  ← Real production fetch flow
       ↓
    [Send/cache results]
       ↓
    [Output to console]
```

### REST API Authentication Flow

1. **JSON-RPC Authentication** → Session cookies
2. **Bearer Token Request** → JWT token using cookies
3. **REST API Calls** → Use token + cookies together

### Key Implementation Notes

- ⚠️ **Resources Parameter**: Must be STRING, not number
  ```javascript
  resources: String(studentId)  // ✓ Correct
  resources: studentId          // ✗ Wrong
  ```

- 📍 **Timetable Data**: Located in `gridEntries`, not `dayEntries`
- ⏱️ **Token Lifetime**: 15 minutes (900 seconds), auto-refreshed
- 🔄 **Data Format**: REST responses transformed to JSON-RPC compatible format

### Data Fetching Pipeline

For each selected student:

1. **Initialize module config** (`_handleInitModule`)
2. **Trigger fetch orchestration** (`_handleFetchData`)
3. **Run timetable-first + parallel API calls** (backend orchestration)
4. **Build v2 payload** (`contractVersion/meta/context/data/state`)
5. **Capture `GOT_DATA` payload** from `sendSocketNotification`

### Response Caching

The CLI wrapper does **not** implement a separate response cache.

- It clears module caches at command start for fresh runs.
- Runtime caching (auth/token/session) is handled by backend services.

---

## Troubleshooting

### "Config file not found"

**Symptoms:**
```
Error: Config file not found
```

**Solutions:**

1. Check if config exists:
   ```bash
   ls -la config/config.js
   ```

2. Verify file exports correct structure:
   ```bash
   node -e "const c = require('./config/config.js'); console.log(c.modules ? 'OK' : 'Missing modules')"
   ```

3. Specify config explicitly:
   ```bash
   node --run debug -- --config ./config/config.js
   ```

### "Missing credentials"

**Symptoms:**
```
Error: No parent account credentials found
```

**Solutions:**

1. Verify `username` and `password` in config:
   ```bash
   grep -i parent config/config.js
   ```

2. Check for typos (case-sensitive!):
   - Should be `username` and `password` at module config level
   - Legacy names `parentUsername`/`parentPassword` are automatically mapped

3. For QR code login, verify `qrcode` field is present:
   ```bash
   grep -i qrcode config/config.js
   ```

### "REST API failed"

**Symptoms:**
```
REST API failed: 401 Unauthorized
```

**Common causes:**

- Invalid credentials → Re-verify in config.js
- School/server mismatch → Check `school` and `server` fields
- Two-factor authentication enabled → Use QR code login instead

**Debug steps:**

1. Test with `--verbose` flag:
   ```bash
   node --run debug -- --verbose
   ```

2. Check one student specifically:
   ```bash
   node --run debug -- --student 0 --verbose
   ```

3. Verify school/server values:
   ```bash
   node -e "const c = require('./config/config.js'); console.log(c.modules[0].config.school, c.modules[0].config.server)"
   ```

4. Test authentication with curl (low-level test):
   ```bash
   # Use credentials from config.js
   node --run test:auth:curl

   # Or test with specific credentials
   ./scripts/test_auth_with_curl.sh "schulexyz" "schulexyz.webuntis.com" "username" "password"
   ```

   This curl-based test verifies that:
   - Server connection works
   - Credentials are valid
   - UTF-8 encoding is correct (important for usernames with spaces/umlauts)
   - JSON-RPC authentication endpoint is accessible

   **Use case:** Bypass all module logic and test WebUntis API directly with curl.

### "No data returned"

**Symptoms:**
```
REST API returned 0 lessons
REST API returned 0 exams
```

**Possible causes:**

- Date range outside school calendar
- Student has no scheduled lessons/exams
- API permissions issue
- Wrong student ID

**Solutions:**

1. Check date ranges:
   ```bash
   node --run debug -- --verbose  # Shows actual date ranges used
   ```

2. Verify student ID:
   ```bash
   node --run debug -- --all --verbose
   ```

3. Check WebUntis web interface directly for the student

4. Adjust date configuration in config.js:
   ```javascript
   daysToShow: 21,        // Increase to see more days
   exams: { daysAhead: 90 },    // Increase exam look-ahead
   ```

### Node process exits with code 1

**Debug steps:**

1. Run with full error output:
   ```bash
   node --run debug -- --verbose 2>&1 | tail -50
   ```

2. Check for specific error patterns:
   ```bash
   node --run debug 2>&1 | grep -i "error\|failed\|undefined"
   ```

3. Validate config syntax:
   ```bash
   node --check config/config.js
   ```

---

## API Reference

### Student Configuration Object

**Type:** `StudentConfig`

```typescript
interface StudentConfig {
  title: string;              // Display name
  studentId?: number;         // Numeric ID (for parent account)
  username?: string;          // Optional override username
  password?: string;          // Optional override password
  qrcode?: string;            // QR code (alternative to credentials)
  daysToShow?: number;        // Override module daysToShow
  pastDaysToShow?: number;    // Override module pastDaysToShow
  exams?: { daysAhead?: number }; // Override exams.daysAhead
}
```

### Module Configuration Object

**Type:** `ModuleConfig`

```typescript
interface ModuleConfig {
  username?: string;
  password?: string;
  school: string;
  server: string;
  daysToShow?: number;        // Default: 14
  pastDaysToShow?: number;    // Default: 0
  displayMode?: "list" | "grid"; // Default: "list"
  exams?: { daysAhead?: number }; // Default: 60
  absences?: { pastDays?: number; futureDays?: number }; // Default: 0, 60
  students: StudentConfig[];
}
```

### Fetch Response Object

**Type:** `FetchResponse`

```typescript
interface FetchResponse {
   contractVersion: 2;
   meta: Record<string, unknown>;
   context: {
      student: { id: number | null; title: string };
      config: Record<string, unknown>;
   };
   data: {
      timeUnits: Array;
      lessons: Array;
      exams: Array;
      homework: Array;
      absences: Array;
      messages: Array;
      holidays: { ranges: Array; current: object | null };
   };
   state: {
      fetch: Record<string, boolean>;
      api: Record<string, number | null>;
      warnings: string[];
   };
}
```

### REST API Endpoints Used

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `/WebUntis/jsonrpc.do` | Session login (JSON-RPC) | Username/Password |
| `/WebUntis/api/token/new` | Get JWT bearer token | Session cookie |
| `/WebUntis/api/rest/view/v1/timetable/entries` | Fetch lessons by date range | Bearer + Cookie |
| `/WebUntis/api/exams` | Fetch exam schedule | Bearer + Cookie |
| `/WebUntis/api/homeworks/lessons` | Fetch homework | Bearer + Cookie |
| `/WebUntis/api/classreg/absences/students` | Fetch absences | Bearer + Cookie |
| `/WebUntis/api/public/news/newsWidgetData` | Fetch daily messages | Bearer + Cookie |

---

## Environment Variables

The CLI respects the same environment variables as MagicMirror:

```bash
# Set log level
export MMM_LOGMODULE=MMM-Webuntis

# Override config path
export WEBUNTIS_CONFIG=/path/to/config.js
```

---

## Performance Considerations

### Cache Behavior

- **CLI wrapper cache:** none (fresh run behavior)
- **Backend auth/session cache:** used transparently by services
- **Start behavior:** wrapper clears module caches before each run

### Typical Timing

```
Auth:            100-500ms
Timetable:       200-800ms  (depends on range)
Exams:           100-300ms
Homework:        100-400ms
Absences:        100-300ms
Total (all):     500-2000ms
```

---

## Advanced Usage

### Custom Config in Tests

```bash
# Create temporary config
cat > /tmp/test-config.js << 'EOF'
module.exports = {
  modules: [{
    module: "MMM-Webuntis",
    config: {
      username: process.env.WEBUNTIS_USER,
      password: process.env.WEBUNTIS_PASS,
      school: "testschool",
      server: "testschool.webuntis.com",
      students: [{ title: "Test", studentId: 12345 }]
    }
  }]
};
EOF

# Use it
node --run debug -- --config /tmp/test-config.js
```

### Parse Dump Files

```bash
# Show all timetable entries
cat debug_dumps/*.json | jq '.data.lessons' | jq '.[] | {start: .startTime, subject: .su}'

# Count exams
cat debug_dumps/*.json | jq '.data.exams | length'

# Show all homework
cat debug_dumps/*.json | jq '.data.homework[] | {text, dueDate}'
```

### Integration with Development Workflow

```bash
# Watch for changes and re-test
while true; do
  clear
   node --run debug -- --all
  sleep 5
done
```

---

## Privacy & Security

✓ Credentials never logged to console
✓ Tokens displayed with truncation (first/last 20 chars only)
✓ Email addresses anonymized (par***)
✓ No sensitive data stored in files
✓ All tests can use environment variables for credentials

---

## Support & Issues

### Reporting Issues

When reporting CLI issues, include:

1. Node.js version: `node --version`
2. npm version: `npm --version`
3. Full output with `--verbose`: `node --run debug -- --verbose 2>&1`
4. Config file (with credentials redacted)
5. Error message (first and last 20 lines)

### Testing Checklist

- [ ] Config file exists and is readable
- [ ] Credentials are correct in config
- [ ] `node --run debug -- --verbose` runs without auth/fetch errors
- [ ] `node --run debug` fetches data successfully
- [ ] Debug dumps (if enabled in config) contain expected student data

---

## See Also

- [Node Helper Implementation](../node_helper.js)
- [Module Documentation](../README.md)
- [MagicMirror Module Development](https://docs.magicmirror.builders/development/module-development.html)
