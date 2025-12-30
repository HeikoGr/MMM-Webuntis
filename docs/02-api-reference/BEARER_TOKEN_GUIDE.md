# Bearer Token Authentication Guide

## Overview

WebUntis supports JWT Bearer token authentication in addition to traditional session cookies. This guide explains how to use Bearer tokens for REST API calls.

## Authentication Flow

### Step 1: JSON-RPC Login (Traditional)
```javascript
const response = await axios.post(
  'https://{server}/WebUntis/jsonrpc.do?school={school}',
  {
    jsonrpc: '2.0',
    method: 'authenticate',
    params: {
      user: '{username}',
      password: '{password}',
      client: 'App'
    },
    id: 1
  },
  {
    jar: cookieJar,  // Session cookies stored here
    validateStatus: () => true
  }
);
```

### Step 2: Get JWT Token
```javascript
const tokenResponse = await axios.get(
  'https://{server}/WebUntis/api/token/new',
  {
    jar: cookieJar,  // Requires valid session
    validateStatus: () => true
  }
);

const jwtToken = tokenResponse.data;  // Raw JWT string
```

### Step 3: Use Bearer Token for API Calls
```javascript
const client = axios.create({
  baseURL: 'https://{server}/WebUntis',
  headers: {
    'Authorization': 'Bearer ' + jwtToken,
    'Accept': 'application/json'
  }
});

// Now all requests include Bearer token
const exams = await client.get('/api/rest/view/v1/exams');
const messages = await client.get('/api/rest/view/v1/messages');
const appData = await client.get('/api/rest/view/v1/app/data');
```

## Complete Example

```javascript
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

async function getAppDataWithBearerToken() {
  // Create cookie jar for session management
  const cookieJar = new CookieJar();
  const client = wrapper(axios.create({
    baseURL: 'https://{SCHOOL_NAME}.webuntis.com/WebUntis',
    jar: cookieJar,
    withCredentials: true,
    validateStatus: () => true
  }));

  // 1. Authenticate
  await client.post('/jsonrpc.do?school={SCHOOL_NAME}', {
    jsonrpc: '2.0',
    method: 'authenticate',
    params: {
      user: '{username}',  // e.g., parent@example.com
      password: 'password123',
      client: 'App'
    },
    id: 1
  });

  // 2. Get JWT token
  const tokenResp = await client.get('/api/token/new');
  const token = tokenResp.data;

  // 3. Create Bearer-authenticated client
  const bearerClient = axios.create({
    baseURL: 'https://{SCHOOL_NAME}.webuntis.com/WebUntis',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/json'
    },
    validateStatus: () => true
  });

  // 4. Use Bearer-authenticated endpoints
  const exams = await bearerClient.get('/api/rest/view/v1/exams');
  const messages = await bearerClient.get('/api/rest/view/v1/messages');
  const appData = await bearerClient.get('/api/rest/view/v1/app/data');

  return { exams: exams.data, messages: messages.data, appData: appData.data };
}
```

## JWT Token Structure

Bearer tokens are RS256-signed JWT tokens with the following payload:

```json
{
  "tenant_id": {TENANT_ID},
  "sub": "username@example.com",
  "roles": "LEGAL_GUARDIAN",
  "iss": "webuntis",
  "locale": "de",
  "sc": "de",
  "user_type": "USER",
  "route": "niobe.internal.webuntis.com",
  "user_id": {USER_ID},
  "host": "{SCHOOL_NAME}.webuntis.com",
  "sn": "{SCHOOL_NAME}",
  "scopes": "mg:r",
  "exp": 1766084807,
  "per": ["mg:r"],
  "iat": 1766084130,
  "username": "username@example.com",
  "sr": "DE-BW",
  "person_id": {PERSON_ID}
}
```

### Key Fields

