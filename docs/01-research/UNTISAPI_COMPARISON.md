# UntisApi Comparison & Learning Points

**Source**: https://github.com/justusbruegmann/UntisApi

## Project Comparison

### UntisApi vs MMM-Webuntis

| Aspect | UntisApi | MMM-Webuntis (Ours) |
|--------|----------|-------------------|
| **Purpose** | Standalone REST API wrapper | MagicMirror² module |
| **Authentication** | Puppeteer (browser automation) | webuntis.js library + REST API |
| **Session Handling** | Manual cookie extraction via CDP | Session management via fetchClient + CookieJar |
| **API Approach** | Direct HTTP to WebUntis endpoints | Library wrapper + REST API discovery |
| **Parent Support** | Yes (handles parent login) | **NEW: REST APIs now support parent accounts** ✅ |
| **Architecture** | Express.js API server | Node.js helper + frontend module |
| **Caching** | No caching visible | Widget-based memory caching |
| **Testing** | Jest unit tests | CLI test suite + API discovery tools |

---

## Key Learnings from UntisApi

### 1. **Authentication Insights**

**UntisApi Approach (Puppeteer):**
```javascript
// Uses headless browser for login
// Extracts cookies via Chrome DevTools Protocol (CDP)
// Gets non-HTTP cookies like 'traceId'
// Also retrieves bearer token from localStorage
```

**Our Approach (Recommended):**
✅ REST API based authentication is superior:
- No browser simulation needed
- Direct JSON-RPC login returns session cookies
- Session automatically managed by CookieJar (custom implementation)
- More reliable and lighter weight

### 2. **API Endpoints Discovery**

UntisApi demonstrates these working endpoints:
```
POST   /login/login                           (authentication)
GET    /api/classreg/absences/students        (absences - matches ours ✓)
GET    /api/homeworks/lessons                 (homework - matches ours ✓)
GET    /api/public/timetable/weekly/data      (NEW: weekly timetable format)
GET    /api/rest/view/v1/messages             (messages - we found 404 ✓)
GET    /api/rest/view/v1/app/data             (app data - we found 404 ✓)
```

**New Finding**: They use `/api/public/timetable/weekly/data` for timetables!

### 3. **Cookie & Token Management**

UntisApi extracts 3 critical components:
```javascript
{
  JSESSIONID: "...",        // Session ID
  schoolname: "...",        // School identifier  
  traceId: "..."            // Request tracing (CDP extraction needed)
}
```

**Our Implementation**: 
✅ CookieJar (custom implementation) automatically handles JSESSIONID and schoolname
⚠️ We don't track traceId (but it may not be required for REST APIs)

### 4. **User-Agent Spoofing**

UntisApi uses User-Agent header for timetable endpoint:
```javascript
headers: {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...'
}
```

**Our Approach**: 
✅ fetchClient uses standard Node.js fetch user agent
- REST APIs seem to accept both
- May need to add if timetable endpoint requires it

### 5. **Bearer Token Usage**

UntisApi extracts bearer token from `localStorage`:
- Used for newer REST APIs (messages, app data)
- Stored after login

**Our Approach**:
✅ JWT token API available (`/api/token/new`)
- Can retrieve JWT after session established
- More modern approach than localStorage

### 6. **Parameter Formats**

**Date Formats Used**:
- UntisApi: Both `YYYYMMDD` and `YYYY-MM-DD`
- Our discovery: Mostly `YYYYMMDD`

**Query Parameters**:
- UntisApi: `elementType` (2=class, 5=student), `elementId`
- Our approach: `studentId` directly

---

## Enhanced Endpoints (New Discoveries)

### Timetable Weekly Format ⭐ INTERESTING

**UntisApi uses:**
```
GET /api/public/timetable/weekly/data
Parameters:
  elementType=5        (student)
  elementId={studentId}
  date=YYYY-MM-DD
  formatId=0
```

**We tested** `/api/rest/view/v1/timetable/entries` and got 404.

**Action Item**: Test `/api/public/timetable/weekly/data` endpoint in our discovery tools!

