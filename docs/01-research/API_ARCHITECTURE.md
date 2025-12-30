# WebUntis API Architecture Summary

**Last Updated:** December 18, 2025
**Status:** Complete API ecosystem mapped and documented

## Quick Reference

### Available APIs by Category

#### 📚 **Timetable / Scheduling**
| API | Method | Type | Auth | Status | Notes |
|-----|--------|------|------|--------|-------|
| `/api/public/timetable/weekly/data` | GET | REST | Cookies | ✅ 200 | Weekly timetable, parent accounts |
| `/api/timegrid` | GET | REST | Cookies | ✅ 200 | School hour structure |
| `getTimetableForRange()` | - | JSON-RPC | - | ✅ Works | Student ID required |
| `getOwnTimetableForRange()` | - | JSON-RPC | - | ✅ Works | Own timetable only |
| `getOwnClassTimetableForRange()` | - | JSON-RPC | - | ✅ Works | Class timetable only |

#### 📋 **Absences / Attendance**
| API | Method | Type | Auth | Status | Notes |
|-----|--------|------|------|--------|-------|
| `/api/classreg/absences/students` | GET | REST | Cookies | ✅ 200 | Parent account support |
| `/api/classreg/absences/meta` | GET | REST | Cookies | ✅ 200 | Absence metadata |
| `getAbsentLesson()` | - | JSON-RPC | - | ⚠️ Limited | Student ID not supported |

#### 📝 **Homework**
| API | Method | Type | Auth | Status | Notes |
|-----|--------|------|------|--------|-------|
| `/api/homeworks/lessons` | GET | REST | Cookies | ✅ 200 | All homework |
| `getHomeWorksFor()` | - | JSON-RPC | - | ✅ Works | Alternative |
| `getHomeWorkAndLessons()` | - | JSON-RPC | - | ✅ Works | Alternative |

#### 📌 **Exams**
| API | Method | Type | Auth | Status | Notes |
|-----|--------|------|------|--------|-------|
| `/api/exams` | GET | REST | Cookies | ✅ 200 | All exams |
| `/api/rest/view/v1/exams` | GET | REST | Bearer | ✅ 200 | Alternative endpoint |
| `getExamsForRange()` | - | JSON-RPC | - | ✅ Works | Date range support |

#### 💬 **Messages**
| API | Method | Type | Auth | Status | Notes |
|-----|--------|------|------|--------|-------|
| `/api/rest/view/v1/messages` | GET | REST | Bearer | ✅ 200 | REST view endpoint |
| `getMessagesOfDay()` | - | JSON-RPC | - | ✅ Works | JSON-RPC alternative |

#### ⚙️ **System / Configuration**
| API | Method | Type | Auth | Status | Notes |
|-----|--------|------|------|--------|-------|
| `/api/token/new` | GET | REST | Cookies | ✅ 200 | JWT token generation |
| `/api/rest/view/v1/app/data` | GET | REST | Bearer | ✅ 200 | App initialization data |
| `/environment.json` | GET | REST | None | ✅ 200 | Service URLs (public) |
| `/api/help/helpmapping` | GET | REST | Cookies | ✅ 200 | Help documentation mapping |

---

## Authentication Methods

### 1. Session Cookies (Traditional)

**Pros:**
- Simplest to use
- Works with all cookie-based APIs
- Long session lifetime
- No token management needed

**Cons:**
- Stateful
- Not suitable for distributed systems

**Implementation:**
```javascript
// 1. POST JSON-RPC authenticate
// 2. Session cookies automatically stored
// 3. Use cookies for all REST API calls
```

**Supported APIs:**
- All `/api/public/*` endpoints
- All `/api/classreg/*` endpoints
- All `/api/homeworks/*` endpoints
- All `/api/exams` endpoints
- `/api/timegrid`
- `/api/help/helpmapping`

### 2. Bearer Tokens (JWT)

**Pros:**
- Stateless authentication
- Modern, standard approach
- Suitable for mobile/distributed apps

**Cons:**
- Short lifetime (~15 minutes)
- Limited API coverage
- Requires token regeneration logic

**Implementation:**
```javascript
// 1. POST JSON-RPC authenticate (get session)
// 2. GET /api/token/new (get JWT)
// 3. Use JWT in Authorization: Bearer header
```

**Supported APIs:**
- `/api/rest/view/v1/exams`
- `/api/rest/view/v1/messages`
- `/api/rest/view/v1/app/data`

---

## API Coverage by Use Case

### Use Case: Parent Account Monitoring

**Requirement:** Monitor multiple students' timetables, absences, exams, homework

**Recommended Stack:**

1. **Authentication:**
   - Use parent account credentials
   - Session-based (cookies)

