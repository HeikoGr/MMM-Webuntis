const NodeHelper = require("node_helper");
const WebUntis = require("webuntis");
const WebUntisQR = require('webuntis').WebUntisQR;
const URL = require('url').URL;
const Authenticator = require('otplib').authenticator;
const Log = require("logger");

module.exports = NodeHelper.create({
    // Start function is called when the helper is initialized
    start: function () {
        Log.info("[MMM-Webuntis] Node helper started");
    },

    // Function to handle socket notifications
    socketNotificationReceived: async function (notification, payload) {
        if (notification === "FETCH_DATA") {
            this.config = payload;

            try {
                // every student needs its own Untis instance
                for (const student of this.config.students) {
                    let untis;

                    let identifier = this.config.id;
                    let days = this.config.days;
                    let examsDays = this.config.examsDays;
                    let debugLastDays = this.config.debugLastDays;

                    if (student.qrcode) {
                        // Create a WebUntisQR instance if QR code is provided
                        untis = new WebUntisQR(student.qrcode, 'custom-identity', Authenticator, URL);
                    } else if (student.username) {
                        // Create a WebUntis instance if username and password are provided
                        untis = new WebUntis(student.school, student.username, student.password, student.server);
                    }

                    untis.login()
                        .then(() => this.fetchData(untis, student, days, debugLastDays, identifier))
                        .then(() => untis.logout())
                        .catch(error => {
                            console.error("[MMM-Webuntis] Error:", error);
                        });
                }
                Log.info("[MMM-Webuntis] Successfully fetched data");
            } catch (error) {
                Log.error("[MMM-Webuntis] Error loading Untis data: ", error);
            }
        }
    },

    fetchData: async function (untis, student, days, debugLastDays, identifier) {

        var lessons = [];
        var exams = [];
        var startTimes = [];

        // Validate the number of days
        if (days < 1 || days > 10 || isNaN(days)) { days = 1; }

        var rangeStart = new Date(Date.now());
        var rangeEnd = new Date(Date.now());
        rangeStart.setDate(rangeStart.getDate() - debugLastDays);
        rangeEnd.setDate(rangeStart.getDate() + days);

        try {
            let timetable;

            untis.getTimegrid()
                .then(grid => {
                    // use grid of first day and assume all days are the same
                    // used to get the numbers of the time units
                    grid[0].timeUnits.forEach(element => { startTimes[element.startTime] = element.name; })
                })
                .catch(error => {
                    console.log("Error in getTimegrid: " + error);
                })

            if (student.useClassTimetable) {
                timetable = await untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
            } else {
                timetable = await untis.getOwnTimetableForRange(rangeStart, rangeEnd);
            }
            lessons = this.timetableToLessons(startTimes, timetable);

        } catch (error) {
            console.log("[MMM-Webuntis] ERROR for " + student.title + ": " + error.toString());
        }

        
        if (student.fetchExams) {

            // Validate the number of days
            if (student.examsDays < 1 || student.examsDays > 360 || isNaN(student.examsDays)) { student.examsDays = 30; }

            var rangeStart = new Date(Date.now());
            var rangeEnd = new Date(Date.now());
            rangeEnd.setDate(rangeStart.getDate() + student.examsDays);

            try {
                //let exams;
                exams = await untis.getExamsForRange(rangeStart, rangeEnd);
                exams = this.examsToFlat(exams);

            } catch (error) {
                console.log("ERROR for " + student.title + ": " + error.toString());
            };
        }
    

        this.sendSocketNotification("GOT_DATA", { title: student.title, lessons: lessons, exams: exams, id: identifier });
},

    timetableToLessons: function (startTimes, timetable) {
        var lessons = [];

        timetable.forEach(element => {
            let lesson = {
                year: element.date.toString().substring(0, 4),
                month: element.date.toString().substring(4, 6),
                day: element.date.toString().substring(6, 8),
                hour: element.startTime.toString().padStart(4, "0").substring(0, 2),
                minutes: element.startTime.toString().padStart(4, "0").substring(2),
                startTime: element.startTime.toString().padStart(4, "0"),
                teacher: element.te[0]?.longname || "N/A",
                teacherInitial: element.te[0]?.name || "N/A",
                subject: element.su[0]?.longname || "N/A",
                subjectShort: element.su[0]?.name || "N/A",
                code: element.code || "",
                text: element.lstext || "",
                substText: element.substText || "",
                lessonNumber: startTimes[element.startTime],
            };

            // Set code to "info" if there is an "substText" from WebUntis to display it if configuration "showRegularLessons" is set to false
            if (lesson.substText != "" && lesson.code == "") {
                lesson.code = "info";
            }

            // Create sort string
            lesson.sortString = lesson.year + lesson.month + lesson.day + lesson.hour + lesson.minutes;
            switch (lesson.code) {
                case "cancelled": lesson.sortString += "1"; break;
                case "irregular": lesson.sortString += "2"; break;
                case "info": lesson.sortString += "3"; break;
                default: lesson.sortString += "9";
            }

            lessons.push(lesson);
        });
        return lessons;
    },

    examsToFlat: function (exams) {
        var ret_exams = [];

        exams.forEach(element => {
            let exam = {
                year: element.examDate.toString().substring(0, 4),
                month: element.examDate.toString().substring(4, 6),
                day: element.examDate.toString().substring(6, 8),
                startTime: element.startTime.toString().padStart(4, "0"),
                teacher: element.teachers[0] || "N/A",
                subject: element.subject || "N/A",
                name: element.name || "",
                text: element.text || "",
                sortString: ""
            };

            // Create sort string
            exam.sortString = exam.year + exam.month + exam.day;

            ret_exams.push(exam);
        });
        return ret_exams;
    }
})