# WebUntis CLI - Comprehensive Testing Guide

The WebUntis CLI provides a production-like command-line interface for testing node_helper functions, validating API integration, and debugging WebUntis data fetching without requiring a full MagicMirror instance startup.

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
npm run debug -- [command] [options]
```

### Fastest Way: Auto-Detect Everything

```bash
# Test all students with auto-detected config
npm run debug

# Show help
npm run debug -- --help
```

### Common Quick Tests

```bash
# Fetch all data for first student (auto-loads config)
npm run debug

# With verbose output (shows sample data)
npm run debug -- --verbose

# Test specific student
npm run debug -- --student 1

# Test only authentication
npm run debug -- --action auth

# Create a JSON dump for frontend testing
npm run debug -- --dump

# Combine options
npm run debug -- --student 0 --action exams --verbose --dump
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

Uses the **real** `node_helper.fetchData()` function:

- Tests actual production code paths
- Full REST API integration
- Automatic HTML sanitization
- Date/time normalization included
- No code duplication with actual implementation

### ✅ Flexible Data Fetching

Control what gets fetched:

- Fetch all data types or specific ones
- Test individual students or run batch tests
- Selective action targeting (auth, timetable, exams, homework, absences, messages)
- Date range configuration from config file

### ✅ Debug Dump Creation

Generate JSON files for offline testing:

- Saves complete API response payloads to `debug_dumps/`
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
npm run debug [options]
```

**Options:**

| Option | Short | Type | Default | Description |
|--------|-------|------|---------|-------------|
| `--help` | `-h` | boolean | - | Show command help |
| `--config` | `-c` | string | auto | Path to config.js file |
| `--student` | `-s` | number | 0 | Student index to test |
| `--action` | `-a` | string | all | What to test: `auth`, `timetable`, `exams`, `homework`, `absences`, `all` |
| `--verbose` | `-v` | boolean | false | Show detailed output including sample data |
| `--dump` | `-d` | boolean | false | Create JSON debug dump file |

**Examples:**

```bash
# Test all data for first student (simplest)
npm run debug

# Test authentication only for second student
npm run debug -- --student 1 --action auth

# Verbose output with exams only
npm run debug -- --action exams -v

# Create a dump for testing
npm run debug -- --dump

# Use custom config
npm run debug -- --config ./my-config.js --student 0
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
        examsDaysAhead: 60,
        absencesPastDays: 30,
        absencesFutureDays: 60,

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
npm run debug -- --help

# Test authentication only
npm run debug -- --action auth --verbose

# If auth passes, fetch all data
npm run debug

# Check console output for "successfully fetched data" message
```

### Example 2: Debug a Specific Student's Data

```bash
# List all configured students with index
npm run debug -- --verbose

# Test student at index 1
npm run debug -- --student 1 --action all --verbose

# Inspect the JSON dump
cat debug_dumps/TIMESTAMP_StudentName_api.json | jq '.timetableRange' | head -20
```

### Example 3: Generate Offline Test Data

```bash
# Create fresh dumps for all students
npm run debug -- --student 0 --dump
npm run debug -- --student 1 --dump
npm run debug -- --student 2 --dump

