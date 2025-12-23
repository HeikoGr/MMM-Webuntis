# WebUntis CLI Tools

Command-line utilities for testing and debugging WebUntis API integration.

## Available Tools

### 0. Node Helper Wrapper: `node_helper_wrapper.js` ⭐

Production-like CLI interface for testing node_helper functions directly. **Config auto-loads by default.**

**Quick Start:**
```bash
# Show help
npm run debug -- --help

# Fetch all data for first student (config auto-loads)
npm run debug

# Fetch with verbose output
npm run debug -- --verbose

# Fetch for specific student
npm run debug -- --student 1

# Fetch and create debug dump
npm run debug -- --dump --verbose

# Test only authentication
npm run debug -- --action auth

# Use custom config file
npm run debug -- --config ./custom-config.js
```

**Features:**
- ✅ Config auto-loads - no command needed, just options
- ✅ Unified interface - no separate test-* or fetch-/dump- commands
- ✅ Optional dumping with `-d`/`--dump` flag
- ✅ Fast API testing without full MagicMirror startup
- ✅ Isolated REST API calls with real node_helper code
- ✅ Comprehensive error reporting
- ✅ Verbose debugging mode

**See also:** [CONFIG_INTEGRATION.md](CONFIG_INTEGRATION.md) | [NODE_HELPER_WRAPPER_REAL.md](NODE_HELPER_WRAPPER_REAL.md)

---

## Technical Details

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

### Configuration Requirements

`config/config.js` must include:
```javascript
{
  "module": "MMM-Webuntis",
  "config": {
    "school": "your-school",
    "server": "school.webuntis.com",
    "parentUsername": "parent@email.com",
    "parentPassword": "password",
    "students": [
      {
        "title": "Student Name",
        "studentId": <studentId>
      }
    ]
  }
}
```

---

## Privacy & Security

✓ Credentials never logged to console
✓ Tokens displayed with truncation (first/last 20 chars only)
✓ Email addresses anonymized (par***)
✓ No sensitive data stored in files
✓ All tests can use environment variables for credentials

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication fails | Check credentials in `config/config.js` |
| No timetable data | Verify studentId, check date range validity |
| Token expired | Auto-refreshed after 14 minutes, check system time |
| Connection error | Verify server address, check network connectivity |

---

## Development

To add new tests:
1. Update `test-webuntis-rest-api.js`
2. Add test function with clear documentation
3. Register in `runSpecificTest()`
4. Update this README
