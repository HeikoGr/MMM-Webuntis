const path = require('path');
const process = require('process');
const { WebUntis } = require('webuntis');
const { WebUntisQR } = require('webuntis');
const { URL } = require('url');
const Authenticator = require('otplib').authenticator;

function showConfig(fileName) {
  const filePath = path.resolve(fileName);
  console.log('checking config file ', filePath);

  const contents = require(filePath);
  contents.modules
    .filter((m) => m.module === 'MMM-Webuntis')
    .forEach((m) => {
      console.log('module config found:');
      m.config.students.forEach((s) => {
        console.log('student config found:');
        console.log(s);
        let untis;
        if (s.qrcode) {
          untis = new WebUntisQR(s.qrcode, 'custom-identity', Authenticator, URL);
        } else {
          untis = new WebUntis(s.school, s.username, s.password, s.server);
        }
        console.log('fetching timetable:');
        untis
          .login()
          .then(() => untis.getOwnTimetableForToday())
          .then((timetable) => {
            // console.log(JSON.stringify(timetable, null, 2));
            timetable.forEach((e) => console.log('* ', e.date, e.startTime, '-', e.endTime, e.activityType));
          })
          .catch((error) => {
            console.error(error);
          });
      });
    });
}

const fileName = process.argv[2];
if (!fileName) {
  throw new Error('specify a config file, usually config/config.js');
}

showConfig(fileName);
