const NodeHelper = require("node_helper");
const WebUntis = require("webuntis");

module.exports = NodeHelper.create({
	start: function() {
	},

	socketNotificationReceived: function(notification, payload) {

		if (notification === "FETCH_DATA") {

			//Copy and save config
			this.config = payload;

			// iterate through students, fetch and send lessons
			for (let i in this.config.students) {
				var student = this.config.students[i];
				if (student.username) {
					this.fetchLessonsLogin(student, this.config.days);
				}
				else if (student.class) {
					this.fetchLessonsAnonymous(student, this.config.days);
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
				if (studentData.useClassTimetable) {
					return untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
				} else {
					return untis.getOwnTimetableForRange(rangeStart, rangeEnd);
				}
			})
			.then(timetable => {
				lessons = this.timetableToLessons(startTimes, timetable);
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
				lessons = this.timetableToLessons(startTimes, timetable);
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

	timetableToLessons: function(startTimes, timetable) {
		var lessons = [];
		timetable.forEach(element => {
			let lesson = {};

			//Parse date and time information
			lesson.year = element.date.toString().substring(0,4);
			lesson.month = element.date.toString().substring(4,6);
			lesson.day = element.date.toString().substring(6);
			lesson.hour = element.startTime.toString();
			lesson.hour = (lesson.hour.length == 3 ? ("0" + lesson.hour.substring(0,1)) : lesson.hour.substring(0,2));
			lesson.minutes = element.startTime.toString();
			lesson.minutes = lesson.minutes.substring(lesson.minutes.length-2);
			
			//Parse lesson number by start time
			lesson.lessonNumber = startTimes[element.startTime];

			//Parse data about teacher
			if (element.te) {
				lesson.teacher = element.te[0].longname;
				lesson.teacherInitial = element.te[0].name;
			}
			else {
				lesson.teacher = "";
				lesson.teacherInitial = "";
			}

			//Parse data about subject
			if (element.su[0]) {
				lesson.subject = element.su[0].longname;
				lesson.subjectShort = element.su[0].name;
			}
			else {
				lesson.subject = "";
				lesson.subjectShort = "";
			}

			//Parse other information
			lesson.code = element.code ? element.code : "";
			lesson.text = element.lstext ? element.lstext : "";
			lesson.substText = element.substText ? element.substText : "";

			//Set code to "info" if there is an "substText" from WebUntis to display it if configuration "showRegularLessons" is set to false
			if (lesson.substText != "" && lesson.code == "") {
				lesson.code = "info";
			}
			
			//Create sort string
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
			console.log("MMM-Webuntis: Timetable and Lessons: ", JSON.stringify({timetable: timetable, lessons: lessons}));
		}

		return lessons;
	},

})
