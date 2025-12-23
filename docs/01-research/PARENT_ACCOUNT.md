# Parent Account Support

MMM-Webuntis supports parent accounts with the ability to monitor multiple children's timetables.

## Configuration

### Method 1: Direct Student Account (Backward Compatible)
```javascript
{
  title: 'Student Name',
  qrcode: 'untis://setschool?...',
  // or
  username: 'student_username',
  password: 'student_password',
  school: 'school_name',
  server: 'webuntis.com',
}
```

### Method 2: Parent Account (NEW - Hybrid Approach)
Configure parent credentials **once at module level**, then list each child with just `studentId`:

```javascript
{
  module: 'MMM-Webuntis',
  position: 'top_right',
  config: {
    // Configure parent credentials once (shared for all children):
    parentUsername: '{username}',
    parentPassword: '{password}',
    school: '{SCHOOL_CODE}',
    server: '{WEBUNTIS_SERVER}',

    // Then list each child (uses parent credentials + studentId):
    students: [
      { title: 'Child 1', studentId: 12345 },
      { title: 'Child 2', studentId: 67890 },
      { title: 'Child 3', studentId: 24680 },
    ],
  }
}
```

**Benefits:**
- Parent credentials configured only once
- Clean, minimal student config (just `title` + `studentId`)
- Can mix direct logins with parent-managed children

### Method 3: Hybrid Approach (Mix Direct + Parent)
```javascript
{
  module: 'MMM-Webuntis',
  config: {
    parentUsername: '{username}',
    parentPassword: '{password}',
    // ...

    students: [
      // Direct student login (no parent credentials needed):
      { title: 'My Account', qrcode: 'untis://...' },

      // Via parent account:
      { title: 'Child 1', studentId: 12345 },
      { title: 'Child 2', studentId: 67890 },
    ],
  }
}
```

## Finding the Student ID

Use the CLI tool to find your child's student ID:

```bash
node cli/cli.js config/config.js
```

Choose option **1) Test timetable with manual Student ID**:
- Enter parent account credentials
- Try different student IDs to find the correct one for each child
- Note down the working IDs
- Add them to `config.js`

## API Changes

When a parent account with `studentId` is detected, the following API calls are modified:

### Timetable (Lessons)
- **Direct login**: `getOwnTimetableForRange(start, end)`
- **Parent account**: `getTimetableForRange(start, end, studentId, STUDENT)` ✅

Note: In parent mode, MMM-Webuntis attempts to fetch the timetable via REST first and falls back to JSON-RPC if REST fails.

### Exams
- **Direct login**: `getExamsForRange(start, end)`
- **Parent account**: `getExamsForRange(start, end, studentId)` ✅

### Timegrid
- **No change**: `getTimegrid()` (applies to all, global)

### Absences
- **Direct login**: `getAbsentLesson(start, end)`
- **Parent account**: Via REST API `/WebUntis/api/absences` ✅ (NEW - as of recent WebUntis API updates)

Note: Absences can now be retrieved via REST API for parent accounts, providing access to student absence data through the `/WebUntis/api/classreg/absences/students` endpoint.

### Homeworks
- **No change**: `getHomeWorkAndLessons()` or `getHomeWorksFor()`
- ⚠️ **Note**: WebUntis API does not support fetching homework for specific students from parent accounts

### Messages of Day
- ✅ **Via REST API** (NEW): `/WebUntis/api/public/news/newsWidgetData?date=...` now supports dynamic date-based retrieval
- **HTML Sanitization**: Text content is automatically cleaned of HTML tags, with intentional line breaks (`<br>`) preserved as newlines
- **Note**: Messages are global (not student-specific), showing school-wide announcements for the selected date

## Limitations

1. **Homeworks**: Homework entries are fetched through the `getHomeWorkAndLessons()` API, which returns records with student IDs. The module now filters homework per student using the `records.elementIds` mapping, so each student sees only their own homework.

2. **Homeworks via REST**: The REST API `/WebUntis/api/homeworks` may not be available for all parent account configurations (authentication-dependent).

3. **Messages of Day**: Global messages via `getNewsWidget()`, applies to all students, not per-student.

4. **Regional Variations**: Some WebUntis instances may have different API capabilities or restrictions for parent accounts depending on regional configuration.

To verify your setup is working:

1. Add `logLevel: 'debug'` to your MMM-Webuntis config
2. Check MagicMirror's logs for messages like:
   ```
   [MMM-Webuntis] getTimetableForRange for studentId=12345
   ```
3. Verify that timetable data appears in the module

## Troubleshooting

- **No data showing**: Verify the `studentId` is correct using the CLI tool
- **Login fails**: Check parent account credentials and school name
- **Partial data**: Check which API calls are working in the logs (some schools may restrict parent access)
- **Mixed direct + parent accounts**: Each student type uses its own credentials; students are automatically grouped by credential type
