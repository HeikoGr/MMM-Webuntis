Module.register("MMM-Webuntis", {

	defaults: {
		students: [
			{
				title: "SET CONFIG!",
				school: "",
				username: "",
				password: "",
				server: "",
				class: ""
			},
		],
		days: 7,
		fetchInterval: 5 * 60 * 1000,
		showStartTime: false,
		showRegularLessons: false,
		showTeacher: true
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

	start: function (){
		this.lessonsByStudent = [];
		this.sendSocketNotification("FETCH_DATA", this.config);
	},

	getDom: function() {
		var wrapper = document.createElement("div");

		var table = document.createElement("table");
    		table.className = "bright small light";

		// no student
		if (this.lessonsByStudent === undefined) {
    			return table;
    		}

		var addedRows = 0;

		// iterate through students
		// TODO: for..in does not guarantee specific order
		for (let studentTitle in this.lessonsByStudent) {
			//for (const [studentTitle, lessons] of this.lessonsByStudent.entries()) {

			var lessons = this.lessonsByStudent[studentTitle];

			// sort lessons by start time
			lessons.sort((a,b) => a.sortString - b.sortString);

			// iterate through lessons of current student
			for (let i = 0; i < lessons.length; i++) {
				var lesson = lessons[i];
				var time = new Date(lesson.year,lesson.month-1,lesson.day,lesson.hour,lesson.minutes);

				if (!this.config.showRegularLessons) {
					// skip if nothing special
					if (lesson.code == "") {continue;}
				}

				// skip past lessons
				if (time < new Date() && lesson.code != "error") {continue;}

				addedRows++;

				var row = document.createElement("tr");
				table.appendChild(row);

				// title, i.e. class name or child name
				var titleCell = document.createElement("td");
				titleCell.innerHTML = studentTitle;
				titleCell.className = "align-right alignTop";
				row.appendChild(titleCell);

				// date and time
				var dateTimeCell = document.createElement("td");
				dateTimeCell.innerHTML = time.toLocaleDateString("de-DE",{weekday:"short"}).toUpperCase() + "&nbsp;";
				if (this.config.showStartTime || lesson.lessonNumber === undefined) {
					dateTimeCell.innerHTML += time.toLocaleTimeString("de-DE", {hour:"2-digit",minute:"2-digit"});
				}
				else {
					dateTimeCell.innerHTML += lesson.lessonNumber + ".";
				}
				dateTimeCell.className = "leftSpace align-right alignTop";
				row.appendChild(dateTimeCell);

				// subject cell
				
				var subjectCell = document.createElement("td");
				subjectCell.innerHTML = "";
				subjectCell.innerHTML += this.capitalize(lesson.subject);

				if (lesson.substText == "") {
					//Teachers name
					if (this.config.showTeacher) {
						subjectCell.innerHTML += "&nbsp;" + "(";
						subjectCell.innerHTML += this.capitalize(lesson.teacher);
						subjectCell.innerHTML += ")";
					}
				}
				else {
					subjectCell.innerHTML += "&nbsp;" + "(";
					subjectCell.innerHTML += lesson.substText;
					subjectCell.innerHTML += ")";
				}

				//if (lesson.text.length > 0 ) subjectCell.innerHTML += "</br><span class='xsmall dimmed'>" + lesson.text + "</span>";
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
		} // end for students

		// add message row if table is empty
		if (addedRows == 0) {
			var nothingRow = document.createElement("tr");
			table.appendChild(nothingRow);
			var nothingCell = document.createElement("td");
			nothingCell.innerHTML = this.translate("nothing");
			nothingRow.appendChild(nothingCell);
		}

		wrapper.appendChild(table);

		return wrapper;
	},

	capitalize: function(str) {
		return str;
		//Changed, because the strings does not look nice for me after capitalize function, is this necessary? 
		str = str.toLowerCase().split(" ");

		for (let i = 0, x = str.length; i < x; i++) {
			if (str[i]) {
				if (str[i] === "ii" || str[i] === "iii") {str[i] = str[i].toUpperCase();}
				else {str[i] = str[i][0].toUpperCase() + str[i].substr(1);}
			}
		}

		return str.join(" ");
	},

	notificationReceived: function(notification, payload) {
		switch(notification) {
		case "DOM_OBJECTS_CREATED":
			var timer = setInterval(() => {
				this.sendSocketNotification("FETCH_DATA", this.config);
			}, this.config.fetchInterval);
			break;
		}
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === "GOT_DATA") {
			if (payload.lessons) {
				this.lessonsByStudent[payload.title] = payload.lessons;
				this.updateDom();

			}
		}
	},
});
