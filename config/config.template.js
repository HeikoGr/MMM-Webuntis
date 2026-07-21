/**
 * Example MagicMirror configuration for MMM-Webuntis.
 * Copy this file to `config.js` inside the same folder and adjust
 * credentials/settings as needed.
 *
 * For detailed option documentation, see:
 * - MMM-Webuntis.js (module-level defaults)
 * - plugin backend.js files under plugins/ (plugin-local defaults)
 * - the GitHub wiki (installation, configuration, plugins, troubleshooting)
 */
const config = {
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
      module: 'MMM-Cursor',
      config: {
        timeout: 1500,
      },
    },
    {
      module: 'MMM-Webuntis',
      position: 'top_right',
      config: {
        // === GLOBAL OPTIONS ===
        header: 'Timetable', // optional header text
        updateInterval: 5 * 60 * 1000, // fetch interval in milliseconds (default: 5 minutes)

        // === DEBUG OPTIONS ===
        logLevel: 'none', // 'none', 'error', 'warn', 'info', 'debug'
        debugDate: null, // set to 'YYYY-MM-DD' to freeze the calendar day for debugging (null = disabled)
        demoDataFile: null, // optional: local fixture JSON path (e.g. 'demo/fixtures/single-student-week.json') to run frontend-only demo mode
        initRetryTimeout: 5000, // retry timeout for missing MODULE_READY during startup (milliseconds)
        initRetryMaxAttempts: 4, // max startup CONFIGURE attempts before waiting for next trigger
        dumpBackendPayloads: false, // dump raw payloads from backend in ./debug_dumps/ folder
        dumpRawApiResponses: false, // when true, save raw REST API responses to ./debug_dumps/raw_api_*.json
        timezone: 'Europe/Berlin', // timezone for date calculations (important for schools outside UTC)

        // === DISPLAY OPTIONS ===
        displayMode: 'lessons, exams', // comma-separated list: lessons, exams, grid, homework, absences, messagesofday
        mode: 'verbose', // 'verbose' (per-student sections) or 'compact' (combined view)
        useClassTimetable: false,

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

        // === CANONICAL PLUGIN CONFIG ===
        // Configure plugins under plugins.<id>.config.
        // Top-level legacy plugin namespaces remain compatibility input only.
        plugins: {
          lessons: {
            enabled: true,
            config: {
              nextDays: 2,
              pastDays: 0,
              dateFormat: 'EEEE',
              hideWeekends: false,
              showStartTime: false,
              showRegular: false,
              useShortSubject: false,
              showTeacherMode: 'full',
              showRoom: false,
              showSubstitution: false,
              naText: 'N/A',
            },
          },
          exams: {
            enabled: true,
            config: {
              nextDays: 21,
              pastDays: 0,
              dateFormat: 'EEE dd.MM.',
              showSubject: true,
              showTeacher: true,
            },
          },
          homework: {
            enabled: false,
            config: {
              nextDays: 28,
              pastDays: 0,
              dateFormat: 'EEE dd.MM.',
              showSubject: true,
              showText: true,
            },
          },
          absences: {
            enabled: false,
            config: {
              pastDays: 21,
              nextDays: 7,
              dateFormat: 'EEE dd.MM.',
              showDate: true,
              showExcused: true,
              showReason: true,
              maxItems: null,
            },
          },
          messagesofday: {
            enabled: false,
            config: {},
          },
          grid: {
            enabled: false,
            config: {
              nextDays: 4,
              pastDays: 0,
              weekView: false,
              dateFormat: 'EEE dd.MM.',
              hideWeekends: false,
              showNowLine: true,
              mergeGap: 15,
              maxLessons: 0,
              naText: 'N/A',
              fields: {
                primary: 'subject',
                secondary: 'teacher',
                additional: ['room'],
                format: {
                  subject: 'long',
                  teacher: 'long',
                  class: 'short',
                  room: 'short',
                  studentGroup: 'short',
                },
              },
            },
          },
        },
      },
    },
  ],
};

if (typeof module !== 'undefined') {
  module.exports = config;
}
