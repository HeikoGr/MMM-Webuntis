# `/api/rest/view/v1/app/data` Endpoint - Full Analysis

## Overview

The `/api/rest/view/v1/app/data` endpoint is a high-value source of data available via Bearer-token authenticated REST calls. It provides:

- ✅ **User profile** (including photos)
- ✅ **School calendar** (holidays/school breaks)
- ✅ **Timetable structure** (time grid units with start/end times)
- ✅ **School/Tenant info** (school name/code + tenant ID)
- ✅ **Permissions** (what the user is allowed to access)
- ✅ **Children list** (ONLY for parent accounts)
- ✅ **System settings** (locale, etc.)

---

## Data Structure by Account Type

### 1) Student account (QR code or username/password)

```javascript
{
  user: {
    id: {USER_ID},
    name: "{STUDENT_USERNAME}",
    email: "{STUDENT_EMAIL}",
    locale: "de",
    lastLogin: "2025-12-18T12:48:13.165",
    person: {
      displayName: "{STUDENT_DISPLAY_NAME}",
      id: {PERSON_ID},
      imageUrl: "https://images.webuntis.com/image/{TENANT_ID}/..."
    },
    roles: ["STUDENT"],
    students: [],  // ⚠️ Empty for student accounts
    permissions: {
      views: [
        "TODAY",
        "TIMETABLE_NEW_STUDENTS_MY",
        "STUDENT_EXAMS",
        "MESSAGE_CENTER",
        "STUDENT_HOMEWORK",
        // ... 9 more views
      ]
    }
  },
  tenant: {
    displayName: "{SCHOOL_DISPLAY_NAME}",
    id: "{TENANT_ID}",
    name: "{SCHOOL_NAME}"
  },
  currentSchoolYear: {
    id: 9,
    name: "2025-2026",
    dateRange: {
      start: "2025-07-31",
      end: "2026-07-31"
    },
    timeGrid: {
      schoolyearId: 9,
      units: [
        { unitOfDay: 1, startTime: 750,  endTime: 845  },  // 07:50 - 08:45
        { unitOfDay: 2, startTime: 850,  endTime: 935  },  // 08:50 - 09:35
        // ... 10 more periods
      ]
    }
  },
  holidays: [
    {
      id: 2,
      name: "1.5.",
      start: "2024-05-01T00:00:00",
      end: "2024-05-01T23:59:59",
      bookable: false
    },
    // ... 46 more entries
  ]
}
```

### 2) Parent account (legal guardian)

```javascript
{
  user: {
    id: {PARENT_USER_ID},
    name: "{username}",
    email: "{PARENT_EMAIL}",
    locale: "de",
    person: {
      displayName: "{PARENT_DISPLAY_NAME}",
      id: {PARENT_PERSON_ID},
      imageUrl: null  // Parents typically have no photo
    },
    roles: ["LEGAL_GUARDIAN"],
    students: [
      // ⭐ The children (only present for parent accounts)
      {
        displayName: "{STUDENT_DISPLAY_NAME}",
        id: {STUDENT_ID},
        imageUrl: "https://images.webuntis.com/image/{TENANT_ID}/..."
      },
      {
        displayName: "{SIBLING_DISPLAY_NAME}",
        id: {SIBLING_ID},
        imageUrl: "https://images.webuntis.com/image/{TENANT_ID}/{IMAGE_HASH}"
      }
    ]
  },
  // Everything else is identical to a student account
}
```

---

## Notable Fields & Use Cases

### 1) User photo (`imageUrl`)

| Context | Field | URL example |
|---------|-------|-------------|
| **Student** | `user.person.imageUrl` | `https://images.webuntis.com/image/{TENANT_ID}/{IMAGE_HASH}...` |
| **Parent** | `user.person.imageUrl` | `null` (no photo) |
| **Kind (Parent-View)** | `user.students[].imageUrl` | `https://images.webuntis.com/image/{TENANT_ID}/{IMAGE_HASH}...` |

**Possible usage:**
- Show a student profile photo
- Add avatars to widgets
- Show a photo in the module header

---

### 2) Children list (parent accounts)

```javascript
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
```

**Important:**
- ✅ **ONLY available for parent accounts!**
- ✅ Contains child IDs to retrieve data
- ✅ Contains display names & photos
- ⚠️ For QR-code/student accounts this array is empty

