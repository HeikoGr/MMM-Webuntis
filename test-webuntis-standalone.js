#!/usr/bin/env node
/* eslint-env node */
/**
 * Standalone WebUntis Test File
 *
 * This script demonstrates how to:
 * 1. Login to WebUntis with username and password
 * 2. Retrieve and display all students
 * 3. Retrieve and display the timetable for a specific student
 *
 * Usage:
 *   Interactive mode (with prompts):
 *     node test-webuntis-standalone.js
 *
 *   With command-line arguments:
 *     node test-webuntis-standalone.js --school SCHOOL --username USER --password PASS --server SERVER
 *
 *   With search for school:
 *     node test-webuntis-standalone.js --search-school "school name"
 *
 * Options:
 *   --school          School identifier (required)
 *   --username        WebUntis username (required)
 *   --password        WebUntis password (required)
 *   --server          WebUntis server, e.g., mese.webuntis.com (required)
 *   --days-past       Days in the past to show (default: 0)
 *   --days-ahead      Days ahead to show (default: 7)
 *   --search-school   Search for schools by name
 *   --student-id      Specific student ID to show timetable for (optional)
 *   --help            Show this help message
 */

const { WebUntis } = require('webuntis');
const readline = require('readline');
const https = require('https');

// ============================================================================
// Command-line argument parsing
// ============================================================================

function parseArguments() {
  const args = process.argv.slice(2);
  const config = {
    school: null,
    username: null,
    password: null,
    server: null,
    daysInPast: 0,
    daysAhead: 7,
    searchSchool: null,
    studentId: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--school':
        config.school = nextArg;
        i++;
        break;
      case '--username':
        config.username = nextArg;
        i++;
        break;
      case '--password':
        config.password = nextArg;
        i++;
        break;
      case '--server':
        config.server = nextArg;
        i++;
        break;
      case '--days-past':
        config.daysInPast = parseInt(nextArg, 10) || 0;
        i++;
        break;
      case '--days-ahead':
        config.daysAhead = parseInt(nextArg, 10) || 7;
        i++;
        break;
      case '--search-school':
        config.searchSchool = nextArg;
        i++;
        break;
      case '--student-id':
        config.studentId = parseInt(nextArg, 10);
        i++;
        break;
      case '--help':
      case '-h':
        config.help = true;
        break;
    }
  }

  return config;
}

function showHelp() {
  console.log(`
WebUntis Standalone Test Tool
==============================

Usage:
  Interactive mode (with prompts):
    node test-webuntis-standalone.js

  With command-line arguments:
    node test-webuntis-standalone.js --school SCHOOL --username USER --password PASS --server SERVER

  Search for schools:
    node test-webuntis-standalone.js --search-school "school name"

Options:
  --school          School identifier (required in non-interactive mode)
  --username        WebUntis username (required in non-interactive mode)
  --password        WebUntis password (required in non-interactive mode)
  --server          WebUntis server, e.g., mese.webuntis.com (required)
  --days-past       Days in the past to show (default: 0)
  --days-ahead      Days ahead to show (default: 7)
  --search-school   Search for schools by name
  --student-id      Specific student ID to show timetable for (optional)
  --help, -h        Show this help message

Examples:
  # Interactive mode
  node test-webuntis-standalone.js

  # With parameters
  node test-webuntis-standalone.js --school myschool --username student1 --password pass123 --server mese.webuntis.com

  # Search for schools
  node test-webuntis-standalone.js --search-school "gymnasium"
`);
}

// ============================================================================
// Interactive Dialog System
// ============================================================================

function createInterface() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function searchSchools(searchTerm) {
  console.log(`\n🔍 Searching for schools matching "${searchTerm}"...`);

  return new Promise((resolve) => {
    const options = {
      hostname: 'mobile.webuntis.com',
      path: `/ms/schoolquery2?search=${encodeURIComponent(searchTerm)}`,
      method: 'GET',
      headers: {
        'User-Agent': 'WebUntis-Test-Script',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.schools && Array.isArray(result.schools)) {
            resolve(result.schools);
          } else {
            resolve([]);
          }
        } catch (error) {
          console.error('Error parsing school search results:', error.message);
          resolve([]);
        }
      });
    });

    req.on('error', (error) => {
      console.error('Error searching for schools:', error.message);
      resolve([]);
    });

    req.end();
  });
}

