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
        header: 'Timetable',
        fetchIntervalMs: 15 * 60 * 1000, // 15 minutes
        logLevel: 'debug',

        // === DISPLAY OPTIONS ===
        displayMode: 'list', // 'list', 'grid', or comma-separated: 'lessons,exams,grid'
        mode: 'verbose', // 'verbose' or 'compact'

        // === TIMETABLE FETCH RANGE ===
        daysToShow: 7,
        pastDaysToShow: 0,

        // === LESSONS WIDGET ===
        showStartTime: false,
        showRegularLessons: false,
        showTeacherMode: 'full',
        useShortSubject: false,
        showSubstitutionText: false,

        // === EXAMS WIDGET ===
        examsDaysAhead: 21,
        showExamSubject: true,
        showExamTeacher: true,

        // === GRID VIEW ===
        mergeGapMinutes: 15,
        maxGridLessons: 0,
        showNowLine: true,

        // === ABSENCES ===
        absencesPastDays: 21,
        absencesFutureDays: 7,
        // Structured per-widget formats (preferred)
        dateFormats: {
          // (optional) - defaults to 'dd.MM.' if not set
          default: 'dd.MM.', // set default
          lessons: 'EEE', // weekday only (e.g., "Mon")
          grid: 'EEE dd.MM.', // (optional) override for grid
          exams: 'dd.MM.', // (optional) override for exams
          homework: 'dd.MM.', // (optional) override for homework
          absences: 'dd.MM.', // (optional) override for absences
        },

        // Per-widget namespaces (new preferred structure)
        lessons: {
          dateFormat: 'EEE',
          showStartTime: false,
          showRegularLessons: false,
          useShortSubject: false,
          showTeacherMode: 'full',
          showSubstitutionText: false,
        },

        grid: {
          dateFormat: 'EEE dd.MM.',
          mergeGapMinutes: 15,
          maxGridLessons: 0,
          showNowLine: true,
        },

        exams: {
          dateFormat: 'dd.MM.',
          examsDaysAhead: 21,
          showExamSubject: true,
          showExamTeacher: true,
        },

        homework: {
          dateFormat: 'dd.MM.',
        },

        absences: {
          dateFormat: 'dd.MM.',
          absencesPastDays: 21,
          absencesFutureDays: 7,
        },

        messagesofday: {},
        // Minimal example: override only absences format without specifying whole object
        // dateFormats: { absences: 'd.M.yyyy' },

        // === TIMETABLE SOURCE ===
        useClassTimetable: false,

        // === PARENT ACCOUNT SUPPORT (optional) ===
        // Uncomment to use parent account credentials for multiple children:
        // username: 'parent@example.com',
        // password: 'password',
        // school: 'school_name',
        // server: 'webuntis.com',

        // === DEBUG OPTIONS (optional) ===
        // dumpBackendPayloads: false, // dump API responses to debug_dumps/

        // === STUDENTS ===
        students: [
          {
            title: 'Alice',
            qrcode: 'untis://setschool?url=https://example.webuntis.com&school=example&user=alice&key=ABC123',
            // OR use direct credentials if no QR code:
            // username: 'alice@example.com',
            // password: 'password',
            // school: 'example',
            // server: 'example.webuntis.com',
          },
          // Example with parent account (requires parentUsername/parentPassword above):
          // {
          //   title: 'Child 1',
          //   studentId: 12345,
          // },
        ],
      },
    },
  ],
};

if (typeof module !== 'undefined') {
  module.exports = config;
}
