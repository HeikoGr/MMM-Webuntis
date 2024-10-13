const path = require('path');
const webuntis = require("webuntis");

function showConfig(fileName) {

    const filePath = path.resolve(fileName);
    console.log("checking config file ", filePath);

    const contents = require(filePath);
    contents.modules
        .filter((m) => m.module === "MMM-Webuntis")
        .forEach((m) => {
            console.log("module config found:");
            m.config.students
                .forEach((s) => {
                    console.log("student config found:");
                    console.log(s);
                    const untis = new webuntis(s.school, s.username, s.password, s.server);
                    console.log("fetching timetable:");
                    untis
                        .login()
                        .then(() => {
                            return untis.getOwnTimetableForToday();
                        })
                        .then((timetable) => {
                            // console.log(JSON.stringify(timetable, null, 2));
                            timetable.forEach((e) => console.log("* ", e.date, e.startTime, "-", e.endTime, e.activityType));
                        })
                        .catch((error) => {
                            console.error(error);
                        })
                })
        });
}

const fileName = process.argv[2];
if (!fileName) {
    console.error('specify a config file, usually config/config.js');
    process.exit(1);
}

showConfig(fileName);