function displaySchools(schools) {
  if (schools.length === 0) {
    console.log('No schools found.');
    return;
  }

  console.log('\n' + '='.repeat(80));
  console.log('FOUND SCHOOLS');
  console.log('='.repeat(80));
  console.log(`Found ${schools.length} schools:\n`);

  schools.forEach((school, index) => {
    console.log(`[${index + 1}] ${school.displayName || school.loginName}`);
    console.log(`    School ID: ${school.loginName}`);
    console.log(`    Server: ${school.server}`);
    console.log(`    Address: ${school.address || 'N/A'}`);
    console.log('');
  });
}

async function interactiveMode() {
  const rl = createInterface();
  const config = {
    school: null,
    username: null,
    password: null,
    server: null,
    daysInPast: 0,
    daysAhead: 7,
    studentId: null,
  };

  console.log('\n' + '='.repeat(80));
  console.log('WebUntis Interactive Configuration');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Search for school or enter manually
  const searchOption = await question(rl, 'Do you want to search for your school? (y/n): ');

  if (searchOption.toLowerCase() === 'y' || searchOption.toLowerCase() === 'yes') {
    const searchTerm = await question(rl, 'Enter school name or city to search: ');
    const schools = await searchSchools(searchTerm);

    if (schools.length > 0) {
      displaySchools(schools);
      const schoolIndex = await question(rl, `\nSelect school number (1-${schools.length}) or 0 to enter manually: `);
      const index = parseInt(schoolIndex, 10) - 1;

      if (index >= 0 && index < schools.length) {
        const selectedSchool = schools[index];
        config.school = selectedSchool.loginName;
        config.server = selectedSchool.server;
        console.log(`\n✅ Selected: ${selectedSchool.displayName || selectedSchool.loginName}`);
        console.log(`   School ID: ${config.school}`);
        console.log(`   Server: ${config.server}`);
      } else {
        console.log('\nEntering school details manually...');
      }
    } else {
      console.log('\nNo schools found. Please enter school details manually.');
    }
  }

  // If school not selected from search, ask manually
  if (!config.school) {
    config.school = await question(rl, 'Enter school identifier: ');
  }

  if (!config.server) {
    config.server = await question(rl, 'Enter WebUntis server (e.g., mese.webuntis.com): ');
  }

  // Step 2: Enter credentials
  console.log('\n--- Login Credentials ---');
  config.username = await question(rl, 'Enter username: ');
  config.password = await question(rl, 'Enter password: ');

  // Step 3: Optional settings
  console.log('\n--- Optional Settings (press Enter to use defaults) ---');
  const daysAhead = await question(rl, `Days ahead to show (default: ${config.daysAhead}): `);
  if (daysAhead) {
    config.daysAhead = parseInt(daysAhead, 10) || config.daysAhead;
  }

  const daysPast = await question(rl, `Days in past to show (default: ${config.daysInPast}): `);
  if (daysPast) {
    config.daysInPast = parseInt(daysPast, 10) || config.daysInPast;
  }

  const studentId = await question(rl, 'Specific student ID (leave empty to show all students): ');
  if (studentId) {
    config.studentId = parseInt(studentId, 10);
  }

  rl.close();

  console.log('\n' + '='.repeat(80));
  console.log('Configuration Complete');
  console.log('='.repeat(80));

  return config;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format a date for display
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Format a WebUntis time (number format like 830 or 1045) to readable time
 */
function formatTime(time) {
  if (time === null || time === undefined) return 'N/A';
  const timeStr = String(time).padStart(4, '0');
  return `${timeStr.substring(0, 2)}:${timeStr.substring(2)}`;
}

/**
 * Format lesson data for display
 */
function formatLesson(lesson) {
  const subjects = lesson.su.map((s) => s.name).join(', ') || 'N/A';
  const teachers = lesson.te.map((t) => t.name).join(', ') || 'N/A';
  const rooms = lesson.ro.map((r) => r.name).join(', ') || 'N/A';
  const classes = lesson.kl.map((k) => k.name).join(', ') || 'N/A';

  return {
    date: lesson.date,
    time: `${formatTime(lesson.startTime)} - ${formatTime(lesson.endTime)}`,
    lessonNumber: lesson.lsnumber,
    subject: subjects,
    teacher: teachers,
    room: rooms,
    class: classes,
    code: lesson.code || 'regular',
    info: lesson.info || '',
    substText: lesson.substText || '',
  };
}

/**
 * Display students in a formatted table
 */
function displayStudents(students) {
  console.log('\n' + '='.repeat(80));
  console.log('ALL STUDENTS');
  console.log('='.repeat(80));
  console.log(`Total: ${students.length} students\n`);

  if (students.length === 0) {
    console.log('No students found.');
    return;
  }

  // Display header
  console.log(`${'ID'.padEnd(8)} ${'Name'.padEnd(30)} ${'First Name'.padEnd(20)} ${'Gender'.padEnd(8)}`);
  console.log('-'.repeat(80));

  // Display each student
  students.forEach((student) => {
    const id = String(student.id).padEnd(8);
    const name = (student.name || 'N/A').padEnd(30);
    const foreName = (student.foreName || 'N/A').padEnd(20);
    const gender = (student.gender || 'N/A').padEnd(8);
    console.log(`${id} ${name} ${foreName} ${gender}`);
  });

  console.log('-'.repeat(80));
}

/**
 * Display timetable in a formatted view
 */
function displayTimetable(lessons, studentId, studentName) {
  console.log('\n' + '='.repeat(80));
  console.log(`TIMETABLE FOR STUDENT: ${studentName} (ID: ${studentId})`);
  console.log('='.repeat(80));
  console.log(`Total: ${lessons.length} lessons\n`);

  if (lessons.length === 0) {
    console.log('No lessons found for this student in the specified date range.');
    return;
  }

  // Group lessons by date
  const lessonsByDate = {};
  lessons.forEach((lesson) => {
    const dateStr = String(lesson.date);
    if (!lessonsByDate[dateStr]) {
      lessonsByDate[dateStr] = [];
    }
    lessonsByDate[dateStr].push(lesson);
  });

  // Display lessons grouped by date
  Object.keys(lessonsByDate)
    .sort()
    .forEach((dateStr) => {
      // Format date as YYYY-MM-DD
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      console.log(`\n📅 ${year}-${month}-${day}`);
      console.log('-'.repeat(80));

      lessonsByDate[dateStr].forEach((lesson) => {
        const formatted = formatLesson(lesson);
        console.log(`  ⏰ ${formatted.time} | Lesson ${formatted.lessonNumber}`);
        console.log(`     📚 Subject: ${formatted.subject}`);
        console.log(`     👨‍🏫 Teacher: ${formatted.teacher}`);
        console.log(`     🚪 Room: ${formatted.room}`);
        console.log(`     👥 Class: ${formatted.class}`);

        if (formatted.code !== 'regular') {
          console.log(`     ⚠️  Code: ${formatted.code}`);
        }
        if (formatted.info) {
          console.log(`     ℹ️  Info: ${formatted.info}`);
        }
        if (formatted.substText) {
          console.log(`     📝 Substitution: ${formatted.substText}`);
        }
        console.log('');
      });
    });
}

// ============================================================================
// Main Test Function
// ============================================================================

async function runTest(CONFIG) {
  console.log('\n🚀 Starting WebUntis Standalone Test');
  console.log('='.repeat(80));
  console.log(`School: ${CONFIG.school}`);
  console.log(`Server: ${CONFIG.server}`);
  console.log(`Username: ${CONFIG.username}`);
  console.log('='.repeat(80));

  // Create WebUntis client
  const untis = new WebUntis(CONFIG.school, CONFIG.username, CONFIG.password, CONFIG.server);

  try {
    // Step 1: Login
    console.log('\n📝 Step 1: Logging in...');
    await untis.login();
    console.log('✅ Login successful!');

    // Step 2: Get all students
    console.log('\n📝 Step 2: Fetching all students...');
    const students = await untis.getStudents();
    console.log(`✅ Retrieved ${students.length} students`);

    // Display all students
    displayStudents(students);

    // Step 3: Get timetable for a specific student
    if (students.length > 0) {
      let selectedStudent;

      // If a specific student ID was provided, find that student
      if (CONFIG.studentId) {
        selectedStudent = students.find((s) => s.id === CONFIG.studentId);
        if (!selectedStudent) {
          console.log(`\n⚠️  Student with ID ${CONFIG.studentId} not found.`);
          selectedStudent = students[0];
          console.log(`   Using first student instead: ${selectedStudent.foreName} ${selectedStudent.name}`);
        }
      } else {
        // Select the first student as an example
        selectedStudent = students[0];
      }

      console.log(
        `\n📝 Step 3: Fetching timetable for student: ${selectedStudent.foreName} ${selectedStudent.name} (ID: ${selectedStudent.id})`
      );

      // Calculate date range
      const rangeStart = new Date();
      rangeStart.setDate(rangeStart.getDate() - CONFIG.daysInPast);

      const rangeEnd = new Date();
      rangeEnd.setDate(rangeEnd.getDate() + CONFIG.daysAhead);

      console.log(`   Date range: ${formatDate(rangeStart)} to ${formatDate(rangeEnd)}`);

      // Fetch timetable for the student
      // Using WebUntis.TYPES.STUDENT (value 5) as the element type
      const timetable = await untis.getTimetableForRange(rangeStart, rangeEnd, selectedStudent.id, WebUntis.TYPES.STUDENT);

      console.log(`✅ Retrieved ${timetable.length} lessons`);

      // Display the timetable
      displayTimetable(timetable, selectedStudent.id, `${selectedStudent.foreName} ${selectedStudent.name}`);

      // Additional info: Show how to view other students
      if (students.length > 1 && !CONFIG.studentId) {
        console.log('\n💡 TIP: To view timetable for other students, use the --student-id option:');
        console.log('\n   Available students:');
        students.slice(0, 5).forEach((s) => {
          console.log(`   node test-webuntis-standalone.js --student-id ${s.id}  # ${s.foreName} ${s.name}`);
        });
        if (students.length > 5) {
          console.log(`   ... and ${students.length - 5} more`);
        }
      }
    } else {
      console.log('\n⚠️  No students found. Cannot fetch timetable.');
    }

    // Step 4: Logout
    console.log('\n📝 Step 4: Logging out...');
    await untis.logout();
    console.log('✅ Logout successful!');

    console.log('\n' + '='.repeat(80));
    console.log('✅ Test completed successfully!');
    console.log('='.repeat(80));
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('❌ Error occurred:');
    console.error('='.repeat(80));
    console.error('Error message:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    console.error('\n💡 Common issues:');
    console.error('   - Check that your credentials are correct');
    console.error('   - Verify the school name and server are correct');
    console.error('   - Ensure you have network connectivity');
    console.error('   - Some WebUntis servers may require different authentication');
    console.error('='.repeat(80));
    process.exit(1);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function main() {
  const cliConfig = parseArguments();

  // Show help if requested
  if (cliConfig.help) {
    showHelp();
    process.exit(0);
  }

  // Handle school search
  if (cliConfig.searchSchool) {
    const schools = await searchSchools(cliConfig.searchSchool);
    displaySchools(schools);
    console.log('\n💡 TIP: Use the School ID and Server from above with:');
    console.log('   node test-webuntis-standalone.js --school SCHOOL_ID --server SERVER --username USER --password PASS\n');
    process.exit(0);
  }

  let config;

  // Check if all required parameters are provided via command line
  const hasAllParams = cliConfig.school && cliConfig.username && cliConfig.password && cliConfig.server;

  if (hasAllParams) {
    // Use command-line arguments
    config = cliConfig;
    console.log('📋 Using command-line arguments...');
  } else if (process.argv.length > 2) {
    // Some arguments provided but not all required ones
    console.error('❌ Error: Missing required parameters.\n');
    console.error('When using command-line arguments, you must provide:');
    console.error('  --school, --username, --password, --server\n');
    console.error('Or run without arguments for interactive mode.\n');
    showHelp();
    process.exit(1);
  } else {
    // No arguments provided, use interactive mode
    console.log('🎯 Starting interactive mode...');
    config = await interactiveMode();
  }

  // Validate configuration
  if (!config.school || !config.username || !config.password || !config.server) {
    console.error('❌ Error: Missing required configuration.');
    process.exit(1);
  }

  // Run the test
  await runTest(config);
}

// Run main function
main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