# Use dumps in your widget tests
cp debug_dumps/*.json test_data/
```

### Example 4: CI/CD Pipeline Testing

```bash
#!/bin/bash
set -e

echo "Testing WebUntis configuration..."

# Test auth
npm run debug -- --action auth || exit 1

# Fetch data for each student
for i in {0..2}; do
  echo "Testing student $i..."
  npm run debug -- --student $i || exit 1
done

# Create dumps for regression testing
npm run debug -- --dump

echo "✓ All tests passed!"
```

### Example 5: Troubleshooting API Failures

```bash
# Get detailed output about what's failing
npm run debug -- --verbose

# Test each component separately
npm run debug -- --action auth --verbose      # Check authentication
npm run debug -- --action timetable --verbose # Check timetable fetching
npm run debug -- --action exams --verbose     # Check exam API
npm run debug -- --action homework --verbose  # Check homework API

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
    [Extract student credentials]
       ↓
    [Call node_helper.fetchData()]  ← Real production code!
       ↓
    [Send/cache results]
       ↓
    [Output to console]
```

### Authentication Flow

1. **Parse credentials** from config.js
2. **JSON-RPC login** → Get session cookies (JSON-RPC API)
3. **Request bearer token** → Use cookies to get JWT (REST API)
4. **REST API calls** → Use token + cookies together
5. **Auto-refresh** → Token valid for 15 minutes, refreshed automatically

### Data Fetching Pipeline

For each data type (timetable, exams, homework, absences):

1. **Determine login mode** (QR code or parent account)
2. **Check cache** (30-second in-memory cache)
3. **Call REST API** with appropriate parameters
4. **Transform/compact** response for frontend
5. **Cache result** for subsequent requests
6. **Send to frontend** via notification

### Response Caching

The CLI uses a built-in cache to avoid repeated API calls:

- **TTL:** 30 seconds (configurable)
- **Key:** Credential + action signature
- **Cleanup:** Automatic periodic cleanup
- **Benefits:** Fast repeated testing, reduced API load

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
   npm run debug -- --config ./config/config.js
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
   - Should be `username` (capital U and P)
   - Not `parentUsername` or `username`

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
- Credentials with special characters → URL-encode them
- Two-factor authentication enabled → Use QR code login instead

**Debug steps:**

1. Test with `--verbose` flag:
   ```bash
   npm run debug -- --action auth --verbose
   ```

2. Check authentication specifically:
   ```bash
   npm run debug -- --action auth
   ```

3. Verify school/server values:
   ```bash
   node -e "const c = require('./config/config.js'); console.log(c.modules[0].config.school, c.modules[0].config.server)"
   ```

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
   npm run debug -- --verbose  # Shows actual date ranges used
   ```

2. Verify student ID:
   ```bash
   npm run debug -- --verbose --action all
   ```

3. Check WebUntis web interface directly for the student

4. Adjust date configuration in config.js:
   ```javascript
   daysToShow: 21,        // Increase to see more days
   examsDaysAhead: 90,    // Increase exam look-ahead
   ```

### Node process exits with code 1

**Debug steps:**

1. Run with full error output:
   ```bash
   npm run debug -- --verbose 2>&1 | tail -50
   ```

2. Check for specific error patterns:
   ```bash
   npm run debug 2>&1 | grep -i "error\|failed\|undefined"
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
  examsDaysAhead?: number;    // Override module examsDaysAhead
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
  daysToShow?: number;           // Default: 14
  pastDaysToShow?: number;       // Default: 0
  examsDaysAhead?: number;       // Default: 60
  absencesPastDays?: number;     // Default: 0
  absencesFutureDays?: number;   // Default: 60
  displayMode?: "list" | "grid"; // Default: "list"
  students: StudentConfig[];
}
```

### Fetch Response Object

**Type:** `FetchResponse`

```typescript
interface FetchResponse {
  title: string;
  config: StudentConfig;
  timeUnits: Array;              // Grid time slots
  timetableRange: Array;         // Lessons
  exams: Array;                  // Exam records
  homeworks: Array;              // Homework assignments
  absences: Array;               // Absence records
  messagesOfDay: Array;          // Daily messages
  holidays: Array;               // Holiday periods
}
```

### REST API Endpoints Used

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `/WebUntis/jsonrpc.do` | Session login (JSON-RPC) | Username/Password |
| `/WebUntis/api/token/new` | Get JWT bearer token | Session cookie |
| `/WebUntis/api/timegrid` | Fetch timegrid/periods | Bearer token |
| `/WebUntis/api/timetable` | Fetch lessons by date range | Bearer token |
| `/WebUntis/api/exams` | Fetch exam schedule | Bearer token |
| `/WebUntis/api/homeworks` | Fetch homework | Bearer token |
| `/WebUntis/api/absences` | Fetch absences (REST) | Bearer token |
| `/WebUntis/api/messagesofday` | Fetch daily messages | Bearer token |

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

- **In-Memory Cache:** 30 seconds (default)
- **Cache Key:** `credentialHash + actionType`
- **Hit Rate:** Typical 80-90% for repeated testing
- **Memory Usage:** <1MB for typical configuration

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
npm run debug -- --config /tmp/test-config.js
```

### Parse Dump Files

```bash
# Show all timetable entries
cat debug_dumps/*.json | jq '.timetableRange' | jq '.[] | {start: .startTime, subject: .subject}'

# Count exams
cat debug_dumps/*.json | jq '.exams | length'

# Show all homework
cat debug_dumps/*.json | jq '.homeworks[] | {title, dueDate}'
```

### Integration with Development Workflow

```bash
# Watch for changes and re-test
while true; do
  clear
  npm run debug -- --action all
  sleep 5
done
```

---

## Support & Issues

### Reporting Issues

When reporting CLI issues, include:

1. Node.js version: `node --version`
2. npm version: `npm --version`
3. Full output with `--verbose`: `npm run debug -- --verbose 2>&1`
4. Config file (with credentials redacted)
5. Error message (first and last 20 lines)

### Testing Checklist

- [ ] Config file exists and is readable
- [ ] Credentials are correct in config
- [ ] `npm run debug -- --action auth` passes
- [ ] `npm run debug` fetches data successfully
- [ ] `npm run debug -- --dump` creates JSON file
- [ ] JSON dump contains expected student data

---

## See Also

- [Config Integration Details](cli/CONFIG_INTEGRATION.md)
- [Dump Feature Documentation](cli/DUMP_FEATURE.md)
- [Node Helper Implementation](node_helper.js)
- [MagicMirror Module Development](https://docs.magicmirror.builders/development/module-development.html)
