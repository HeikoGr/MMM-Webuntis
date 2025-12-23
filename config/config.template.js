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
        logLevel: 'none',

        // === DISPLAY OPTIONS ===
        displayMode: 'list', // 'list', 'grid', or comma-separated: 'lessons,exams,grid'
        mode: 'verbose', // 'verbose' or 'compact'

        // === TIMETABLE FETCH RANGE ===
        daysToShow: 7,
        pastDaysToShow: 0,

        // === LESSONS WIDGET ===
        showStartTime: false,
        showRegularLessons: true,
        showTeacherMode: 'full',
        useShortSubject: false,
        showSubstitutionText: false,

        // === EXAMS WIDGET ===
        examsDaysAhead: 7,
        showExamSubject: true,
        showExamTeacher: true,

        // === GRID VIEW ===
        mergeGapMinutes: 15,
        maxGridLessons: 0,
        showNowLine: true,

        // === ABSENCES ===
        absencesPastDays: 14,
        absencesFutureDays: 7,

        // === DATE FORMATS ===
        dateFormat: 'dd.MM.',
        examDateFormat: 'dd.MM.',
        homeworkDateFormat: 'dd.MM.',

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
