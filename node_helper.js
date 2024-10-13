const NodeHelper = require("node_helper");
const WebUntis = require("webuntis");
const WebUntisQR = require('webuntis').WebUntisQR;
const URL = require('url').URL;
const Authenticator = require('otplib').authenticator;

module.exports = NodeHelper.create({
		start: function () {
	},

	socketNotificationReceived: function (notification, payload) {

		if (notification === "FETCH_DATA") {

			//Copy and save config
			this.config = payload;

			// iterate through students, fetch and send lessons
			for (let i in this.config.students) {
				var student = this.config.students[i];
				this.fetchLessons(student, this.config.days);
			}
		}
	},

	fetchLessons: function (studentData, days) {

		// create lessons array to be sent to module
		var lessons = [];

		// array to get lesson number by start time
		var startTimes = [];

		let untis;

		if (studentData.qrcode) {
			untis = new WebUntisQR(studentData.qrcode, 'custom-identity', Authenticator, URL);
		}
		else if (studentData.username) {
			untis = new WebUntis(studentData.school, studentData.username, studentData.password, studentData.server);
		}
		else if (studentData.class) {
			untis = new WebUntis.WebUntisAnonymousAuth(studentData.school, studentData.server);
		}
		else {
			console.log("Error: Student '" + studentData.title + "' has an configuration error!");
			return;
		}

		if (days < 1 || days > 10 || isNaN(days)) { days = 1; }

		untis
			.login()
			.then(response => {
				var rangeStart = new Date(Date.now());
				var rangeEnd = new Date(Date.now());
				rangeEnd.setDate(rangeStart.getDate() + days);

				untis.getTimegrid()
					.then(grid => {
						// use grid of first day and assume all days are the same
						grid[0].timeUnits.forEach(element => {
							startTimes[element.startTime] = element.name;
						})

					})
					.catch(error => {
						console.log("Error in getTimegrid: " + error);
					})
				if (studentData.useClassTimetable) {
					return untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
				} else {
					return untis.getOwnTimetableForRange(rangeStart, rangeEnd);
				}
			})
			.then(timetable => {
				lessons = this.timetableToLessons(startTimes, timetable);
				this.sendSocketNotification("GOT_DATA", { title: studentData.title, lessons: lessons });
			})
			.catch(error => {
				console.log("ERROR for " + studentData.title + ": " + error.toString());
			});

		untis.logout();
	},

	timetableToLessons: function (startTimes, timetable) {
		var lessons = [];
		timetable.forEach(element => {
			let lesson = {};

			// Parse date and time information
			lesson.year = element.date.toString().substring(0, 4);
			lesson.month = element.date.toString().substring(4, 6);
			lesson.day = element.date.toString().substring(6);
			lesson.hour = element.startTime.toString();
			lesson.hour = (lesson.hour.length == 3 ? ("0" + lesson.hour.substring(0, 1)) : lesson.hour.substring(0, 2));
			lesson.minutes = element.startTime.toString();
			lesson.minutes = lesson.minutes.substring(lesson.minutes.length - 2);

			// Parse lesson number by start time
			lesson.lessonNumber = startTimes[element.startTime];

			// Parse data about teacher
			if (element.te) {
				lesson.teacher = element.te[0].longname;
				lesson.teacherInitial = element.te[0].name;
			}
			else {
				lesson.teacher = "";
				lesson.teacherInitial = "";
			}

			// Parse data about subject
			if (element.su[0]) {
				lesson.subject = element.su[0].longname;
				lesson.subjectShort = element.su[0].name;
			}
			else {
				lesson.subject = "";
				lesson.subjectShort = "";
			}

			// Parse other information
			lesson.code = element.code ? element.code : "";
			lesson.text = element.lstext ? element.lstext : "";
			lesson.substText = element.substText ? element.substText : "";

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

		if (this.config.debug) {
			console.log("MMM-Webuntis: Timetable and Lessons: ", JSON.stringify({ timetable: timetable, lessons: lessons }));
		}

		return lessons;
	},

})
