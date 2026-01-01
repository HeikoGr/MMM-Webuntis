# QR Code Authentication & REST API Access

## Overview

This document explains how WebUntis QR code authentication works and how it can be used to access REST API endpoints.

## Problem Statement

### Current State
- **Students** authenticate via QR codes in the WebUntis mobile app ✅
- **Web UI** does not accept QR code credentials ❌
- **Parents** can use username/password for REST API access ✅
- **MMM-Webuntis** currently supports:
  - Parent accounts (username/password) ✅
  - Explicit credentials (school/username/password) ✅
  - Parent QR codes (via WebUntisQR library) ⚠️ (limited)

### Desired State
- Support **student QR codes** for direct REST API access
- Allow students to configure their own credentials
- Extend MMM-Webuntis to work with student accounts

---

## Technical Deep Dive

### QR Code Structure

A WebUntis QR code contains:
```
untis://setschool?school=SCHOOL_NAME&user=USERNAME&url=SERVER_URL&key=API_KEY
```

**Parameters:**
| Parameter | Purpose | Example |
|-----------|---------|---------|
| `school` | School identifier | `gymnasium-hamburg` |
| `user` | Student/User ID or username | `student123` |
| `url` | WebUntis server hostname | `hamburg.webuntis.com` |
| `key` | API key (cryptographic) | Base64-encoded RSA encrypted key |

### Authentication Flow: QR Code → REST API

```
┌─────────────────────┐
│  QR Code String     │
│ untis://setschool?..│
└──────────┬──────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  Parse URL Parameters                │
│  - Extract: school, user, url, key   │
└──────────┬─────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────┐
│  JSON-RPC Authentication                        │
│  POST /WebUntis/jsonrpc.do?school=<school>      │
│  {                                               │
│    "jsonrpc": "2.0",                            │
│    "method": "authenticate",                    │
│    "params": {                                  │
│      "user": "<user_from_qr>",                  │
│      "password": "<key_from_qr>",               │
│      "client": "MyApp"                          │
│    }                                            │
│  }                                              │
└──────────┬────────────────────────────────────────┘
           │
           ▼ (Session cookies set)
┌──────────────────────────────────────┐
│  Obtain Bearer Token                 │
│  GET /WebUntis/api/token/new         │
│  Header: Cookie: JSESSIONID=...      │
└──────────┬──────────────────────────────┘
           │
           ▼ (JWT Bearer token)
┌──────────────────────────────────────────┐
│  REST API Calls                        │
│  Authorization: Bearer <jwt_token>     │
│  GET /api/rest/view/v1/app/data        │
│  GET /api/rest/view/v1/timetable/...   │
│  GET /api/rest/view/v1/exams           │
│  etc.                                  │
└────────────────────────────────────────┘
```

---

## Implementation: QR Code Login

### Using WebUntisQR Library (High-Level)

```javascript
const { WebUntisQR } = require('webuntis');
const Authenticator = require('otplib').authenticator;
const { URL } = require('url');

const qrcode = 'untis://setschool?school=...&user=...&url=...&key=...';

// Create client
const client = new WebUntisQR(
  qrcode,
  'my-app-name',
  Authenticator,
  URL
);

// Login
await client.login();

// Get data
const timetable = await client.getOwnTimetableForRange(
  new Date('2025-12-22'),
  new Date('2025-12-28')
);
```

### Manual Implementation (for REST API tokens)

```javascript

const { CookieJar } = require('tough-cookie');

const { URL } = require('url');

// 1. Parse QR code
const qrUrl = new URL('untis://setschool?...');
const school = qrUrl.searchParams.get('school');
const user = qrUrl.searchParams.get('user');
const url = qrUrl.searchParams.get('url');
const key = qrUrl.searchParams.get('key');

// 2. Create axios client with cookie jar
const cookieJar = new CookieJar();
const client = wrapper(
  fetchClient with options {
    baseURL: `https://${url}`,
    jar: cookieJar,
    withCredentials: true,
  })
);

// 3. JSON-RPC Login
const authResp = await client.post(
  `/WebUntis/jsonrpc.do?school=${encodeURIComponent(school)}`,
  {
    jsonrpc: '2.0',
    method: 'authenticate',
    params: {
      user,
      password: key,  // Use QR key as password
      client: 'MyApp'
    },
    id: 1
  }
);

if (authResp.data.error) {
  throw new Error(`Auth failed: ${authResp.data.error.message}`);
}

// 4. Get Bearer Token
const tokenResp = await client.get('/WebUntis/api/token/new');
const bearerToken = tokenResp.data;

// 5. Create REST API client
const restClient = fetchClient with options {
  baseURL: `https://${url}/WebUntis`,
  headers: {
    Authorization: `Bearer ${bearerToken}`,
    Accept: 'application/json'
  }
});

