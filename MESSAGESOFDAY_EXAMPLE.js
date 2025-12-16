/**
 * Example configurations for `MMM-Webuntis` (MessagesOfDay)
 * Insert into your `config/config.js` if you want ready-to-use examples.
 */

const EXAMPLE_MESSAGESOFDAY_FULL = {
  module: 'MMM-Webuntis',
  position: 'top_right',
  header: 'WebUntis',
  config: {
    logLevel: 'info',
    fetchIntervalMs: 15 * 60 * 1000, // 15 minutes
    daysToShow: 7,
    // Enable the MessagesOfDay widget
    displayMode: 'messagesofday,lessons,exams,homework,absences',
    students: [
      {
        title: 'Mein Kind',
        qrcode: 'untis://setschool?...', // replace with your QR code
        // or use username/password:
        // school: 'schoolname',
        // username: 'student.username',
        // password: 'password',
        // server: 'mese.webuntis.com'
      },
    ],
  },
};

const EXAMPLE_MESSAGESOFDAY_SIMPLE = {
  module: 'MMM-Webuntis',
  position: 'top_right',
  header: 'Nachrichten des Tages',
  config: {
    displayMode: 'messagesofday', // only MessagesOfDay
    students: [
      {
        title: 'Schule',
        qrcode: 'untis://setschool?...',
      },
    ],
  },
};

module.exports = {
  EXAMPLE_MESSAGESOFDAY_FULL,
  EXAMPLE_MESSAGESOFDAY_SIMPLE,
};
