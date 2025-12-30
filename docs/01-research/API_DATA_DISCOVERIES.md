# 🎯 /api/rest/view/v1/app/data - Summary of findings

## 🔍 What we found

The `/api/rest/view/v1/app/data` endpoint is a **hidden API** that contains extremely valuable data:

**Canonical references (single source of truth):**
- Full response structure and field-by-field documentation: [APP_DATA_ANALYSIS.md](../02-api-reference/APP_DATA_ANALYSIS.md)
- Bearer-token login flow (cookies → `/api/token/new` → Bearer headers): [BEARER_TOKEN_GUIDE.md](../02-api-reference/BEARER_TOKEN_GUIDE.md)
- Minimal working end-to-end example (incl. pitfalls like `resources` as string): [IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)

### ✅ Available data

| Area | Amount | Notes |
|---------|-------|------------|
| **Holidays/public holidays** | 47 entries | ⭐ Only REST source! |
| **Timetable structure** | 12 periods | With exact start/end times |
| **Student photos** | 1 per student | Via `https://images.webuntis.com/...` |
| **School info** | School ID, name, etc. | From the `tenant` field |
| **Permissions** | 9 entries | Who can access what? |
| **Children (parent)** | Dynamic | ⭐ Only present for parent accounts! |
| **User profile** | ID, name, email, locale | For identification |
| **System settings** | 4 entries | School configuration |

---

## 📊 Data comparison: student vs. parent

### **Student account (QR code or username)**

```
✓ Holidays (47)
✓ User photo (`imageUrl`)
✓ Permissions
✓ School info
✓ Timetable structure
✗ Children list (empty)
```

### **Parent account (legal guardian)**

```
✓ Holidays (47) - identical to student
✓ Children list (2 children with ID + photo) ⭐⭐⭐
✓ Permissions
✓ School info
✓ Timetable structure
✗ Own photo (null)
```

---

## 🌟 Top 3 findings

### **1) Children list for parent accounts** ⭐⭐⭐

```javascript
// Parent account:
user.students = [
  {
    displayName: "{STUDENT_DISPLAY_NAME}",
    id: {STUDENT_ID},
    imageUrl: "https://images.webuntis.com/image/{TENANT_ID}/..."
  },
  {
    displayName: "{SIBLING_DISPLAY_NAME}",
    id: {SIBLING_ID},
    imageUrl: "https://images.webuntis.com/image/{TENANT_ID}/..."
  }
]

// Student account:
user.students = []  // empty
```

**Impact:**
- Parent accounts can automatically discover their children
- Use child IDs directly for API calls
- Profile photos for all children are directly available

---

### **2) Holiday data (only REST source)** ⭐⭐⭐

Holiday and break data is available in the app data response (typically dozens of entries).
For real response examples and parsing guidance, use:
- [APP_DATA_ANALYSIS.md](../02-api-reference/APP_DATA_ANALYSIS.md)

**Impact:**
- **Before:** Only via JSON-RPC `getHolidays()`
- **Now:** Via REST API + bearer token
- **QR code:** Bearer-token login can also make this possible if you can obtain session cookies

---

### **3) Student photos (new!)** ⭐⭐

```
imageUrl: "https://images.webuntis.com/image/{TENANT_ID}/..."
```

**Impact:**
- Show student profiles with photos
- Add avatars to widgets
- Parents can see children's photos

---

## 🎯 Practical use cases

### **Use case 1: Auto-detect children for parent accounts**

1. Fetch app data (`/api/rest/view/v1/app/data`)
2. If `user.students` is non-empty → parent account detected
3. Use `students[].id` for timetable/exams/homework calls

See the full parsing examples in:
- [APP_DATA_ANALYSIS.md](../02-api-reference/APP_DATA_ANALYSIS.md)

### **Use case 2: Show a holiday calendar**

```javascript
// 1. Fetch holidays (once per session)
const appData = await client.get('/api/rest/view/v1/app/data');
const holidays = appData.holidays;

// 2. Display in dashboard
holidays.forEach(holiday => {
  const start = new Date(holiday.start);
  const end = new Date(holiday.end);
  console.log(`${holiday.name}: ${start.toLocaleDateString()} - ${end.toLocaleDateString()}`);
});

// 3. Hide timetable display during holidays
const isHoliday = holidays.some(h => {
  const today = new Date();
  return new Date(h.start) <= today && today <= new Date(h.end);
});
if (isHoliday) {
  console.log("→ Today is a holiday, hide lessons");
}
```

### **Use case 3: Student avatar in a widget**

```javascript
// In widget:
const appData = await client.get('/api/rest/view/v1/app/data');
const studentImage = appData.user.person.imageUrl;

// HTML:
<img
  src={studentImage}
  alt={appData.user.person.displayName}
  className="student-avatar"
/>
```

