Module.register("MMM-Webuntis", {

	defaults: {
		header: "",
		students: [
			{
				title: "SET CONFIG!",
				qrcode: "",
				school: "",
				username: "",
				password: "",
				server: "",
				class: "",
			},
		],
		days: 7,
		fetchInterval: 15 * 60 * 1000,
		showStartTime: false,
		useClassTimetable: false,
		showRegularLessons: false,
		showTeacher: true,
		shortSubject: false,
		showSubstText: false,
		examsDays: 0,
		examsShowSubject: true,
		examsShowTeacher: true,
		mode: "verbose",
		debug: false,
		debugLastDays: 0,
	},

	getStyles: function () {
		return ["MMM-Webuntis.css"];
	},

	getTranslations: function () {
		return {
			en: "translations/en.json",
			de: "translations/de.json"
		};
	},

	start: function () {
		this.lessonsByStudent = [];
		this.examsByStudent = [];
		this.configByStudent = [];
		this.config.id = this.identifier;
		this.sendSocketNotification("FETCH_DATA", this.config);
	},

	getDom: function () {
		var wrapper = document.createElement("div");
		var table = document.createElement("table");
		table.className = "bright small light";

		// no student
		if (this.lessonsByStudent === undefined) {
			console.info("[MMM-Webuntis] no student data available");
			return table;
		}

		let sortedStudentTitles = Object.keys(this.lessonsByStudent).sort();

		// iterate through students
		for (let studentTitle of sortedStudentTitles) {

			var addedRows = 0;

			var lessons = this.lessonsByStudent[studentTitle];
			var studentConfig = this.configByStudent[studentTitle];
			var exams = this.examsByStudent[studentTitle];

			function addTableHeader(table, studentTitle = "") {
				let thisRow = document.createElement("tr");
				cellType = "th";
				studentCell = document.createElement(cellType);
				studentCell.innerHTML = studentTitle;
				studentCell.colSpan = 3;
				studentCell.className = "align-left alignTop";
				thisRow.appendChild(studentCell);
				table.appendChild(thisRow);
			}

			function addTableRow(table, type, studentTitle = "", text1 = "", text2 = "", addClass = "") {
				let thisRow = document.createElement("tr");
				thisRow.className = type;
				let cellType = "td";

				if (studentTitle != "") {
					let studentCell = document.createElement(cellType);
					studentCell.innerHTML = studentTitle;
					studentCell.className = "align-left alignTop bold";
					thisRow.appendChild(studentCell);
				}

				let cell1 = document.createElement(cellType);
				if (text2 == "") { cell1.colSpan = 2; }
				cell1.innerHTML = text1;
				cell1.className = "align-left alignTop ";
				thisRow.appendChild(cell1);

				if (text2 != "") {
					let cell2 = document.createElement(cellType);
					cell2.innerHTML = text2;
					cell2.className = "align-left alignTop " + addClass;
					thisRow.appendChild(cell2);
				}

				table.appendChild(thisRow);
			}

			let studentCellTitle = "";

			// only display student name as header cell if there are more than one student
			if (this.config.mode == "verbose" && this.config.students.length > 1) {
				addTableHeader(table, studentTitle);
			} else {
				studentCellTitle = studentTitle;
			}

			if (studentConfig && studentConfig.days > 0) {

				let studentTitle = studentConfig.title;
				var lessons = this.lessonsByStudent[studentTitle];

				// sort lessons by start time
				lessons.sort((a, b) => a.sortString - b.sortString);

				// iterate through lessons of current student
				for (let i = 0; i < lessons.length; i++) {
					var lesson = lessons[i];
					var time = new Date(lesson.year, lesson.month - 1, lesson.day, lesson.hour, lesson.minutes);

					// Skip if nothing special or past lessons (unless in debug mode)
					if ((!this.config.showRegularLessons && lesson.code === "") ||
						(time < new Date() && lesson.code !== "error" && !this.config.debug)) {
						continue;
					}

					addedRows++;

					let timeStr = time.toLocaleDateString(config.language, { weekday: "short" }).toUpperCase() + "&nbsp;";
					if (studentConfig.showStartTime || lesson.lessonNumber === undefined) {
						timeStr += time.toLocaleTimeString(config.language, { hour: "2-digit", minute: "2-digit" });
					}
					else {
						timeStr += lesson.lessonNumber + ".";
					}

					// subject
					let subjectStr = lesson.subject;
					if (studentConfig.shortSubject) {
						subjectStr = lesson.subjectShort;
					}

					// teachers name
					if (studentConfig.showTeacher) {
						if (studentConfig.showTeacher == "initial" && lesson.teacherInitial !== "") {
							subjectStr += "&nbsp;" + "(" + lesson.teacherInitial + ")";
						}
						else if (lesson.teacher !== "") {
							subjectStr += "&nbsp;" + "(" + lesson.teacher + ")";
						}
					}

					// lesson substitute text
					if (studentConfig.showSubstText && lesson.substText !== "") {
						subjectStr += "<br/><span class='xsmall dimmed'>" + lesson.substText + "</span>";
					}

					if (lesson.text !== "") {
						if (subjectStr.trim() !== "") {
							subjectStr += "<br/>"
						}
						subjectStr += "<span class='xsmall dimmed'>" + lesson.text + "</span>";
					}

					let addClass = "";
					if (lesson.code == "cancelled" || lesson.code == "error" || lesson.code == "info") {
						addClass = lesson.code;
					}

					addTableRow(table, 'lessonsRow', studentCellTitle, timeStr, subjectStr, addClass);
				} // end for lessons	

				// add message row if table is empty
				if (addedRows == 0) {
					addTableRow(table, 'lessonsRowEmpty', studentCellTitle, this.translate("nothing"));
				}
			}

			addedRows = 0;
			var exams = this.examsByStudent[studentTitle];

			if (!exams || studentConfig.examsDays == 0) {
				continue;
			}

			// sort exams
			exams.sort((a, b) => a.sortString - b.sortString);

			// iterate through exams of current student
			for (let i = 0; i < exams.length; i++) {
				var exam = exams[i];
				var time = new Date(exam.year, exam.month - 1, exam.day);

				addedRows++;

				// date and time
				let dateTimeCell = time.toLocaleDateString("de-DE", { month: 'numeric', day: 'numeric' }).toUpperCase() + "&nbsp;";

				// subject of exam
				let nameCell = exam.name;
				if (studentConfig.examsShowSubject) {
					nameCell = exam.subject + ": &nbsp;" + exam.name;
				}

				// teachers name
				if (studentConfig.examsShowTeacher) {
					if (exam.teacher) {
						nameCell += "&nbsp;" + "(" + exam.teacher + ")";
					}
				}

				// exam additional text
				if (exam.text) {
					nameCell += '<br/><span class="xsmall dimmed">' + exam.text + '</span>';
				}

				addTableRow(table, 'examsRow', studentCellTitle, dateTimeCell, nameCell);

			} // end for exam

		// add message row if table is empty
			if (addedRows == 0) {
				addTableRow(table, 'examsRowEmpty', studentCellTitle, this.translate("no_exams"));
			}

		} // end for students

		wrapper.appendChild(table);
		return wrapper;
	},

	notificationReceived: function (notification, payload) {
		switch (notification) {
			case "DOM_OBJECTS_CREATED":
				var timer = setInterval(() => {
					this.sendSocketNotification("FETCH_DATA", this.config);
				}, this.config.fetchInterval);
				break;
		}
	},

	socketNotificationReceived: function (notification, payload) {

		if (this.identifier !== payload.id) {
			return;
		}

		if (notification === "GOT_DATA") {
			if (payload.lessons) {
				this.lessonsByStudent[payload.title] = payload.lessons;
			}
			if (payload.exams) {
				this.examsByStudent[payload.title] = payload.exams;
			}
			if (payload.config) {
				this.configByStudent[payload.title] = payload.config;
			}

			if (this.config.debug) {
				console.log("[MMM-Webuntis] data received for " + payload.title + JSON.stringify(payload, null, 2));
			}
			this.updateDom();
		}
	},
});
