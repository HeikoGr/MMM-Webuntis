// Import required modules
const NodeHelper = require("node_helper");
const { WebUntis } = require("webuntis");
const { WebUntisQR } = require("webuntis");
const { URL } = require("url");
const Authenticator = require("otplib").authenticator;
const Log = require("logger");

// Simple caches to avoid redundant API calls across students/sessions
const timegridCache = {}; // keyed by credentialKey
const weekTimetableCache = {}; // keyed by credentialKey + rangeStart

// Create a NodeHelper module
module.exports = NodeHelper.create({
  // Start function is called when the helper is initialized
  start() {
    Log.info("[MMM-Webuntis] Node helper started");
  },

  // Function to handle socket notifications
  async socketNotificationReceived(notification, payload) {
    if (notification === "FETCH_DATA") {
      // Assign the payload to the config property
      this.config = payload;

      try {
        // Group students by credential so we can reuse the same untis session
        const identifier = this.config.id;
        const groups = new Map();

        const properties = [
          "days",
          "debugLastDays",
          "showStartTime",
          "useClassTimetable",
          "showRegularLessons",
          "showTeacher",
          "shortSubject",
          "showSubstText",
          "examsDays",
          "examsShowSubject",
          "debug"
        ];

        // normalize student configs and group
        for (const student of this.config.students) {
          properties.forEach((prop) => {
            student[prop] = student[prop] !== undefined ? student[prop] : this.config[prop];
          });
          if (student.days < 0 || student.days > 10 || isNaN(student.days)) {
            student.days = 1;
          }

          const credKey = this._getCredentialKey(student);
          if (!groups.has(credKey)) groups.set(credKey, []);
          groups.get(credKey).push(student);
        }

        // For each credential group, login once, fetch for all students in group, then logout
        for (const [credKey, students] of groups.entries()) {
          let untis = null;
          const sample = students[0];
          try {
            if (sample.qrcode) {
              untis = new WebUntisQR(sample.qrcode, "custom-identity", Authenticator, URL);
            } else if (sample.username) {
              untis = new WebUntis(sample.school, sample.username, sample.password, sample.server);
            } else {
              Log.error(`[MMM-Webuntis] No credentials for group ${credKey}`);
              continue;
            }

            await untis.login();
            for (const student of students) {
              // fetchData will use caches (timegrid/weekTimetable) keyed by credKey
              try {
                await this.fetchData(untis, student, identifier, credKey);
              } catch (err) {
                console.error(`[MMM-Webuntis] Error fetching data for ${student.title}:`, err);
              }
            }
          } catch (error) {
            console.error("[MMM-Webuntis] Error during login/fetch for group:", error);
          } finally {
            try {
              if (untis) await untis.logout();
            } catch (e) {
              // ignore logout errors
            }
          }
        }
        Log.info("[MMM-Webuntis] Successfully fetched data");
      } catch (error) {
        Log.error("[MMM-Webuntis] Error loading Untis data: ", error);
      }
    }
  },

  // Build a stable key that represents a login/session so we can cache results
  _getCredentialKey(student) {
    if (student.qrcode) return `qrcode:${student.qrcode}`;
    const server = student.server || "default";
    return `user:${student.username}@${server}/${student.school}`;
  },

  // Cached timegrid: TTL 1 hour
  async _getTimegridCached(untis, credKey) {
    const ttl = 1000 * 60 * 60; // 1 hour
    const now = Date.now();
    const cached = timegridCache[credKey];
    if (cached && (now - cached.fetchedAt) < ttl) return cached.data;
    try {
      const grid = await untis.getTimegrid();
      timegridCache[credKey] = { fetchedAt: now, data: grid };
      return grid;
    } catch (err) {
      // return empty array on error
      return [];
    }
  },

  // weekTimetable cache keyed by credKey+rangeStartStr
  async _getWeekTimetableCached(untis, credKey, rangeStart) {
    const key = `${credKey}:${rangeStart.toDateString()}`;
    if (weekTimetableCache[key]) return weekTimetableCache[key];
    try {
      const weekTimetable = await untis.getOwnTimetableForWeek(rangeStart);
      weekTimetableCache[key] = weekTimetable || [];
      return weekTimetableCache[key];
    } catch (err) {
      weekTimetableCache[key] = [];
      return [];
    }
  },

  async fetchData(untis, student, identifier, credKey) {
    function logger(msg) {
      if (student.debug) {
        console.log(`[MMM-Webuntis] ${msg}`);
      }
    }

    // small helper: convert HHMM (number|string) or H:MM to minutes since midnight
    const toMinutes = (t) => {
      if (t === null || t === undefined) return NaN;
      const s = String(t).trim();
      if (s.includes(':')) {
        const parts = s.split(':').map(p => p.replace(/\D/g, ''));
        const hh = parseInt(parts[0], 10) || 0;
        const mm = parseInt(parts[1] || '0', 10) || 0;
        return hh * 60 + mm;
      }
      const digits = s.replace(/\D/g, '').padStart(4, '0');
      const hh = parseInt(digits.slice(0, 2), 10) || 0;
      const mm = parseInt(digits.slice(2), 10) || 0;
      return hh * 60 + mm;
    };

    let lessons = [];
    let exams = [];
    let homeworks = [];
    const startTimes = [];
    const timeUnits = [];
    let todayLessons = [];

    var rangeStart = new Date(Date.now());
    var rangeEnd = new Date(Date.now());

    rangeStart.setDate(rangeStart.getDate() - student.debugLastDays);
    rangeEnd.setDate(rangeEnd.getDate() - student.debugLastDays + parseInt(student.days));

  // Get Timegrid (for mapping start/end times) - cached per credential
    let grid = [];
    try {
      grid = await this._getTimegridCached(untis, credKey);
      if (grid && grid[0] && grid[0].timeUnits) {
        grid[0].timeUnits.forEach((element) => {
          startTimes[element.startTime] = element.name;
          const startMin = toMinutes(element.startTime);
          const endMin = element.endTime ? toMinutes(element.endTime) : null;
          timeUnits.push({
            startTime: element.startTime,
            endTime: element.endTime,
            startMin,
            endMin,
            name: element.name
          });
        });
      }
    } catch (error) {
      console.log(`Error in getTimegrid: ${error}`);
    }

    if (student.days > 0) {
      try {
        let timetable;

        // Additionally fetch the week's timetable to get full WebAPI timetable entries
        // This helps to obtain stable lesson IDs (WebAPITimetable) to link homeworks
        // Use cached week timetable per credential+start date to avoid duplicate calls
        let weekTimetable = await this._getWeekTimetableCached(untis, credKey, rangeStart);

        if (student.useClassTimetable) {
          logger(`[MMM-Webuntis] getOwnClassTimetableForRange from ${rangeStart} to ${rangeEnd}`);
          timetable = await untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownClassTimetable received for ${student.title}`);
        } else {
          logger(`[MMM-Webuntis] getOwnTimetableForRange from ${rangeStart} to ${rangeEnd}`);
          timetable = await untis.getOwnTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownTimetable received for ${student.title}`);
        }
  // Convert timetable entries to lesson objects and try to enrich them with lessonId.
  // Keep processed lessons for backward compatibility, but also include raw data so the
  // frontend can rely on raw data if desired.
        lessons = this.timetableToLessons(startTimes, timetable, weekTimetable);

        // Filter lessons for today
        const today = new Date();
        const todayStr = today.getFullYear().toString() + ("0" + (today.getMonth() + 1)).slice(-2) + ("0" + today.getDate()).slice(-2);
        todayLessons = timetable.filter(l => l.date.toString() === todayStr).map(l => ({
          subject: l.su?.[0]?.longname || "N/A",
          subjectShort: l.su?.[0]?.name || "N/A",
          teacher: l.te?.[0]?.longname || "N/A",
          teacherInitial: l.te?.[0]?.name || "N/A",
          startTime: l.startTime,
          endTime: l.endTime,
          startMin: toMinutes(l.startTime),
          endMin: l.endTime ? toMinutes(l.endTime) : null,
          code: l.code || "",
          text: l.lstext || "",
          substText: l.substText || "",
          lessonNumber: startTimes[l.startTime],
          // try to capture lesson id from common fields (depends on WebUntis wrapper version)
          lessonId: l.id ?? l.lid ?? l.lessonId ?? null
        }));
      } catch (error) {
        console.log(`[MMM-Webuntis] ERROR for ${student.title}: ${error.toString()}`);
      }
    }

    if (student.examsDays > 0) {
      // Validate the number of days
      if (student.examsDays < 1 || student.examsDays > 360 || isNaN(student.examsDays)) {
        student.examsDays = 30;
      }

      var rangeStart = new Date(Date.now());
      var rangeEnd = new Date(Date.now());
      rangeEnd.setDate(rangeStart.getDate() + student.examsDays);

      try {
        const rawExams = await untis.getExamsForRange(rangeStart, rangeEnd);
        exams = this.examsToFlat(rawExams);
        // keep rawExams as well for frontend processing if desired
        exams = exams || [];
        this._lastRawExams = rawExams;
      } catch (error) {
        console.log(`ERROR for ${student.title}: ${error.toString()}`);
      }
    }

    // Hausaufgaben für den Zeitraum laden (ab heute bis rangeEnd + 7 Tage)
    try {
      let hwRangeEnd = new Date(rangeEnd);
      hwRangeEnd.setDate(hwRangeEnd.getDate() + 7);
      // Try a single, sensible call to getHomeWorkAndLessons(range) and fall back to getHomeWorksFor
      let hwResult = null;
      try {
        // try the API that returns homeworks + lessons in one call
        hwResult = await untis.getHomeWorkAndLessons(new Date(), hwRangeEnd);
      } catch (e) {
        // fallback: older wrapper might not support getHomeWorkAndLessons with args
        try {
          hwResult = await untis.getHomeWorkAndLessons();
        } catch (e2) {
          // final fallback: use getHomeWorksFor
          try {
            hwResult = await untis.getHomeWorksFor(new Date(), hwRangeEnd);
          } catch (e3) {
            logger(`[MMM-Webuntis] Homework fetch failed for ${student.title}: ${e} / ${e2} / ${e3}`);
            hwResult = null;
          }
        }
      }

      // Normalize homework result to an array
      if (Array.isArray(hwResult)) {
        homeworks = hwResult;
      } else if (hwResult && Array.isArray(hwResult.homeworks)) {
        homeworks = hwResult.homeworks;
      } else if (hwResult && Array.isArray(hwResult.homeworks || hwResult.homework)) {
        homeworks = hwResult.homeworks || hwResult.homework;
      } else {
        homeworks = [];
        logger(`[MMM-Webuntis] Unexpected homework result for ${student.title}: ${JSON.stringify(hwResult).slice(0, 200)}`);
      }
      logger(`[MMM-Webuntis] Loaded ${homeworks.length} homeworks for ${student.title}`);
    } catch (error) {
      console.log(`[MMM-Webuntis] ERROR loading homeworks for ${student.title}: ${error.toString()}`);
    }

    // Before sending data, perform a quick debug validation: ensure lessons/timeUnits have numeric minutes
    if (student.debug || this.config.debug) {
      const missingLessonMinutes = lessons.filter(l => l.startMin === undefined || l.startMin === null || l.endMin === undefined || l.endMin === null).length;
      const missingTimeUnits = timeUnits.filter(tu => tu.startMin === undefined || tu.startMin === null).length;
      console.log(`[MMM-Webuntis] Debug validation for ${student.title}: lessons without minutes=${missingLessonMinutes}, timeUnits without minutes=${missingTimeUnits}`);
    }

    // Send processed data for backward compatibility, and include raw API responses
    this.sendSocketNotification("GOT_DATA", {
      title: student.title,
      config: student,
      lessons,
      exams,
      id: identifier,
      todayLessons,
      timeUnits,
      homeworks,
      // raw data to allow the frontend to do heavy processing if desired
      _raw: {
        timetable: typeof timetable !== 'undefined' ? timetable : null,
        weekTimetable: typeof weekTimetable !== 'undefined' ? weekTimetable : null,
        timegrid: grid || null
      }
    });
  },

  timetableToLessons(startTimes, timetable, weekTimetable = []) {
    const toMinutes = (t) => {
      if (t === null || t === undefined) return NaN;
      const s = String(t).trim();
      if (s.includes(':')) {
        const parts = s.split(':').map(p => p.replace(/\D/g, ''));
        const hh = parseInt(parts[0], 10) || 0;
        const mm = parseInt(parts[1] || '0', 10) || 0;
        return hh * 60 + mm;
      }
      const digits = s.replace(/\D/g, '').padStart(4, '0');
      const hh = parseInt(digits.slice(0, 2), 10) || 0;
      const mm = parseInt(digits.slice(2), 10) || 0;
      return hh * 60 + mm;
    };
    const lessons = [];

    // Build a quick map from date+startTime to weekTimetable entry to get stable IDs when possible
    const weekMap = {};
    if (Array.isArray(weekTimetable)) {
      weekTimetable.forEach((we) => {
        try {
          const key = `${we.date}-${we.startTime}`;
          weekMap[key] = we;
        } catch (err) {
          // ignore
        }
      });
    }

    timetable.forEach((element) => {
      const key = `${element.date}-${element.startTime}`;
      const weekEntry = weekMap[key];

      const lesson = {
        year: element.date.toString().substring(0, 4),
        month: element.date.toString().substring(4, 6),
        day: element.date.toString().substring(6, 8),
        hour: element.startTime.toString().padStart(4, "0")
          .substring(0, 2),
        minutes: element.startTime.toString().padStart(4, "0")
          .substring(2),
        startTime: element.startTime.toString().padStart(4, "0"),
        endTime: element.endTime ? element.endTime.toString().padStart(4, "0") : null,
        startMin: toMinutes(element.startTime),
        endMin: element.endTime ? toMinutes(element.endTime) : null,
        endTimeRaw: element.endTime ?? null,
        teacher: element.te?.[0]?.longname || "N/A",
        teacherInitial: element.te?.[0]?.name || "N/A",
        subject: element.su?.[0]?.longname || "N/A",
        subjectShort: element.su?.[0]?.name || "N/A",
        code: element.code || "",
        text: element.lstext || "",
        substText: element.substText || "",
        lessonNumber: startTimes[element.startTime],
        // prefer lesson id from weekTimetable when available, otherwise try common fields
        lessonId: weekEntry?.id ?? weekEntry?.lessonId ?? element.id ?? element.lid ?? element.lessonId ?? null
      };

      // Set code to "info" if there is an "substText" from WebUntis to display it if configuration "showRegularLessons" is set to false
      if (lesson.substText !== "" && lesson.code === "") {
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

  examsToFlat(exams) {
    const ret_exams = [];

    exams.forEach((element) => {
      const exam = {
        year: element.examDate.toString().substring(0, 4),
        month: element.examDate.toString().substring(4, 6),
        day: element.examDate.toString().substring(6, 8),
        hour: element.startTime.toString().padStart(4, "0")
          .substring(0, 2),
        minutes: element.startTime.toString().padStart(4, "0")
          .substring(2),
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
});