---

## 🔑 Technical details

### Authentication

This document intentionally does not duplicate the full auth implementation.
Use these canonical references:

- Cookie-based login + token generation: [BEARER_TOKEN_GUIDE.md](../02-api-reference/BEARER_TOKEN_GUIDE.md)
- Minimal end-to-end working example: [IMPLEMENTATION_REFERENCE.md](../01-getting-started/IMPLEMENTATION_REFERENCE.md)

Key points to remember:
- `clientTime` must be in **milliseconds** (QR-code login)
- OTP can be generated via `otplib.authenticator.generate(QR_SECRET)`
- Bearer token lifetime is ~15 minutes → cache/refresh

### **Important details:**

- ✅ `clientTime` must be in **milliseconds**
- ✅ OTP via `otplib.authenticator.generate(QR_SECRET)`
- ✅ Bearer token is valid for ~15 minutes
- ✅ Holidays are identical for students and parents
- ✅ Children list is only present for parent accounts

---

## 📈 Impact on MMM-Webuntis

### **Before (JSON-RPC only):**
```
JSON-RPC APIs: 4 (getTimetable, getAbsentLessons, getExams, getHomework)
Holidays: ✗ JSON-RPC `getHolidays()` only
Photos: ✗ Not available
Parent children: ✗ Not automatically detected
```

### **After (REST + bearer token):**
```
REST APIs: 8+ (alles aus JSON-RPC plus neue)
Holidays: ✓ REST API /api/rest/view/v1/app/data
Photos: ✓ `imageUrl` directly available
Parent children: ✓ Auto-detected & includes photos
QR code: ✓ Holidays are now possible
```

---

## 📋 All available fields in the app/data endpoint

```javascript
{
  // User information
  user: {
    id: {USER_ID},
    name: "{STUDENT_SHORTNAME}",
    email: "{STUDENT_EMAIL}",
    locale: "de",
    lastLogin: "2025-12-18T12:48:13.165",
    person: { id, displayName, imageUrl },
    roles: ["STUDENT"],
    students: [],  // Only populated for parents
    permissions: { views: [...] }
  },

  // School information
  tenant: {
    displayName: "{SCHOOL_DISPLAY_NAME}",
    name: "{SCHOOL_NAME}",
    id: "{TENANT_ID}"
  },

  // Current school year
  currentSchoolYear: {
    id: 9,
    name: "2025-2026",
    dateRange: { start, end },
    timeGrid: { units: [...12 periods...] }
  },

  // Public holidays & school breaks
  holidays: [
    { id, name, start, end, bookable },
    // ... 47 entries
  ],

  // Permissions
  permissions: [
    "TT_VIEW:R:1:ASSIGNED",
    "EXAMINATION:R:0:ASSIGNED",
    // ... 9 total
  ],

  // System settings
  settings: [
    "system.linesperpage:70",
    "system.firstDayOfWeek:2",
    // ... 4 total
  ],

  // Misc
  isPlayground: false,
  ui2020: true,
  isSupportAccessOpen: true,
  licenceExpiresAt: "2999-12-31",
  oneDriveData: { ... },
  departments: [],
  pollingJobs: []
}
```

---

## ✅ Next steps

1. **Integrate in `node_helper.js`**
  - Fetch app data once after login
  - Store it in a cache

2. **Implement holidays**
  - For QR-code student logins (now possible)
  - For parent accounts
  - Auto-hide dashboard during holidays

3. **Show student photos**
  - Use the photo URL in widgets
  - Parents can see children's photos

4. **Auto-detect children (parents)**
  - Parent account detects its children automatically
  - Adjust UI for child selection

5. **Bearer token caching**
  - Store the token (~15 min lifetime)
  - Only refresh when expired

---

## 🎓 Related documents & tools

- [APP_DATA_ANALYSIS.md](../02-api-reference/APP_DATA_ANALYSIS.md) - Detailed field documentation
- [BEARER_TOKEN_GUIDE.md](../02-api-reference/BEARER_TOKEN_GUIDE.md) - Bearer token implementation
- [API_DISCOVERY.md](API_DISCOVERY.md) - Full endpoint discovery notes
- [cli/test-webuntis-rest-api.js](../../cli/test-webuntis-rest-api.js) - REST API tests
- [cli/api-report.js](../../cli/api-report.js) - API reporting
- [cli/traceroute.js](../../cli/traceroute.js) - Network troubleshooting helper
- [cli/node_helper_wrapper.js](../../cli/node_helper_wrapper.js) - CLI tool for testing (`npm run debug`)

