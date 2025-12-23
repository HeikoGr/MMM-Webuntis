# Homework REST API Implementation Details

## Endpoint Overview

**Endpoint:** `GET /WebUntis/api/homeworks/lessons`

**Authentication:** Bearer token + Session cookies

**Purpose:** Fetch homework assignments with associated lesson metadata for a specified date range.

## Response Structure

The API returns a JSON object with **parallel arrays** (not nested):

```json
{
  "data": {
    "homeworks": [
      {
        "id": 72434,
        "lessonId": 30195,
        "date": 20251211,
        "dueDate": 20251218,
        "text": "-",
        "remark": "",
        "completed": false,
        "attachments": []
      },
      ...
    ],
    "lessons": [
      {
        "id": 30592,
        "subject": "Geographie",
        "lessonType": "Unterricht"
      },
      {
        "id": 30195,
        "subject": "Englisch",
        "su": [
          {
            "id": 123,
            "name": "E",
            "longname": "Englisch"
          }
        ],
        "lessonType": "Unterricht"
      },
      ...
    ],
    "records": [...],
    "teachers": [...]
  }
}
```

## Key Structure Details

### ⚠️ Critical Discovery: Parallel Arrays

Unlike other endpoints, homework data is **NOT nested**. The response contains:
- **`homeworks[]`:** Array of homework items
- **`lessons[]`:** Array of lesson metadata
- **Join key:** `homework.lessonId` → `lesson.id`

### Homework Item Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `id` | Integer | Yes | Unique homework identifier |
| `lessonId` | Integer | Yes | Reference to lesson (join key) |
| `date` | Integer (YYYYMMDD) | Sometimes | Lesson date (backup if `dueDate` missing) |
| `dueDate` | Integer (YYYYMMDD) | Yes | Due date in YYYYMMDD format |
| `text` | String | No | Homework description (may contain HTML) |
| `remark` | String | No | Additional remarks |
| `completed` | Boolean | Yes | Whether homework is marked as complete |
| `attachments` | Array | No | Attachment objects (if any) |

### Lesson Item Fields

| Field | Type | Notes |
|-------|------|-------|
| `id` | Integer | Primary key for joining homework |
| `subject` | String | Subject name (e.g., "Geographie") |
| `su` | Array[Object] | Alternative subject object with `{ id, name, longname }` |
| `lessonType` | String | Type of lesson (e.g., "Unterricht", "Freistunde") |

## Important: Subject Name Extraction

⚠️ **Subject data can be in TWO different formats:**

### Option 1: Simple `subject` field
```json
{
  "id": 30592,
  "subject": "Geographie",
  "lessonType": "Unterricht"
}
```

### Option 2: Nested `su` array
```json
{
  "id": 30195,
  "su": [
    {
      "id": 123,
      "name": "E",
      "longname": "Englisch"
    }
  ],
  "lessonType": "Unterricht"
}
```

### Implementation (with fallback):
```javascript
let subjectName = null;
if (lesson.su && lesson.su[0]) {
  subjectName = {
    name: lesson.su[0].name,
    longname: lesson.su[0].longname
  };
} else if (lesson.subject) {
  subjectName = { name: lesson.subject };
}
```

## API Parameters

### Request Example
```
GET /WebUntis/api/homeworks/lessons?startDate=20251201&endDate=20251231
Authorization: Bearer {token}
Cookie: {cookieString}
Accept: application/json
```

### Parameters

| Parameter | Type | Required | Format | Example |
|-----------|------|----------|--------|---------|
| `startDate` | String | Yes | YYYYMMDD | `20251201` |
| `endDate` | String | Yes | YYYYMMDD | `20251231` |

## Data Normalization (Implementation)

### In `_getHomeworkViaRest()` (node_helper.js)

```javascript
// Date normalization: YYYYMMDD string → YYYYMMDD integer
dueDate: this._normalizeDateToInteger(hw.dueDate ?? hw.date)

// Time normalization: HHMM (if present)
// Not applicable for homework (only dates)

// HTML sanitization
text: this._sanitizeHtmlText(hw.text ?? hw.description ?? hw.remark ?? '', true),
remark: this._sanitizeHtmlText(hw.remark ?? '', false),

// Deduplication
const hwId = hw.id ?? `${hw.lessonId}_${hw.dueDate}`;
if (!seenIds.has(hwId)) {
  seenIds.add(hwId);
  // Process homework...
}
```

## HTML Sanitization Strategy

**Function:** `_sanitizeHtmlText(text, preserveLineBreaks = true)`

**Process:**
1. Convert `<br>` tags to `\n` if `preserveLineBreaks` is true
2. Remove all HTML tags via regex
3. Decode HTML entities (e.g., `&quot;` → `"`)
4. Normalize whitespace (trim, collapse multiple spaces)

**Example:**
```javascript
// Input
"Workbook p.31 Ex 10a<br/>Buch S. 45&nbsp;ff."

// Output
"Workbook p.31 Ex 10a\nBuch S. 45 ff."
```

## Deduplication Strategy

Homeworks may appear multiple times due to API behavior. **Prevention:**

```javascript
const seenIds = new Set();

// Primary: Use homework ID
// Fallback: Use composite key (lessonId + dueDate)
const hwId = hw.id ?? `${hw.lessonId}_${hw.dueDate}`;

if (!seenIds.has(hwId)) {
  seenIds.add(hwId);
  // Add to result array
}
```

## Parent Account Access

✅ **Parent accounts CAN fetch homework** via this endpoint.

**Important:** The endpoint returns **all homework for the date range**, not filtered by `studentId`.

- If student filtering is needed, implement in the module layer
- Current implementation: Returns all homework (acceptable for single-student modules)
- For multi-student parent accounts: Filter in `_getHomeworkViaRest()` if needed

## Known Limitations

### 1. Lesson Data Completeness
- Not all lessons that have homework may be returned in the `lessons[]` array
- Some homeworks may have `lessonId` values that don't appear in the lesson list
- **Workaround:** Use fallback approach - if lesson not found, display homework without subject

### 2. Missing Homework Data
- Incomplete homework assignments may not be returned
- Only homework with explicit `dueDate` is reliably returned

### 3. Date Range Sensitivity
- Large date ranges (>60 days) may return fewer lessons in the metadata
- If subjects are missing, try smaller date ranges to see if lesson data improves

## Testing

**Test command with custom date range:**
```bash
node cli/test-webuntis-rest-api.js homework --from 2025-12-01 --to 2025-12-31
```

**Expected output:**
```
✓ Fetched 54 homeworks

  Homework details (first 3):

  [1]
    Due Date: 20251217
    Subject: Rhythmik
    Text: -
    Completed: false
```

## Error Handling

**HTTP Status Codes:**
- `200 OK` - Success
- `400 Bad Request` - Invalid date format or parameters
- `401 Unauthorized` - Invalid or expired token
- `403 Forbidden` - Access denied
- `500 Internal Server Error` - Server-side error

**Implementation in `_getHomeworkViaRest()`:**
```javascript
if (resp.status !== 200) {
  throw new Error(`REST API returned status ${resp.status} for homework`);
}
```

## References

- **Implementation:** [node_helper.js](../../node_helper.js#L297)
- **Tests:** [cli/test-webuntis-rest-api.js](../../cli/test-webuntis-rest-api.js#L793)
- **Related:** [REST_ENDPOINTS_OVERVIEW.md](REST_ENDPOINTS_OVERVIEW.md)