**Possible usage:**
- Automatically detect which children a parent account can monitor
- Generate a child-selection UI (with photos)
- Per-child dashboards

---

### 3) School calendar / holidays (47 entries)

```javascript
holidays: [
  {
    id: 2,
    name: "1.5.",                          // Short name (day)
    start: "2024-05-01T00:00:00",
    end: "2024-05-01T23:59:59",
    bookable: false
  },
  {
    id: 17,
    name: "Herbst",                        // Long name (week/holiday)
    start: "2023-10-30T00:00:00",
    end: "2023-11-05T23:59:59",
    bookable: false
  },
  {
    id: 22,
    name: "Ostern",                        // Holiday period
    start: "2024-03-25T00:00:00",
    end: "2024-04-07T23:59:59",
    bookable: false
  },
  // ... 44 more
]
```

**Important:**
- ✅ **ONLY REST API source for holidays!**
- ✅ Only available via Bearer token
- ✅ Covers single days, weeks, school breaks
- ✅ 47 entries for the 2025–2026 school year
- ⚠️ Older than some JSON-RPC flows, but available via REST

**Possible usage:**
- Show a school calendar with holiday data
- Auto-hide during holidays
- Public-holiday markers

---

### 4) Timetable structure (time grid)

```javascript
currentSchoolYear: {
  timeGrid: {
    units: [
      { unitOfDay: 1,  startTime: 750,  endTime: 845  },  // 07:50 - 08:45
      { unitOfDay: 2,  startTime: 850,  endTime: 935  },  // 08:50 - 09:35
      { unitOfDay: 3,  startTime: 950,  endTime: 1035 },  // 09:50 - 10:35
      { unitOfDay: 4,  startTime: 1040, endTime: 1125 },  // 10:40 - 11:25
      { unitOfDay: 5,  startTime: 1140, endTime: 1225 },  // 11:40 - 12:25
      { unitOfDay: 6,  startTime: 1230, endTime: 1315 },  // 12:30 - 13:15
      { unitOfDay: 7,  startTime: 1315, endTime: 1350 },  // 13:15 - 13:50 (short)
      { unitOfDay: 8,  startTime: 1355, endTime: 1440 },  // 13:55 - 14:40
      { unitOfDay: 9,  startTime: 1445, endTime: 1530 },  // 14:45 - 15:30
      { unitOfDay: 10, startTime: 1535, endTime: 1620 },  // 15:35 - 16:20
      { unitOfDay: 11, startTime: 1625, endTime: 1710 },  // 16:25 - 17:10
      { unitOfDay: 12, startTime: 1715, endTime: 1800 }   // 17:15 - 18:00
    ]
  }
}
```

**Important:**
- ✅ Time in HHMM format (745 = 7:45)
- ✅ 12 periods per day
- ✅ Can be used for **caching/lookup**
- ✅ Stable, rarely changes

**Possible usage:**
- Compute timelines (map lessons to periods)
- Convert times into lesson numbers
- Local cache for performance

---

### 5) Permissions

```javascript
permissions: [
  "TT_VIEW:R:1:ASSIGNED",          // View timetable (own)
  "TT_VIEW:R:5:ASSIGNED",          // Timetable (class?)
  "TT_VIEW:R:4:ALL",               // Timetable (rooms?)
  "EXAMINATION:R:0:ASSIGNED",      // Read exams
  "HOMEWORK:R:0:ALL",              // Homework
  "MSG_OF_DAY:R:0:ALL",            // Messages of the day
  "EXAMSTATISTICS:DCWR:0:ASSIGNED",// Exam statistics
  "MESSAGES:R:0:ALL",              // Messages
  "TT_OVERVIEW:R:1:ALL"            // Timetable overview
]
```

**Important:**
- ✅ Shows exactly which APIs the user is allowed to use
- ✅ Format: `ENDPOINT:PERMISSION:TYPE:SCOPE`

**Possible usage:**
- Prevent API errors (better error handling)
- Adapt the UI based on permissions
- Debug information

---

### 6) User information

```javascript
user: {
  id: {USER_ID},                                    // User ID
  name: "{STUDENT_SHORTNAME}",                 // Username/short name
  email: "{STUDENT_EMAIL}",                    // Email
  locale: "de",                                // Locale
  lastLogin: "2025-12-18T12:48:13.165",         // Last login
  person: {
    displayName: "{STUDENT_DISPLAY_NAME}",    // Full name
    id: {PERSON_ID},                                  // Person ID
    imageUrl: "https://..."                    // Profile photo
  }
}
```

