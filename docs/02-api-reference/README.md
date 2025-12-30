# API Reference

**Complete technical reference of all WebUntis API endpoints and responses.**

This directory is intentionally focused on *reference docs*.
For a minimal end-to-end implementation (working code + pitfalls), start here:
- [IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)

## 📖 In This Directory

### REST_ENDPOINTS_OVERVIEW.md
**Quick reference of all REST API endpoints.**

Contains:
- ✅ All 8+ REST endpoints with URLs
- ✅ HTTP method (GET/POST)
- ✅ Required parameters
- ✅ Response format examples
- ✅ Success/error status codes
- ✅ Quick comparison table

**Use this:** When you need to know what endpoints exist and their basic usage.

### BEARER_TOKEN_GUIDE.md
**Complete authentication and token generation guide.**

Contains:
- ✅ Step-by-step authentication flow
- ✅ JSON-RPC login process
- ✅ Cookie extraction & management
- ✅ Bearer token request & response
- ✅ Token refresh logic (900 second lifetime)
- ✅ Session management
- ✅ Error handling
- ✅ Code examples for each step

**Use this:** When you're stuck on authentication or need to understand the token flow.

### APP_DATA_ANALYSIS.md
**Complete response structures and data analysis.**

Contains:
- ✅ Response structures for all endpoints
- ✅ Field-by-field explanation of data
- ✅ Real response examples (anonymized)
- ✅ Data types and formats
- ✅ How to parse responses
- ✅ Field transformations (position1/2/3)
- ✅ Parent account response differences
- ✅ Performance characteristics

**Use this:** When you need to understand what data each API returns and how to parse it.

### HOMEWORK_API_DETAILS.md ⭐ NEW
**Deep dive into Homework REST API with parallel array structure.**

Contains:
- ✅ Endpoint: `/WebUntis/api/homeworks/lessons`
- ✅ Response structure: Parallel arrays (`homeworks[]`, `lessons[]`)
- ✅ Join logic: `homework.lessonId` → `lesson.id`
- ✅ Subject extraction (subject field vs su array)
- ✅ Parent account support ✅
- ✅ HTML sanitization strategy
- ✅ Date/time normalization
- ✅ Deduplication logic
- ✅ Known limitations & workarounds

**Use this:** When implementing or debugging homework retrieval for parent accounts.

### ABSENCES_API_DETAILS.md ⭐ NEW
**Deep dive into Absences REST API with parent account support.**

Contains:
- ✅ Endpoint: `/WebUntis/api/classreg/absences/students`
- ✅ Response structure and field meanings
- ✅ Parent account access via `studentId` parameter
- ✅ Excuse status codes (unexcused/excused/pending)
- ✅ Time conversion (minutes → HHMM format)
- ✅ HTML sanitization
- ✅ Error handling & status codes
- ✅ Testing commands

**Use this:** When implementing or debugging absences retrieval for parent accounts.

## 🎯 Common Tasks (canonical docs)

- **I need working code quickly** → [IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)
- **I need authentication details (cookies + token + refresh)** → [BEARER_TOKEN_GUIDE.md](BEARER_TOKEN_GUIDE.md)
- **I need endpoint mapping** → [REST_ENDPOINTS_OVERVIEW.md](REST_ENDPOINTS_OVERVIEW.md)
- **I need response structures / field meanings** → [APP_DATA_ANALYSIS.md](APP_DATA_ANALYSIS.md)
- **I need homework API details (parallel arrays)** → [HOMEWORK_API_DETAILS.md](HOMEWORK_API_DETAILS.md) ⭐
- **I need absences API details (parent accounts)** → [ABSENCES_API_DETAILS.md](ABSENCES_API_DETAILS.md) ⭐

## 🔁 Keep docs DRY

This directory intentionally avoids repeating “critical pitfalls” and full end-to-end flows.
Those live in the implementation reference so we have a single source of truth:
- [IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)
