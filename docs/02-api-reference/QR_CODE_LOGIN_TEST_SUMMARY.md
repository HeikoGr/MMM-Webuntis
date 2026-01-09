# QR Code Login Testing - Summary

> **Note:** This document describes the research and testing that led to the current QR code implementation. QR code authentication is now **fully implemented** in MMM-Webuntis via `lib/httpClient.js` and `lib/authService.js`. This document is kept for historical reference.

## Problem
Student QR codes work in the WebUntis mobile app but not in the web UI. The question is: **Can we use QR code credentials to get REST API access?**

## Solution Built (Historical - Now Implemented)

This research led to the implementation now in `lib/httpClient.js` (`authenticateWithQRCode()`) and `lib/authService.js` (`getAuthFromQRCode()`).

The original test suites were in the `cli/` folder:

### 1. `test-qrcode-rest-api.js` (Historical)
**Comprehensive QR Code Testing Suite**

Tests multiple aspects of QR code authentication:
- ✅ QR code parsing and parameter extraction
- ✅ WebUntisQR library login flow
- ✅ Bearer token availability and exposure
- ✅ Direct REST API access with QR credentials
- ✅ Network call monitoring and analysis

**Usage:**
```bash
WEBUNTIS_QRCODE="untis://setschool?school=...&user=...&url=...&key=..." \
node cli/test-qrcode-rest-api.js
```

### 2. `test-qrcode-json-rpc-bearer-token.js`
**End-to-End Authentication Flow Test**

Shows how to convert QR code credentials → REST API bearer tokens:

**Step-by-step flow:**
1. Parse QR code to extract school, user, URL, and key
2. Authenticate via JSON-RPC using key as password
3. Obtain bearer token via `/api/token/new`
4. Test REST API endpoints (app/data, timegrid, holidays)
5. Decode JWT to show user role and token expiration

**Usage:**
```bash
WEBUNTIS_QRCODE="untis://setschool?school=...&user=...&url=...&key=..." \
node cli/test-qrcode-json-rpc-bearer-token.js
```

**Success Output:**
```
🎉 SUCCESS! QR code authentication works end-to-end:
  1. QR code can be parsed to extract credentials
  2. JSON-RPC login works with QR credentials
  3. Bearer token can be obtained after JSON-RPC login
  4. REST API is accessible with the bearer token

IMPLICATION: We can extend MMM-Webuntis to support student QR codes!
```

## Documentation Added

### 1. `docs/02-api-reference/QR_CODE_REST_API.md`
**Comprehensive technical documentation** covering:
- Problem statement (current limitations)
- QR code structure and parameters
- Authentication flow diagram (QR → REST API)
- Implementation examples (WebUntisQR library and manual)
- Key differences between QR code and parent authentication
- Available REST API endpoints
- Testing procedures
- Proposed config extensions for MMM-Webuntis
- Security considerations

### 2. Updated `cli/README.md`
Added detailed documentation for:
- `test-qrcode-rest-api.js` - what it tests, usage, findings
- `test-qrcode-json-rpc-bearer-token.js` - end-to-end flow, example output
- Implications for extending MMM-Webuntis to support student QR codes

## Key Findings

✅ **YES - QR codes CAN be used for REST API access!**

The authentication flow works:
```
QR Code Parameters
    ↓
JSON-RPC Login (using key as password)
    ↓
Session Cookies
    ↓
Get Bearer Token via /api/token/new
    ↓
REST API Calls (with Bearer Token + Cookies)
```

## How to Test

### Option 1: Full End-to-End Test
```bash
cd /opt/magic_mirror/modules/MMM-Webuntis
WEBUNTIS_QRCODE="your_qr_code_here" node cli/test-qrcode-json-rpc-bearer-token.js
```

This will:
1. Parse your QR code
2. Authenticate via JSON-RPC
3. Get a bearer token
4. Test 3 REST API endpoints
5. Show you exactly what works and what doesn't

### Option 2: Detailed Analysis
```bash
WEBUNTIS_QRCODE="your_qr_code_here" node cli/test-qrcode-rest-api.js
```

This will:
1. Test QR code parsing
2. Test WebUntisQR library login
3. Monitor network calls
4. Analyze authentication mechanisms
5. Provide detailed technical feedback

### Option 3: Read the Documentation
```bash
cat docs/02-api-reference/QR_CODE_REST_API.md
```

## Implementation Status

✅ **QR code authentication is fully implemented** in:
- `lib/httpClient.js` - `authenticateWithQRCode()` method
- `lib/authService.js` - `getAuthFromQRCode()` method
- `node_helper.js` - Automatic QR code detection and handling

To use QR codes in your configuration, simply add:
```javascript
students: [
  {
    title: "Student Name",
    qrcode: "untis://setschool?url=...&school=...&user=...&key=..."
  }
]
```

## Next Steps (Historical - Already Completed)

~~If you want to extend MMM-Webuntis to support student QR codes:~~

1. ✅ **DONE:** Updated student config schema to accept `qrcode` field
2. ✅ **DONE:** Modified `node_helper.js` to detect QR code credentials and use REST API flow
3. ✅ **DONE:** Automatically refreshes bearer tokens (14-min cache with 1-min buffer)
4. ✅ **DONE:** Updated documentation with QR code examples
5. ✅ **DONE:** Added config validation for QR code format

## Files Added/Modified

### New Files
- ✅ `cli/test-qrcode-rest-api.js` - QR code testing suite
- ✅ `cli/test-qrcode-json-rpc-bearer-token.js` - End-to-end auth flow test
- ✅ `docs/02-api-reference/QR_CODE_REST_API.md` - Technical documentation

### Modified Files
- ✅ `cli/README.md` - Added test documentation

## Technical Notes

- WebUntisQR library works but doesn't expose bearer tokens directly
- The key parameter from the QR code is treated as a password in JSON-RPC auth
- Bearer tokens are JWT with 15-minute expiration
- Both session cookies AND bearer token are needed for REST API reliability
- REST API endpoints vary by server version - test endpoints may not all work

## Security Reminders

⚠️ **Important:**
- QR codes contain sensitive credentials - treat them like passwords
- Never commit QR codes to version control
- Always use environment variables for sensitive data
- Use HTTPS exclusively for API calls
- Regenerate QR codes regularly (typically expires after 30 days)

---

**Status:** Ready for integration testing with real WebUntis credentials
