/**
 * Example MagicMirror configuration for MMM-Webuntis.
 * Copy this file to `config.js` inside the same folder and adjust
 * credentials/settings as needed.
 *
 * For detailed option documentation, see:
 * - MMM-Webuntis.js (defaults object)
 * - README.md (Configuration options section)
 */
let config = {
  address: '0.0.0.0',
  port: 8080,
  basePath: '/',
  ipWhitelist: [],
  useHttps: false,
  language: 'en',
  timeFormat: 24,
  units: 'metric',
  modules: [
    { module: 'alert' },
    { module: 'clock', position: 'top_left' },
    {
      module: 'MMM-Webuntis',
      position: 'top_right',
      config: {
        // === GLOBAL OPTIONS ===
        header: 'Timetable', // optional header text
        updateInterval: 5 * 60 * 1000, // fetch interval in milliseconds (default: 5 minutes)

        // === DEBUG OPTIONS ===
        logLevel: 'none', // 'none', 'error', 'warn', 'info', 'debug'
        debugDate: null, // set to 'YYYY-MM-DD' to freeze "today" for debugging (null = disabled)
        dumpBackendPayloads: false, // dump raw payloads from backend in ./debug_dumps/ folder
        dumpRawApiResponses: false, // when true, save raw REST API responses to ./debug_dumps/raw_api_*.json
        timezone: 'Europe/Berlin', // timezone for date calculations (important for schools outside UTC)

        // === DISPLAY OPTIONS ===
        displayMode: 'lessons, exams', // comma-separated list: lessons, exams, grid, homework, absences, messagesofday
        mode: 'verbose', // 'verbose' (per-student sections) or 'compact' (combined view)

        // === AUTHENTICATION ===
        // username: 'your username', // WebUntis username (leave empty if using studentId/qrcode)
        // password: 'your password', // WebUntis password (leave empty if using studentId/qrcode)
        // school: 'your school',     // WebUntis school name (most likely subdomain)
        // server: 'schoolserver.webuntis.com',  // WebUntis server URL (usually subdomain.webuntis.com)

        // === STUDENTS ===
        students: [
          {
            title: 'Student',
            studentId: 0,
            qrcode: 'untis://setschool?url=example.webuntis.com&school=example&user=<user>&key=<key>',
            // OR use direct credentials if no QR code:
            // username: 'user@example.com',
            // password: '<password>',
            // school: 'example',
            // server: 'example.webuntis.com', without https://
          },
          // Example with parent account (requires parentUsername/parentPassword at config level):
          // {
          //   title: 'Child 1',
          //   studentId: 12345,
          // },
        ],

        // === WIDGET NAMESPACED DEFAULTS ===
        // Per-widget configuration namespaces
        lessons: {
          nextDays: 2, // widget-specific days ahead
          dateFormat: 'EEE', // format for lesson dates
          showStartTime: false, // show lesson start time instead of timeunit
          showRegular: false, // show also regular lessons
          useShortSubject: false, // use short subject names
          showTeacherMode: 'full', // 'off'|'initial'|'full'
          showSubstitution: false, // show substitution info
        },

        grid: {
          nextDays: 2, // widget-specific days ahead
          pastDays: 0, // widget-specific days past
          weekView: false, // show Monday-Friday calendar week (overrides nextDays/pastDays; auto-advances on Friday after last lesson)
          dateFormat: 'EEE dd.MM.', // format for grid dates
          showNowLine: true, // show current time line
          mergeGap: 15, // minutes gap to merge adjacent lessons
          maxLessons: 0, // max lessons per day (0 = no limit)

          // === FLEXIBLE FIELD DISPLAY ===
          // Optional: customize which fields to show in grid cells
          // (defaults are defined in MMM-Webuntis.js)
          // fields: {
          //   primary: 'subject',    // Main field (first line)
          //   secondary: 'teacher',  // Secondary field (second line)
          //   additional: ['room'],  // Additional fields shown as badges/parentheses
          //   format: {              // Display format: 'short' (abbreviation) or 'long' (full name)
          //     subject: 'short',
          //     teacher: 'short',
          //     class: 'short',
          //     room: 'short',
          //     studentGroup: 'short',
          //   },
          // },
        },

        exams: {
          nextDays: 21, // widget-specific days ahead
          dateFormat: 'EEE dd.MM.', // format for exam dates
          showSubject: true, // show subject name with exam
          showTeacher: true, // show teacher name with exam
        },

        homework: {
          nextDays: 28, // widget-specific days ahead
          pastDays: 0, // widget-specific days past
          dateFormat: 'EEE dd.MM.', // format for homework dates
          showSubject: true, // show subject name with homework
          showText: true, // show homework description/text
        },

        absences: {
          pastDays: 21, // days in the past to show
          nextDays: 7, // days in the future to show
          dateFormat: 'EEE dd.MM.', // format for absence dates
          showDate: true, // show absence date
          showExcused: true, // show excused/unexcused status
          showReason: true, // show reason for absence
          maxItems: null, // max number of absence entries to show (null = no limit)
        },

        messagesofday: {}, // no specific defaults yet
      },
    },
  ],
};

if (typeof module !== 'undefined') {
  module.exports = config;
}
