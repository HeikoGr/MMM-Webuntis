# WebUntis Standalone Test Script

This standalone JavaScript test file allows you to interact with WebUntis API from the command line. It demonstrates how to login, retrieve students, and fetch timetables.

## Features

- 🔐 **Login with username/password** to WebUntis
- 🔍 **Search for schools** by name or city
- 📋 **List all students** in the system
- 📅 **Display timetables** for specific students
- 🎯 **Interactive mode** with prompts for easy use
- ⚡ **Command-line mode** for automation and scripting

## Installation

The script uses the `webuntis` package which should already be installed in this project. If not, install it with:

```bash
npm install
```

## Usage

### Method 1: Interactive Mode (Recommended for first-time users)

Simply run the script without any arguments:

```bash
node test-webuntis-standalone.js
```

The script will guide you through:

1. **School search** - Search for your school by name or city
2. **School selection** - Choose from search results or enter manually
3. **Login credentials** - Enter username and password
4. **Optional settings** - Configure date ranges and student selection

### Method 2: Command-Line Arguments

For automation or repeated use, you can provide all parameters via command-line:

```bash
node test-webuntis-standalone.js \
  --school SCHOOL_NAME \
  --username YOUR_USERNAME \
  --password YOUR_PASSWORD \
  --server mese.webuntis.com
```

**Example:**

```bash
node test-webuntis-standalone.js \
  --school "myschool" \
  --username "student123" \
  --password "mypassword" \
  --server "mese.webuntis.com" \
  --days-ahead 7
```

### Method 3: Search for Schools Only

To find your school's details without logging in:

```bash
node test-webuntis-standalone.js --search-school "school name"
```

**Example:**

```bash
node test-webuntis-standalone.js --search-school "gymnasium"
node test-webuntis-standalone.js --search-school "berlin"
```

This will display:

- School display name
- School ID (needed for login)
- Server address
- Location

## Command-Line Options

| Option            | Description                               | Required | Default       |
| ----------------- | ----------------------------------------- | -------- | ------------- |
| `--school`        | School identifier                         | Yes\*    | -             |
| `--username`      | WebUntis username                         | Yes\*    | -             |
| `--password`      | WebUntis password                         | Yes\*    | -             |
| `--server`        | WebUntis server (e.g., mese.webuntis.com) | Yes\*    | -             |
| `--days-past`     | Days in the past to show                  | No       | 0             |
| `--days-ahead`    | Days ahead to show                        | No       | 7             |
| `--student-id`    | Specific student ID to show               | No       | First student |
| `--search-school` | Search for schools by name                | No       | -             |
| `--help`, `-h`    | Show help message                         | No       | -             |

\* Required only in command-line mode (not in interactive mode)

## Examples

### Example 1: Interactive Mode

```bash
node test-webuntis-standalone.js
```

### Example 2: Full Command-Line Mode

```bash
node test-webuntis-standalone.js \
  --school "demo-school" \
  --username "demo" \
  --password "demo123" \
  --server "demo.webuntis.com" \
  --days-ahead 5 \
  --days-past 1
```

### Example 3: View Specific Student's Timetable

First, run without `--student-id` to see all students, then:

```bash
node test-webuntis-standalone.js \
  --school "demo-school" \
  --username "demo" \
  --password "demo123" \
  --server "demo.webuntis.com" \
  --student-id 12345
```

### Example 4: Search for Schools

```bash
# Search by school name
node test-webuntis-standalone.js --search-school "Einstein Gymnasium"

# Search by city
node test-webuntis-standalone.js --search-school "München"

# Search by partial name
node test-webuntis-standalone.js --search-school "realschule"
```

## Output

The script will display:

1. **Login Status** - Confirms successful authentication
2. **All Students** - Table with ID, Name, First Name, and Gender
3. **Timetable** - For selected student showing:
   - Date
   - Time (start - end)
   - Lesson number
   - Subject
   - Teacher
   - Room
   - Class
   - Status codes (cancelled, irregular, etc.)
   - Additional info and substitution text

## Sample Output