**Important:**
- ✅ `user.id` ≠ `person.id` (different systems)
- ✅ `locale` can be used for language settings

---

### 7) School information

```javascript
tenant: {
  displayName: "{SCHOOL_DISPLAY_NAME}",       // School name (display)
  name: "{SCHOOL_CODE}",                      // School code (used in URLs)
  id: "{TENANT_ID}",                          // Tenant/school ID
  wuHostName: null                              // Host name
}
```

---

### 8) System settings

```javascript
settings: [
  "system.linesperpage:70",              // How many lines per page
  "system.firstDayOfWeek:2",             // First day of week (2 = Monday)
  "system.showlessonsofday:false",       // Show lessons-of-day view?
  "system.emailadmin:{ADMIN_EMAIL}"      // Admin email
]
```

---

## Differences: student vs. parent vs. QR code

| Feature | Student | Parent | QR code |
|---------|---------|--------|---------|
| **user.id** | ✓ | ✓ | ✓ |
| **user.person.imageUrl** | ✓ photo | ✗ null | ✓ photo |
| **user.students[]** | ✗ empty | ✓ 2 children | ✗ empty |
| **Holidays** | ✓ 47 | ✓ 47 | ✓ 47 |
| **Permissions** | ✓ | ✓ | ✓ |
| **user.roles[0]** | STUDENT | LEGAL_GUARDIAN | STUDENT |
| **Bearer token supported** | ✓ | ✓ | ✓ **BREAKTHROUGH!** |

---

## Practical implementation ideas

### Idea 1: Auto-detect children (parent accounts)

```javascript
// In node_helper.js during authentication:
if (bearerToken) {
  const appData = await client.get('/api/rest/view/v1/app/data');

  if (appData.user.students && appData.user.students.length > 0) {
    // Parent account detected!
    config.students = appData.user.students.map(s => ({
      title: s.displayName,
      id: s.id,
      imageUrl: s.imageUrl
    }));
  }
}
```

### Idea 2: School calendar caching

```javascript
// Once per session:
const appData = await client.get('/api/rest/view/v1/app/data');
cache.holidays = appData.holidays;
cache.timegrid = appData.currentSchoolYear.timeGrid.units;

// Later:
const isHoliday = cache.holidays.some(h =>
  new Date(h.start) <= today && today <= new Date(h.end)
);
```

### Idea 3: Show a user avatar

```javascript
// In widgets:
const studentImage = appData.user.person.imageUrl;
if (studentImage) {
  // <img src={studentImage} alt={name} />
}
```

### Idea 4: QR-code student → holidays

```javascript
// This is now solved!
// QR code login → bearer token → fetch holidays
```

---

## API structure summary

| Field | Type | Available | Interesting |
|------|------|-----------|------------|
| `user.*` | Object | ✓ | ⭐⭐⭐ |
| `user.students[]` | Array | ✓ Parent, ✗ Student | ⭐⭐⭐ |
| `user.person.imageUrl` | String | ✓ | ⭐⭐ |
| `holidays[]` | Array[47] | ✓ | ⭐⭐⭐ |
| `currentSchoolYear.timeGrid.units[]` | Array[12] | ✓ | ⭐⭐ |
| `permissions[]` | Array | ✓ | ⭐ |
| `tenant.*` | Object | ✓ | ⭐ |
| `settings[]` | Array | ✓ | ⭐ |
| `departments[]` | Array | ✓ (empty) | ✗ |
| `pollingJobs[]` | Array | ✓ (empty) | ✗ |
| `oneDriveData.*` | Object | ✓ | ✗ |

---

## ✅ Conclusion

The `/api/rest/view/v1/app/data` endpoint is **extremely important** and provides:

1. **Holiday data** (47 entries) – the only REST source
2. **Student photos** – direct profile pictures
3. **Parent → student mapping** – auto-detection of children
4. **School calendar & timetable structure** – for caching & lookups
5. **Permissions** – who is allowed to access what

**Next steps:**
- Integrate into `node_helper.js`
- Implement bearer-token caching
- Use holidays for QR-code student logins
- Show student photos in widgets