---

## Architecture Recommendations

### Keep Our Approach ✅

**Why REST API + Session Management is better than Puppeteer:**

1. **Performance**
   - No browser overhead (Puppeteer = 100+ MB memory)
   - Direct HTTP calls are 10x faster
   - Lower CPU usage

2. **Reliability**
   - Browser automation fragile to UI changes
   - WebUntis updates break Puppeteer scripts
   - REST APIs more stable

3. **Parent Account Support**
   - Puppeteer method works for both
   - Our REST API method works better (no screen-based auth)

4. **Simplicity**
   - No external dependencies (Puppeteer)
   - Plain HTTP is easier to debug
   - Session cookies automatic via CookieJar (custom implementation)

---

## Missing from Both Projects

### Cookie.jar vs Manual Cookie Handling

**UntisApi Problem**: Manually constructs cookie strings
```javascript
// Error-prone, must format: "JSESSIONID=x;schoolname=y;traceId=z;"
makeCookiesString(cookies) { ... }
```

**Our Solution**: ✅ CookieJar (custom implementation) handles this automatically
```javascript
const cookieJar = new CookieJar();
// Cookies stored and sent automatically
```

---

## Testing Strategy

**UntisApi uses**: Jest with unit tests for each service

**We should add**: Jest integration tests for REST APIs
- Test session management
- Test parameter variations
- Test error cases
- Test multiple students

---

## Potential Enhancements for MMM-Webuntis

### 1. Test the weekly timetable endpoint

```javascript
// Add to api-test.js or api-discover.js
GET /api/public/timetable/weekly/data?elementType=5&elementId={studentId}&date=2025-12-18&formatId=0
```

### 2. Add User-Agent header to requests

```javascript
const client = wrapper(
  fetchClient with options {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  })
);
```

### 3. Implement JWT token caching

```javascript
// Store token after /api/token/new
// Refresh before expiration
// Use for Bearer authentication if needed
```

### 4. Add element type handling

```javascript
const elementTypes = {
  CLASS: 2,
  STUDENT: 5,
  ROOM: 15,
  TEACHER: 25
};
```

---

## API Endpoint Matrix

### Status of All Known Endpoints

| Endpoint | Purpose | Status | Auth | Notes |
|----------|---------|--------|------|-------|
| `/api/classreg/absences/students` | Absences | ✅ Working | Cookie | Tested both projects |
| `/api/homeworks/lessons` | Homework | ✅ Working | Cookie | Tested both projects |
| `/api/exams` | Exams | ✅ Working | Cookie | Our discovery |
| `/api/classreg/classservices` | Class roles | ✅ Working | Cookie | Our discovery |
| `/api/rest/view/v1/timetable/entries` | Timetable | ❌ 404 | Cookie | We tested, got 404 |
| `/api/public/timetable/weekly/data` | Timetable (weekly) | ❓ Unknown | Cookie | UntisApi tested - worth trying! |
| `/api/rest/view/v1/messages` | Messages | ❌ 404 | Bearer | We tested, got 404 |
| `/api/token/new` | JWT Token | ✅ Working | Cookie | Our discovery |
| `/environment.json` | Config | ✅ Working | None | Public, our discovery |
| `/api/help/helpmapping` | Help docs | ✅ Working | Cookie | Our discovery |

---

## Recommendation

**Our approach is superior** because:
1. REST APIs provide direct access without browser automation
2. Session management via CookieJar (custom implementation) is robust
3. Parent account support works seamlessly
4. No heavy Puppeteer dependency
5. Easier to test and debug

**Action Items**:
1. ⭐ Test `/api/public/timetable/weekly/data` endpoint
2. Add User-Agent header to all requests
3. Implement proper error handling for 404 endpoints
4. Add Jest integration tests
5. Document parent account workflows

---

## Reference

- **UntisApi**: https://github.com/justusbruegmann/UntisApi
- **Our REST API Documentation**: See API_DISCOVERY.md
- **Our Test Suite**: api-test.js and api-discover.js