| Field | Meaning | Notes |
|-------|---------|-------|
| `user_id` | User ID | Different from person_id |
| `person_id` | Person ID | Use for student lookup |
| `username` | Login username | Full email for parent accounts |
| `roles` | User role | `LEGAL_GUARDIAN` for parents, `USER` for students |
| `exp` | Expiration (unix timestamp) | Token expires after ~15 minutes |
| `iat` | Issued at (unix timestamp) | When token was generated |
| `scopes` | API scopes | `mg:r` = read management |

## Bearer Token Endpoints

### Endpoints Supporting Bearer Tokens

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/rest/view/v1/exams` | GET | Get exams for authenticated user |
| `/api/rest/view/v1/messages` | GET | Get messages for authenticated user |
| `/api/rest/view/v1/app/data` | GET | Get system config and app data |

### Endpoints NOT Supporting Bearer Tokens

These endpoints **require session cookies** even though Bearer tokens are available:

| Endpoint | Method | Workaround |
|----------|--------|-----------|
| `/api/rest/view/v1/timetable/*` | GET | Use `/api/public/timetable/weekly/data` (cookie-based) |
| `/api/rest/view/v1/absences` | GET | Use `/api/classreg/absences/students` (cookie-based) |
| `/api/rest/view/v1/homeworks` | GET | Use `/api/homeworks/lessons` (cookie-based) |

## Token Validity and Caching

### Token Lifetime
- **Validity period:** ~15 minutes (900 seconds)
- **Expiration claim:** `exp` field contains unix timestamp
- **Check expiration:** `Math.floor(Date.now() / 1000) > token.exp`

### Token Caching Strategy

```javascript
class TokenCache {
  constructor() {
    this.token = null;
    this.expiresAt = 0;
  }

  isExpired() {
    return Math.floor(Date.now() / 1000) > this.expiresAt;
  }

  async getToken(client) {
    if (this.token && !this.isExpired()) {
      return this.token;  // Return cached token
    }

    // Generate new token
    const resp = await client.get('/api/token/new');
    this.token = resp.data;

    // Decode to get expiration
    const parts = this.token.split('.');
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64').toString()
    );
    this.expiresAt = payload.exp;

    return this.token;
  }
}
```

## Advantages and Limitations

### ✅ Advantages
- **Stateless authentication** - No session cookie jar needed
- **Mobile-friendly** - Better for native mobile apps
- **Explicit expiration** - Token expiration is clear in payload
- **Inspectable** - Can decode JWT to verify permissions

### ❌ Limitations
- **Short lifetime** - ~15 minutes requires frequent regeneration
- **Incomplete coverage** - Not all APIs support Bearer tokens
- **Cookie fallback needed** - Still need session cookies for some endpoints
- **Timetable unavailable** - No Bearer token endpoint for timetable data

## Recommendation for MMM-Webuntis

**Current recommendation:** Stick with session cookie authentication

**Why:**
1. All required APIs work with session cookies
2. Session persists longer than Bearer tokens
3. No need to implement token caching logic
4. Bearer endpoints add complexity without benefit
5. Timetable API (critical feature) requires cookies anyway

**Future consideration:** Implement Bearer token caching if:
- Module needs to support stateless operation
- Performance becomes critical
- Multi-instance deployments require shared state

## Testing Bearer Tokens

```bash
# Get token
TOKEN=$(curl -s -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"authenticate","params":{"user":"user@email.com","password":"pass","client":"App"},"id":1}' \
  https://server.webuntis.com/WebUntis/jsonrpc.do?school=schoolname \
  | jq -r '.result.sessionId')

# The above gives session ID, to get JWT:
curl -H "Cookie: JSESSIONID=$JSESSIONID" \
  https://server.webuntis.com/WebUntis/api/token/new

# Use token
curl -H "Authorization: Bearer $TOKEN" \
  https://server.webuntis.com/WebUntis/api/rest/view/v1/exams
```

## References

- API_DISCOVERY.md - Full endpoint documentation
- API_IMPLEMENTATION.md - Code examples for all endpoints
- Token field reference: JWT.io can decode tokens for inspection