```
🚀 Starting WebUntis Standalone Test
================================================================================
School: demo-school
Server: demo.webuntis.com
Username: demo
================================================================================

📝 Step 1: Logging in...
✅ Login successful!

📝 Step 2: Fetching all students...
✅ Retrieved 125 students

================================================================================
ALL STUDENTS
================================================================================
Total: 125 students

ID       Name                           First Name           Gender
--------------------------------------------------------------------------------
12345    Müller                         Anna                 F
12346    Schmidt                        Max                  M
12347    Becker                         Lisa                 F
...

📝 Step 3: Fetching timetable for student: Anna Müller (ID: 12345)
   Date range: 2025-11-20 to 2025-11-27
✅ Retrieved 24 lessons

================================================================================
TIMETABLE FOR STUDENT: Anna Müller (ID: 12345)
================================================================================
Total: 24 lessons

📅 2025-11-20
--------------------------------------------------------------------------------
  ⏰ 08:00 - 08:45 | Lesson 1
     📚 Subject: Mathematics
     👨‍🏫 Teacher: Mr. Johnson
     🚪 Room: 201
     👥 Class: 10A

  ⏰ 08:50 - 09:35 | Lesson 2
     📚 Subject: English
     👨‍🏫 Teacher: Mrs. Smith
     🚪 Room: 305
     👥 Class: 10A
     ⚠️  Code: irregular
     📝 Substitution: Room changed

...

✅ Test completed successfully!
```

## Troubleshooting

### Error: "Cannot login" or "Invalid credentials"

- Double-check your username and password
- Verify the school identifier is correct
- Ensure the server address is correct (don't include `https://` or paths)

### Error: "No students found"

- Your account may not have permission to view students
- Try using your own account if you're a student
- Check with your school's WebUntis administrator

### Error: "School not found" during search

- Try searching with different terms (school name, city, district)
- Use partial names or abbreviations
- Check the official WebUntis website for your school's correct name

### Error: "Network error" or "Connection refused"

- Check your internet connection
- Verify the server address is reachable
- Some schools may have restricted API access

## Advanced Usage

### Scripting and Automation

The script can be used in shell scripts for automation:

```bash
#!/bin/bash
# Save timetable to a file
node test-webuntis-standalone.js \
  --school "$SCHOOL" \
  --username "$USERNAME" \
  --password "$PASSWORD" \
  --server "$SERVER" > timetable.txt 2>&1

# Check if successful
if [ $? -eq 0 ]; then
  echo "Timetable retrieved successfully"
else
  echo "Failed to retrieve timetable"
fi
```

### Environment Variables

You can use environment variables for sensitive data:

```bash
export WEBUNTIS_SCHOOL="myschool"
export WEBUNTIS_USERNAME="user"
export WEBUNTIS_PASSWORD="pass"
export WEBUNTIS_SERVER="mese.webuntis.com"

node test-webuntis-standalone.js \
  --school "$WEBUNTIS_SCHOOL" \
  --username "$WEBUNTIS_USERNAME" \
  --password "$WEBUNTIS_PASSWORD" \
  --server "$WEBUNTIS_SERVER"
```

## API Reference

This script demonstrates the following WebUntis API methods:

- `login()` - Authenticate with WebUntis
- `getStudents()` - Retrieve all students
- `getTimetableForRange(startDate, endDate, id, type)` - Get timetable for a specific student
- `logout()` - Close the session

For more information about the WebUntis API, see:

- https://webuntis.noim.me/classes/WebUntis.html
- https://github.com/SchoolUtils/WebUntis

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never commit credentials** to version control
2. **Use environment variables** for sensitive data in scripts
3. **Be careful with command history** - your password may be stored in shell history
4. **Use secure file permissions** if storing credentials in files
5. **Logout properly** - the script always calls `logout()` to free server resources

## Related Files

- `node_helper.js` - Main MagicMirror module helper (uses similar WebUntis calls)
- `check.js` - Config validation script
- `package.json` - Dependencies including `webuntis` package

## License

This script is part of the MMM-Webuntis MagicMirror module and follows the same MIT license.

## Support

For issues or questions:

- Check the [MMM-Webuntis repository](https://github.com/HeikoGr/MMM-Webuntis)
- Review the [WebUntis API documentation](https://webuntis.noim.me/)
- Search for similar issues in the forum

## Contributing

Feel free to improve this script and submit pull requests to the MMM-Webuntis repository.
