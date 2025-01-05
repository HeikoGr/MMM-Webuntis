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

		// iterate through students
		// TODO: for..in does not guarantee specific order
		for (let studentTitle in this.lessonsByStudent) {
			var addedRows = 0;

			var lessons = this.lessonsByStudent[studentTitle];
			var studentConfig = this.configByStudent[studentTitle];
			var exams = this.examsByStudent[studentTitle];

			if (studentConfig.days > 0) {

				// student name
				// only display title cell if there are more than one student
				if (this.config.mode == "verbose" && this.config.students.length > 1) {
					var studentRow = document.createElement("tr");
					table.appendChild(studentRow);
					var studentCell = document.createElement("th");
					studentCell.colSpan = 2;
					studentCell.innerHTML = studentTitle;
					studentCell.className = "align-left align-top bold";
					studentRow.appendChild(studentCell);
				}

				var lessons = this.lessonsByStudent[studentTitle];

				// sort lessons by start time
				lessons.sort((a, b) => a.sortString - b.sortString);

				// iterate through lessons of current student
				for (let i = 0; i < lessons.length; i++) {
					var lesson = lessons[i];
					var time = new Date(lesson.year, lesson.month - 1, lesson.day, lesson.hour, lesson.minutes);

					if (!this.config.showRegularLessons) {
						// skip if nothing special
						if (lesson.code == "") { continue; }
					}

					// skip past lessons (not if debug mode is set)
					if (time < new Date(Date.now()) && lesson.code != "error" && !this.config.debug) { continue; }

					addedRows++;

					var row = document.createElement("tr");
					table.appendChild(row);

					if (this.config.mode == "compact" && this.config.students.length > 1) {
						const studentCell = document.createElement("td");
						studentCell.innerHTML = studentTitle;
						studentCell.className = "align-left alignTop bold";
						row.appendChild(studentCell);
					}

					// date and time
					var dateTimeCell = document.createElement("td");
					dateTimeCell.innerHTML = time.toLocaleDateString(config.language, { weekday: "short" }).toUpperCase() + "&nbsp;";
					if (studentConfig.showStartTime || lesson.lessonNumber === undefined) {
						dateTimeCell.innerHTML += time.toLocaleTimeString(config.language, { hour: "2-digit", minute: "2-digit" });
					}
					else {
						dateTimeCell.innerHTML += lesson.lessonNumber + ".";
					}
					dateTimeCell.className = "align-left alignTop";
					row.appendChild(dateTimeCell);

					// subject
					var subjectCell = document.createElement("td");
					subjectCell.innerHTML = "";
					if (studentConfig.shortSubject) {
						subjectCell.innerHTML += lesson.subjectShort;
					}
					else {
						subjectCell.innerHTML += lesson.subject;
					}

					// teachers name
					if (studentConfig.showTeacher) {

						if (studentConfig.showTeacher == "initial") {
							if (lesson.teacherInitial !== "") {
								subjectCell.innerHTML += "&nbsp;" + "(";
								subjectCell.innerHTML += lesson.teacherInitial;
								subjectCell.innerHTML += ")";
							}
						}
						else {
							if (lesson.teacher !== "") {
								subjectCell.innerHTML += "&nbsp;" + "(";
								subjectCell.innerHTML += lesson.teacher;
								subjectCell.innerHTML += ")";
							}
						}
					}

					// lesson substitute text
					if (studentConfig.showSubstText && lesson.substText !== "") {
						subjectCell.innerHTML += "<br/>"
						var subText = document.createElement("span");
						subText.className = "xsmall dimmed";
						subText.innerHTML = lesson.substText;
						subjectCell.appendChild(subText);
					}

					if (lesson.text !== "") {
						if (subjectCell.innerHTML.trim() !== "") {
							subjectCell.innerHTML += "<br/>"
						}
						var lessonText = document.createElement("span");
						lessonText.className = "xsmall dimmed";
						lessonText.innerHTML = lesson.text;
						subjectCell.appendChild(lessonText);
					}

					subjectCell.className = "leftSpace align-left alignTop";
					if (lesson.code == "cancelled") {
						subjectCell.className += " cancelled";
					}
					else if (lesson.code == "error") {
						subjectCell.className += " error";
					}
					else if (lesson.code == "info") {
						subjectCell.className += " info";
					}

					row.appendChild(subjectCell);
				} // end for lessons	


				// add message row if table is empty
				if (addedRows == 0) {
					var nothingRow = document.createElement("tr");
					table.appendChild(nothingRow);

					if (this.config.mode == "compact" && this.config.students.length > 1) {
						const studentCell = document.createElement("td");
						studentCell.innerHTML = studentTitle;
						studentCell.className = "align-left alignTop bold";
						nothingRow.appendChild(studentCell);
					}

					var nothingCell = document.createElement("td");
					nothingCell.colSpan = "2";
					nothingCell.className = "align-left";
					nothingCell.innerHTML = this.translate("nothing");
					nothingRow.appendChild(nothingCell);
				}
			}

			addedRows = 0;

			var exams = this.examsByStudent[studentTitle];

			if (exams.length == 0) {
				continue;
			}

			// sort exams
			exams.sort((a, b) => a.sortString - b.sortString);

			var row = document.createElement("tr");
			table.appendChild(row);

			if (this.config.mode == "verbose") {
				const titleCell = document.createElement("td");
				titleCell.colSpan = "2";
				titleCell.innerHTML = this.translate("exams") + " ("	+ studentTitle + ")";
				titleCell.className = "align-left alignTop bold";
				row.appendChild(titleCell);
			}

			// iterate through exams of current student
			for (let i = 0; i < exams.length; i++) {
				var exam = exams[i];
				var time = new Date(exam.year, exam.month - 1, exam.day);

				addedRows++;

				var row = document.createElement("tr");
				table.appendChild(row);

				if (this.config.mode == "compact" && this.config.students.length > 1) {
					const studentCell = document.createElement("td");
					studentCell.innerHTML = studentTitle;
					studentCell.className = "align-left alignTop bold";
					row.appendChild(studentCell);
				}

				// date and time
				var dateTimeCell = document.createElement("td");
				dateTimeCell.innerHTML = time.toLocaleDateString("de-DE", { month: 'numeric', day: 'numeric' }).toUpperCase() + "&nbsp;";
				dateTimeCell.className = "align-left alignTop";
				row.appendChild(dateTimeCell);

				// subject
				var nameCell = document.createElement("td");
				nameCell.className = "align-left alignTop";

				// subject 
				if (studentConfig.examsShowSubject) {
					if (exam.teacher) {
						nameCell.innerHTML += exam.subject;
						nameCell.innerHTML += ": &nbsp;";
					}
				}

				nameCell.innerHTML += exam.name;				

				// teachers name
				if (studentConfig.examsShowTeacher) {
					if (exam.teacher) {
						nameCell.innerHTML += "&nbsp;" + "(";
						nameCell.innerHTML += exam.teacher;
						nameCell.innerHTML += ")";
					}
				}

				// lesson substitute text
				if (exam.text) {
					nameCell.innerHTML += "<br/>"
					var subText = document.createElement("span");
					subText.className = "xsmall dimmed";
					subText.innerHTML = exam.text;
					nameCell.appendChild(subText);
				}

				row.appendChild(nameCell);
			} // end for exam

			// add message row if table is empty
			if (addedRows == 0) {
				var nothingRow = document.createElement("tr");
				table.appendChild(nothingRow);

				if (this.config.mode == "compact" && this.config.students.length > 1) {
					const studentCell = document.createElement("td");
					studentCell.innerHTML = studentTitle;
					studentCell.className = "align-left alignTop bold";
					nothingRow.appendChild(studentCell);
				}

				var nothingCell = document.createElement("td");
				nothingCell.colSpan = "2";
				nothingCell.className = "align-left";
				nothingCell.innerHTML = this.translate("nothing");
				nothingRow.appendChild(nothingCell);
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
		// filter on identifier
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

			if (this.config.debug){
				console.log("[MMM-Webuntis] data received for " + payload.title + JSON.stringify(payload, null, 2));	
			}
			this.updateDom();
		}
	},

});
