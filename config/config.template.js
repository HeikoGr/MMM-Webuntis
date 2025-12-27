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
        // Use `nextDays` and `pastDays` (preferred). Legacy keys `daysToShow`/`pastDaysToShow` are still accepted.
        // Set `debugDate` to a YYYY-MM-DD string to freeze "today" for debugging (null = disabled).
        debugDate: null,
        nextDays: 7,
        pastDays: 0,

        // === LESSONS WIDGET ===
        showStartTime: false,
        showRegular: false,
        showTeacherMode: 'full',
        useShortSubject: false,
        showSubstitution: false,

        // === EXAMS WIDGET ===
        daysAhead: 21,
        showSubject: true,
        showTeacher: true,

        // === GRID VIEW ===
        mergeGap: 15,
        maxLessons: 0,
        showNowLine: true,

        // === ABSENCES ===
        // Per-widget absences options are provided in the `absences` namespace below.
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
          showRegular: false,
          useShortSubject: false,
          showTeacherMode: 'full', // 'off'|'initial'|'full'
          showSubstitution: false,
          nextDays: 7, // (optional) widget-specific days ahead
        },

        grid: {
          dateFormat: 'EEE dd.MM.',
          mergeGap: 15,
          maxLessons: 0,
          showNowLine: true,
          nextDays: 1, // (optional) widget-specific days ahead
          pastDays: 0, // (optional) widget-specific days past
        },

        exams: {
          dateFormat: 'dd.MM.',
          daysAhead: 21,
          showSubject: true,
          showTeacher: true,
        },

        homework: {
          dateFormat: 'dd.MM.',
          showSubject: true, // (optional) show subject name with homework
          showText: true, // (optional) show homework description/text
          nextDays: 28, // (optional) widget-specific days ahead
          pastDays: 0, // (optional) widget-specific days past
        },

        absences: {
          dateFormat: 'dd.MM.',
          pastDays: 21, // days in the past to show
          futureDays: 7, // days in the future to show
          showDate: true, // (optional) show absence date
          showExcused: true, // (optional) show excused/unexcused status
          showReason: true, // (optional) show reason for absence
          maxItems: null, // (optional) max number of absence entries to show (null = no limit)
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
