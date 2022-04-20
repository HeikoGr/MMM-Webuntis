const NodeHelper = require("node_helper");
const WebUntis = require("webuntis");

module.exports = NodeHelper.create({
	start: function() {
	},

	socketNotificationReceived: function(notification, payload) {

		if (notification === "FETCH_DATA") {

			// iterate through students, fetch and send lessons
			for (let i in payload.students) {
				var student = payload.students[i];
				if (student.username !== "") {
					this.fetchLessonsLogin(student, payload.days);
				}
				else if (student.class !== "") {
					this.fetchLessonsAnonymous(student, payload.days);
				}
				else {
					console.log("Error: Student '" + student.title + "' has an configuration error!");
				}
			}
		}
	},

	fetchLessonsLogin: function(studentData, days) {

		const untis = new WebUntis(
			studentData.school,
			studentData.username,
			studentData.password,
			studentData.server
		);

		if (days<1 || days>10 || isNaN(days)) {days = 1;}

		// create lessons array to be sent to module
		var lessons = [];

		// array to get lesson number by start time
		var startTimes = [];

		untis
			.login()
			.then(response => {
				var rangeStart = new Date();
				var rangeEnd = new Date();
				rangeEnd.setDate(rangeStart.getDate()+days);

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

				return untis.getOwnTimetableForRange(rangeStart, rangeEnd);
			})
			.then(timetable => {
				lessons = timetableToLessons(timetable);
				this.sendSocketNotification("GOT_DATA", {title: studentData.title, lessons: lessons});
			})
			.catch(error => {
				console.log("ERROR for " + studentData.title + ": " + error.toString());
				/*
				let today = new Date();
				let errorObject = [ {
					year: today.getFullYear(),
					month: today.getMonth()+1,
					day: today.getDate(),
					hour: today.getHours(),
					minutes: today.getMinutes(),
					subject: "ERROR",
					teacher: error.toString(),
					code: "error"
				} ];
        		this.sendSocketNotification("GOT_DATA", {title: studentData.title, lessons: errorObject});
        		*/
			});

		untis.logout();
	},
	fetchLessonsAnonymous: function(studentData, days) {

		const untis = new WebUntis.WebUntisAnonymousAuth(
			studentData.school,
			studentData.server
		);

		if (days<1 || days>10 || isNaN(days)) {days = 1;}

		// create lessons array to be sent to module
		var lessons = [];

		// array to get lesson number by start time
		var startTimes = [];

		var classid = -1;

		untis
			.login()
			.then(() => {
				return untis.getClasses();
			})
			.then((classes) => {
				// Get timetable for the first class
				for (let i in classes) {
					if (classes[i].name === studentData.class){
						classid = classes[i].id;
						break;
					}
				}
				if (classid === -1) {
					console.error("ERROR for" + studentData.title + ": Class not found!");
				}
			})
			.then(response => {
				var rangeStart = new Date();
				var rangeEnd = new Date();
				rangeEnd.setDate(rangeStart.getDate()+days);

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
				//return untis.getTimetableForToday(classid, WebUntis.TYPES.CLASS);
				return untis.getTimetableForRange(rangeStart, rangeEnd, classid, WebUntis.TYPES.CLASS);
			})
			.then(timetable => {
				lessons = timetableToLessons(timetable);
				this.sendSocketNotification("GOT_DATA", {title: studentData.title, lessons: lessons});
			})
			.catch(error => {
				console.log("ERROR for " + studentData.title + ": " + error.toString());
				/*
				let today = new Date();
				let errorObject = [ {
					year: today.getFullYear(),
					month: today.getMonth()+1,
					day: today.getDate(),
					hour: today.getHours(),
					minutes: today.getMinutes(),
					subject: "ERROR",
					teacher: error.toString(),
					code: "error"
				} ];
        		this.sendSocketNotification("GOT_DATA", {title: studentData.title, lessons: errorObject});
        		*/
			});

		untis.logout();
	},
	timetableToLessons: function(timetable) {
		var lessons = [];
		timetable.forEach(element => {
			let lesson = {};
			let year = element.date.toString().substring(0,4);
			let month = element.date.toString().substring(4,6);
			let day = element.date.toString().substring(6);
			let hour = element.startTime.toString();
			hour.length == 3 ? hour = "0"+hour.substring(0,1) : hour = hour.substring(0,2);
			let minutes = element.startTime.toString()
			minutes = minutes.substring(minutes.length-2);
			lesson.sortString = element.date + hour + minutes;
			switch (element.code) {
			case "cancelled": lesson.sortString += "1"; break;
			case "irregular": lesson.sortString += "2"; break;
			default: lesson.sortString += "9";
			}
			lesson.year = year;
			lesson.month = month;
			lesson.day = day;
			lesson.hour = hour;
			lesson.minutes = minutes;
			lesson.lessonNumber = startTimes[element.startTime];
			element.su[0] ? lesson.subject = element.su[0].longname : lesson.subject = "";
			element.te ? lesson.teacher = element.te[0].longname : lesson.teacher = "";
			element.code ? lesson.code = element.code : lesson.code = "";
			element.lstext ? lesson.text = element.lstext : lesson.text = "";
			element.substText ? lesson.substText = element.substText : lesson.substText = "";

			lessons.push(lesson);
		});

		return lessons;
	},

})
