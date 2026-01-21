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
  logLevel: ['INFO', 'LOG', 'WARN', 'ERROR', 'DEBUG'],
  modules: [
    { module: 'alert' },
    { module: 'clock', position: 'top_left' },

    {
      disabled: true,
      module: 'MMM-Webuntis',
      header: 'QRCODE TEST',
      position: 'top_right',
      config: {
        carouselId: 'wu1',
        updateInterval: 3 * 60 * 1000,
        logLevel: 'debug',
        dumpBackendPayloads: true, // dump raw payloads from backend in ./debug_dumps/ folder
        dumpRawApiResponses: true, // when true, save raw REST API responses to ./debug_dumps/raw_api_*.json

        //username: 'heiko.grossstueck@gmail.com',
        //password: 'AqP5SR7kxj&',
        //school: 'bachgymnasium',
        //server: 'bachgymnasium.webuntis.com',

        displayMode: 'grid',

        students: [
          //{
          //  title: "Frieda",
          //  //studentId: 7211,
          //  qrcode: "untis://setschool?url=bachgymnasium.webuntis.com&school=bachgymnasium&user=GroßstFri1&key=FKGSOF76QSJ5IFXN&schoolNumber=4223100",
          //},
          {
            title: 'Merle',
            //studentId: 1774,
            qrcode:
              'untis://setschool?url=bachgymnasium.webuntis.com&school=bachgymnasium&user=GrossMer&key=7ACAX2RM4NW6MUKU&schoolNumber=4223100',
          },
        ],
      },
    },

    {
      disabled: true,
      module: 'MMM-Webuntis',
      classes: 'messagesofday',
      header: 'Nachrichten des Tages',
      position: 'top_bar',
      config: {
        carouselId: 'wu2',

        updateInterval: 5 * 60 * 1000,

        username: 'heiko.grossstueck@gmail.com',
        password: 'AqP5SR7kxj&',
        school: 'bachgymnasium',
        server: 'bachgymnasium.webuntis.com',

        displayMode: 'messagesofday',

        students: [
          {
            title: 'Merle',
            studentId: 1774,
            // qrcode: "untis://setschool?url=bachgymnasium.webuntis.com&school=bachgymnasium&user=GrossMer&key=7ACAX2RM4NW6MUKU&schoolNumber=4223100",
          },
        ],
      },
    },

    {
      disabled: false,
      module: 'MMM-Webuntis',
      header: 'Stundenplanänderungen und Termine für Arbeiten von Merle',
      position: 'top_left',
      classes: 'wu_left',
      config: {
        carouselId: 'wu3',

        updateInterval: 5 * 60 * 1000,

        username: 'heiko.grossstueck@gmail.com',
        password: 'AqP5SR7kxj&',
        school: 'bachgymnasium',
        server: 'bachgymnasium.webuntis.com',

        displayMode: 'grid, exams, homework, absences',
        grid: {
          maxLessons: 9, // max lessons per day (0 = no limit)

          // === FLEXIBLE FIELD DISPLAY ===
          fields: {
            mode: 'custom',
            primary: 'subject',
            secondary: 'room',
            additional: ['teacher', 'studentGroup'],
            format: {
              subject: 'long',
              teacher: 'short',
              room: 'short',
              studentGroup: 'short',
            },
          },
        },

        students: [
          {
            title: 'Merle',
            studentId: 1774,
            // qrcode: "untis://setschool?url=bachgymnasium.webuntis.com&school=bachgymnasium&user=GrossMer&key=7ACAX2RM4NW6MUKU&schoolNumber=4223100",
          },
        ],
      },
    },
  ],
};

/* global module */
if (typeof module !== 'undefined') {
  module.exports = config;
}
