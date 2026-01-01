# Absences REST API Implementation Details

## Endpoint Overview

**Endpoint:** `GET /WebUntis/api/classreg/absences/students`

**Authentication:** Bearer token + Session cookies

**Purpose:** Fetch absence records (unexcused/excused missed classes) for a student over a specified date range.

**Parent Account Support:** ✅ Yes (via `studentId` parameter)

## Response Structure

```json
{
  "data": {
    "absences": [
      {
        "id": 12345,
        "lessonId": 30195,
        "date": 20251211,
        "startTime": 510,
        "endTime": 555,
        "studentId": 1774,
        "text": "Krankheit",
        "excuse": null,
        "excuseStatus": 0,
        "absenceType": 1
      },
      ...
    ]
  }
}
```

## Response Field Details

| Field | Type | Notes |
|-------|------|-------|
| `id` | Integer | Unique absence identifier |
| `lessonId` | Integer | Reference to the lesson |
| `date` | Integer (YYYYMMDD) | Absence date in YYYYMMDD format |
| `startTime` | Integer (minutes) | Lesson start time in minutes from midnight |
| `endTime` | Integer (minutes) | Lesson end time in minutes from midnight |
| `studentId` | Integer | Student ID (useful for multi-student filtering) |
| `text` | String | Absence description or reason |
| `excuse` | String or null | Excuse text (if provided) |
| `excuseStatus` | Integer | Status code: 0=unexcused, 1=excused, 2=pending |
| `absenceType` | Integer | Type code (varies by school) |

## API Parameters

### Request Example
```
GET /WebUntis/api/classreg/absences/students?startDate=20251201&endDate=20251231&studentId=1774
Authorization: Bearer {token}
Cookie: {cookieString}
Accept: application/json
```

### Parameters

| Parameter | Type | Required | Format | Notes |
|-----------|------|----------|--------|-------|
| `startDate` | String | Yes | YYYYMMDD | Start of date range |
| `endDate` | String | Yes | YYYYMMDD | End of date range |
| `studentId` | String | No | Integer | Student ID (parent accounts) |

## Data Normalization (Implementation)

### In `_getAbsencesViaRest()` (node_helper.js)

```javascript
// Date normalization
absenceDate: this._normalizeDateToInteger(absence.date)

// Time normalization: minutes → HHMM format
startTime: this._normalizeTimeToMinutes(absence.startTime)
endTime: this._normalizeTimeToMinutes(absence.endTime)

// HTML sanitization
text: this._sanitizeHtmlText(absence.text ?? '', true),
excuse: this._sanitizeHtmlText(absence.excuse ?? '', false),
```

### Time Conversion Example

**Input:** `startTime: 510` (minutes from midnight)
```
510 minutes = 8 hours 30 minutes = 08:30
Normalized: 0830 (HHMM integer format)
```

**Conversion function:**
```javascript
// 510 minutes → 0830
const hours = Math.floor(510 / 60);      // 8
const minutes = 510 % 60;                // 30
return hours * 100 + minutes;            // 830
```

## HTML Sanitization

**Function:** `_sanitizeHtmlText(text, preserveLineBreaks = true)`

Applied to both `text` and `excuse` fields to prevent XSS attacks.

**Example:**
```javascript
// Input
"Krankheit<br/>Ärztliches Zeugnis erforderlich&nbsp;&nbsp;&nbsp;"

// Output
"Krankheit\nÄrztliches Zeugnis erforderlich   "
```

## Excuse Status Codes

| Status | Code | Meaning |
|--------|------|---------|
| Unexcused | 0 | No excuse provided |
| Excused | 1 | Absence has been excused |
| Pending | 2 | Excuse is pending approval |

## Parent Account Support

✅ **Parent accounts can fetch absences** for their children.

**Implementation:**
```javascript
// Parent account: Must provide studentId
const resp = await fetchClient.get(
  `https://${server}/WebUntis/api/classreg/absences/students`,
  {
    params: {
      startDate: formatDateYYYYMMDD(rangeStart),
      endDate: formatDateYYYYMMDD(rangeEnd),
      studentId: studentId  // ✅ Required for parent accounts
    },
    headers: {
      Authorization: `Bearer ${token}`,
      Cookie: cookieString,
      ...
    }
  }
);
```

## Error Handling

**Potential Issues:**

### 1. Parent Account Rejection
- **Error:** HTTP 403 Forbidden
- **Cause:** Parent account credentials used without proper `studentId`
- **Fix:** Ensure `studentId` is provided in request parameters

### 2. Invalid Date Range
- **Error:** HTTP 400 Bad Request
- **Cause:** Incorrect YYYYMMDD format
- **Fix:** Validate date format before request

### 3. No Absences
- **Response:** HTTP 200 with empty `absences[]` array
- **Handling:** This is normal - return empty list without error

## Testing

**Test command:**
```bash
node cli/test-webuntis-rest-api.js absences --from 2025-12-01 --to 2025-12-31
```

**Example output:**
```
✓ Fetched 2 absences

  Absence details:

  [1]
    Date: 20251205
    Time: 08:30 - 09:15
    Reason: Krankheit
    Status: Excused
```

## Known Limitations

### 1. Limited Metadata
- The API does not return lesson details (subject, teacher, room)
- Join with timetable data for full lesson information

### 2. Historical Data
- Absences older than 1-2 years may not be available
- Some schools may have retention policies

### 3. Future Dates
- Cannot pre-record absences for future dates

## Related Documentation

- **Implementation:** [node_helper.js](../../node_helper.js#L390)
- **Tests:** [cli/test-webuntis-rest-api.js](../../cli/test-webuntis-rest-api.js#L726)
- **REST Overview:** [REST_ENDPOINTS_OVERVIEW.md](REST_ENDPOINTS_OVERVIEW.md)