// 6. Use REST API
const appData = await restClient.get('/api/rest/view/v1/app/data');
```

---

## Key Differences: QR Code vs. Parent Account

| Aspect | QR Code (Student) | Parent Account |
|--------|-------------------|----------------|
| **Credentials** | School, User, URL, Key | Username, Password |
| **Client Library** | WebUntisQR | WebUntis |
| **JWT Role** | USER | LEGAL_GUARDIAN |
| **Data Access** | Own timetable, own data | Children's data via studentId |
| **Scope** | Limited to self | Broader (multiple children) |
| **Token Validity** | 15 minutes | 15 minutes |
| **Web UI Support** | ❌ No | ✅ Yes |

### JWT Token Comparison

**QR Code (Student):**
```json
{
  "user_type": "USER",
  "username": "student123",
  "user_id": 5678,
  "roles": "USER"
}
```

**Parent Account:**
```json
{
  "user_type": "USER",
  "username": "parent@example.com",
  "user_id": 9012,
  "roles": "LEGAL_GUARDIAN",
  "scopes": "mg:r"
}
```

---

## REST API Endpoints Available

Once authenticated with a bearer token, the following endpoints are available:

### Universal Endpoints (All Users)
```
GET  /api/timegrid                           - School time grid
GET  /api/holidays                           - School holidays
GET  /api/rest/view/v1/app/data              - User data, school year, etc.
GET  /api/rest/view/v1/lessons               - Lessons (own)
```

### Student/Own Data
```
GET  /api/rest/view/v1/lessons               - Own timetable
GET  /api/rest/view/v1/exams                 - Own exams
GET  /api/homeworks/lessons                  - Own homework
```

### Parent-Only Endpoints
```
GET  /api/rest/view/v1/students/{id}/timetable      - Specific student timetable
GET  /api/classreg/absences/students                - Student absences
```

---

## Testing: How to Verify QR Code Authentication

### Option 1: Using CLI Test Suite

```bash
# Test 1: Parse QR code and check WebUntisQR login
WEBUNTIS_QRCODE="untis://..." node cli/test-qrcode-rest-api.js

# Test 2: Full flow - QR code to REST API bearer token
WEBUNTIS_QRCODE="untis://..." node cli/test-qrcode-json-rpc-bearer-token.js
```

### Option 2: Manual Testing

```javascript
// Extract and test
const { URL } = require('url');
const qrcode = process.env.WEBUNTIS_QRCODE;

const qrUrl = new URL(qrcode);
console.log('School:', qrUrl.searchParams.get('school'));
console.log('User:', qrUrl.searchParams.get('user'));
console.log('URL:', qrUrl.searchParams.get('url'));
console.log('Key:', qrUrl.searchParams.get('key')?.substring(0, 20) + '...');
```

---

## Limitations & Considerations

### ✅ Advantages of QR Code Auth
- No need to store passwords
- Direct student authentication (no parent intermediary)
- Works with existing webuntis infrastructure
- Compatible with JSON-RPC and REST APIs

### ⚠️ Limitations
- QR codes may expire (typically after 30 days or on password change)
- Limited to reading own data (cannot see siblings/classmates)
- REST endpoints may vary by server version
- Key parameter is cryptographically signed (cannot be modified)

### 🔐 Security Notes
- QR codes contain sensitive credentials - treat like passwords
- Bearer tokens are short-lived (15 minutes)
- Always use HTTPS for API calls
- Consider environment variables instead of config files for credentials

---

## Extending MMM-Webuntis for QR Code Support

### Proposed Configuration Extension

```javascript
{
  module: 'MMM-Webuntis',
  config: {
    // Existing parent account support
    parentUsername: 'parent@example.com',
    parentPassword: 'password',

    // New: Student QR code support
    students: [
      {
        title: 'Alice (Parent View)',
        // Parent account can see child data
        parentMode: true,
        studentId: 123
      },
      {
        title: 'Bob (Student)',
        // Student can see own data via QR
        qrcode: 'untis://setschool?...',
        // OR explicit credentials
        school: 'example',
        username: 'student123',
        password: 'api_key_from_qr'
      }
    ]
  }
}
```

### Implementation Steps

1. **Extend student config validation** to accept `qrcode` field
2. **Modify client creation** in `node_helper.js` to handle QR codes
3. **Add bearer token extraction** for QR-authenticated sessions
4. **Map student endpoints** (no studentId parameter needed)
5. **Update documentation** with QR code examples

---

## References

- [WebUntis npm package](https://www.npmjs.com/package/webuntis)
- [Bearer Token Guide](./02-api-reference/BEARER_TOKEN_GUIDE.md)
- [REST API Overview](./02-api-reference/REST_ENDPOINTS_OVERVIEW.md)
- [CLI Test Tools](../cli/README.md)

---

## See Also

- [test-qrcode-rest-api.js](../cli/test-qrcode-rest-api.js) - Comprehensive QR code tests
- [test-qrcode-json-rpc-bearer-token.js](../cli/test-qrcode-json-rpc-bearer-token.js) - Full authentication flow
- [BEARER_TOKEN_GUIDE.md](./02-api-reference/BEARER_TOKEN_GUIDE.md) - Token authentication details