2. **Data Fetching:**
   - Timetable: `/api/public/timetable/weekly/data` ✅
   - Absences: `/api/classreg/absences/students` ✅
   - Exams: `/api/exams` ✅
   - Homework: `/api/homeworks/lessons` ✅
   - Messages: JSON-RPC `getMessagesOfDay()` ✅

3. **Status:**
   - Fully supported via REST APIs
   - No JSON-RPC fallback needed
   - Parent account verified ✅

### Use Case: Student Account Access

**Requirement:** Student views own data

**Recommended Stack:**

1. **Authentication:**
   - Student credentials OR QR-code
   - Session-based (cookies)

2. **Data Fetching:**
   - Timetable: `/api/public/timetable/weekly/data` OR `getOwnTimetableForRange()` ✅
   - Absences: JSON-RPC `getAbsentLesson()` ✅
   - Exams: `/api/exams` ✅
   - Homework: `/api/homeworks/lessons` ✅
   - Messages: JSON-RPC `getMessagesOfDay()` ✅

3. **Status:**
   - Mostly REST APIs with JSON-RPC fallback
   - Full functionality supported ✅

---

## Migration Path: JSON-RPC → REST

| Feature | JSON-RPC | REST API | Priority |
|---------|----------|----------|----------|
| Timetable (studentId) | `getTimetableForRange()` | `/api/public/timetable/weekly/data` | ⭐⭐⭐ |
| Timetable (own) | `getOwnTimetableForRange()` | ❌ Not available | ⭐⭐ |
| Absences | `getAbsentLesson()` | `/api/classreg/absences/students` | ⭐⭐⭐ |
| Exams | `getExamsForRange()` | `/api/exams` | ⭐⭐⭐ |
| Homework | `getHomeWorksFor()` | `/api/homeworks/lessons` | ⭐⭐⭐ |
| Messages | `getMessagesOfDay()` | `/api/rest/view/v1/messages` | ⭐⭐ |
| Timegrid | `getTimegrid()` | `/api/timegrid` | ⭐ |

---

## Known Limitations

### 1. Timetable API
- ❌ No REST API for own timetable (`getOwnTimetableForRange()`)
- ❌ No REST API for class timetable (`getOwnClassTimetableForRange()`)
- ✅ REST API available for student timetable (with studentId)
- ✅ Weekly format available at `/api/public/timetable/weekly/data`

**Workaround:** Keep JSON-RPC calls for own/class timetables

### 2. Bearer Token Coverage
- ⚠️ Limited to exams, messages, app data
- ⚠️ No timetable endpoint with Bearer auth
- ⚠️ No absences endpoint with Bearer auth
- ⚠️ Token lifetime only ~15 minutes

**Workaround:** Use session cookies for primary APIs

### 3. Parent Account Restrictions
- ✅ Can access student data via `/api/public/timetable/weekly/data`
- ✅ Can access absences via `/api/classreg/absences/students`
- ✅ Can access exams, homework, messages
- ❌ Cannot use JSON-RPC `getAbsentLesson()` (requires student ID workaround in code)

---

## Testing and Validation

### Available Tools

1. **api-test.js** - Comprehensive testing suite
   - 11 different test modes
   - Tests all endpoints
   - Usage: `node cli/api-test.js config/config.js [test-name]`

2. **api-discover.js** - Discovery and analysis
   - 6 discovery modes
   - Parameter variations
   - Endpoint scanning
   - Usage: `node cli/api-discover.js config/config.js [mode]`

3. **node_helper_wrapper.js** - CLI tool for testing configuration and data fetching
   - Test credentials
   - List students
   - Validate setup

### Validation Checklist

- [ ] Test absences with parent account
- [ ] Test timetable weekly format
- [ ] Test exams access
- [ ] Test homework access
- [ ] Test message retrieval
- [ ] Verify student ID mapping
- [ ] Check date range handling
- [ ] Validate token generation

---

## Future Enhancements

### Possible Improvements

1. **JWT Token Caching**
   - Cache tokens until expiration
   - Reduce `/api/token/new` calls
   - Better for distributed systems

2. **Additional Bearer Endpoints**
   - Monitor if WebUntis adds more Bearer endpoints
   - Could eventually replace cookie-based auth

3. **Multi-Student Batching**
   - Batch requests for multiple students
   - Reduce API call count
   - Improve performance

4. **Webhook Support**
   - If WebUntis implements webhooks
   - Real-time update notifications
   - Replace polling approach

---

## References

- **API_DISCOVERY.md** - Full endpoint documentation with examples
- **API_IMPLEMENTATION.md** - Ready-to-use code examples
- **BEARER_TOKEN_GUIDE.md** - Bearer token authentication guide
- **UNTISAPI_COMPARISON.md** - External project analysis
- **cli/README.md** - CLI tool documentation
