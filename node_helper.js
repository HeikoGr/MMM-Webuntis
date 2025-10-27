// Import required modules
const NodeHelper = require("node_helper");
const { WebUntis } = require("webuntis");
const { WebUntisQR } = require("webuntis");
const { URL } = require("url");
const Authenticator = require("otplib").authenticator;
const Log = require("logger");

// Note: caching removed - always fetch current data from WebUntis to
// ensure the frontend shows up-to-date information.

// small helper: convert HHMM (number|string) or H:MM to minutes since midnight
const toMinutes = (t) => {
  if (t === null || t === undefined) return NaN;
  const s = String(t).trim();
  if (s.includes(":")) {
    const parts = s.split(":").map((p) => p.replace(/\D/g, ""));
    const hh = parseInt(parts[0], 10) || 0;
    const mm = parseInt(parts[1] || "0", 10) || 0;
    return hh * 60 + mm;
  }
  const digits = s.replace(/\D/g, "").padStart(4, "0");
  const hh = parseInt(digits.slice(0, 2), 10) || 0;
  const mm = parseInt(digits.slice(2), 10) || 0;
  return hh * 60 + mm;
};

// Create a NodeHelper module
module.exports = NodeHelper.create({
  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start() {
    Log.info("[MMM-Webuntis] Node helper started");
    // track inflight fetches per credential key to avoid duplicate parallel work
    this._inflightRequests = this._inflightRequests || new Map();
  },

  /*
   * Create an authenticated WebUntis client from a student sample config.
   * Returns a client instance or throws an Error if credentials missing.
   */
  _createUntisClient(sample) {
    if (sample.qrcode) {
      return new WebUntisQR(
        sample.qrcode,
        "custom-identity",
        Authenticator,
        URL,
      );
    }
    if (sample.username) {
      return new WebUntis(
        sample.school,
        sample.username,
        sample.password,
        sample.server,
      );
    }
    throw new Error("No credentials provided");
  },

  // Format errors consistently for logs
  _formatErr(err) {
    if (!err) return "(no error)";
    return err && err.message ? err.message : String(err);
  },

  // Normalize different homework API results to an array
  _normalizeHomeworks(hwResult) {
    if (Array.isArray(hwResult)) return hwResult;
    if (hwResult && Array.isArray(hwResult.homeworks))
      return hwResult.homeworks;
    if (hwResult && Array.isArray(hwResult.homework)) return hwResult.homework;
    return [];
  },

  // expose toMinutes for testing and reuse
  _toMinutes(t) {
    return toMinutes(t);
  },

  /**
   * Process a credential group: login, fetch data for students and logout.
   * This function respects the inflightRequests Map's pending flag: if pending
   * becomes true while running, it will loop once more to handle the coalesced request.
   */
  async processGroup(credKey, students, identifier) {
    while (true) {
      let untis = null;
      const sample = students[0];
      try {
        try {
          untis = this._createUntisClient(sample);
        } catch {
          this._mmLog("error", null, `No credentials for group ${credKey}`);
          break;
        }

        await untis.login();
        for (const student of students) {
          try {
            await this.fetchData(untis, student, identifier, credKey);
          } catch (err) {
            this._mmLog(
              "error",
              student,
              `Error fetching data for ${student.title}: ${this._formatErr(err)}`,
            );
          }
        }
      } catch (error) {
        this._mmLog(
          "error",
          null,
          `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`,
        );
      } finally {
        try {
          if (untis) await untis.logout();
        } catch (e) {
          this._mmLog(
            "error",
            null,
            `Error during logout for group ${credKey}: ${this._formatErr(e)}`,
          );
        }
      }

      const infl = this._inflightRequests.get(credKey);
      if (infl && infl.pending) {
        infl.pending = false;
        continue;
      }

      if (infl) infl.running = false;
      break;
    }
  },

  /**
   * Centralized backend logger that honors module and per-student debug flags.
   * Emits messages using the MagicMirror `Log` helper.
   *
   * @param {'info'|'debug'|'error'} level
   * @param {Object|null} student
   * @param {string} message
   */
  _mmLog(level, student, message) {
    try {
      const prefix = `[MMM-Webuntis]`;
      if (level === "info") {
        Log.info(`${prefix} ${message}`);
      } else if (level === "error") {
        Log.error(`${prefix} ${message}`);
      } else if (level === "debug") {
        if (this.config && this.config.logLevel === "debug") {
          if (typeof Log.debug === "function") {
            Log.debug(`${prefix} ${message}`);
          } else {
            Log.info(`${prefix} [DEBUG] ${message}`);
          }
        }
      } else {
        Log.info(`${prefix} ${message}`);
      }
    } catch (e) {
      Log.error(
        `[MMM-Webuntis] Error in logging: ${e && e.message ? e.message : e}`,
      );
      // swallow
    }
  },

  /**
   * Handle socket notifications sent by the frontend module.
   * Currently listens for `FETCH_DATA` which contains the module config.
   *
   * @param {string} notification - Notification name
   * @param {any} payload - Notification payload
   */
  async socketNotificationReceived(notification, payload) {
    if (notification === "FETCH_DATA") {
      // Assign incoming payload to config (payload may contain legacy keys)
      this.config = payload;
      this._mmLog(
        "info",
        null,
        `FETCH_DATA received (students=${Array.isArray(this.config.students) ? this.config.students.length : 0})`,
      );

      try {
        // Group students by credential so we can reuse the same untis session
        const identifier = this.config.id;
        const groups = new Map();

        const properties = [
          "daysToShow",
          "pastDaysToShow",
          "showStartTime",
          "useClassTimetable",
          "showRegularLessons",
          "showTeacherMode",
          "useShortSubject",
          "showSubstitutionText",
          "examsDaysAhead",
          "showExamSubject",
          "showExamTeacher",
          "logLevel",
        ];

        // normalize student configs and group
        for (const student of this.config.students) {
          properties.forEach((prop) => {
            student[prop] =
              student[prop] !== undefined ? student[prop] : this.config[prop];
          });
          if (
            student.daysToShow < 0 ||
            student.daysToShow > 10 ||
            isNaN(student.daysToShow)
          ) {
            student.daysToShow = 1;
          }

          const credKey = this._getCredentialKey(student);
          if (!groups.has(credKey)) groups.set(credKey, []);
          groups.get(credKey).push(student);
        }

        // For each credential group, process with coalescing inflight handling.
        // If a fetch for the same credKey is already running, we set a pending flag
        // so that the group is fetched once more when the current run finishes.
        for (const [credKey, students] of groups.entries()) {
          if (!this._inflightRequests) this._inflightRequests = new Map();

          const inflight = this._inflightRequests.get(credKey);
          if (inflight && inflight.running) {
            inflight.pending = true;
            this._mmLog(
              "info",
              null,
              `Fetch for ${credKey} already in progress - coalescing request`,
            );
            continue;
          }

          // mark as running
          this._inflightRequests.set(credKey, {
            running: true,
            pending: false,
          });

          // Launch the named worker that will process the group and rerun if pending was set
          this.processGroup(credKey, students, identifier);
        }
        this._mmLog("info", null, "Successfully fetched data");
      } catch (error) {
        this._mmLog("error", null, `Error loading Untis data: ${error}`);
      }
    }
  },

  /**
   * Build a stable key that represents a login/session so results can be cached.
   * The key is based on qrcode when present or username/server/school otherwise.
   *
   * @param {Object} student - Student credential object
   * @returns {string} credential key
   */
  _getCredentialKey(student) {
    if (student.qrcode) return `qrcode:${student.qrcode}`;
    const server = student.server || "default";
    return `user:${student.username}@${server}/${student.school}`;
  },

  /**
   * Return the timegrid for the given credential. Caching has been removed
   * to always provide fresh data from WebUntis.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {string} credKey - Credential key (unused but kept for API compatibility)
   * @returns {Promise<Array>} timegrid array
   */
  async _getTimegrid(untis, credKey) {
    try {
      const grid = await untis.getTimegrid();
      return grid || [];
    } catch (err) {
      // return empty array on error
      this._mmLog(
        "error",
        null,
        `Error fetching timegrid for ${credKey}: ${err && err.message ? err.message : err}`,
      );
      return [];
    }
  },

  /**
   * Return the week's timetable for the given credential and week start.
   * Caching removed: always fetch fresh data from WebUntis.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {string} credKey - Credential key (unused but kept for compatibility)
   * @param {Date} rangeStart - Week start date
   * @returns {Promise<Array>} week timetable
   */
  async _getWeekTimetable(untis, credKey, rangeStart) {
    try {
      const weekTimetable = await untis.getOwnTimetableForWeek(rangeStart);
      return weekTimetable || [];
    } catch (err) {
      this._mmLog(
        "error",
        null,
        `Error fetching week timetable for ${credKey}: ${err && err.message ? err.message : err}`,
      );
      return [];
    }
  },

  /**
   * Fetch and normalize data for a single student using the provided authenticated
   * `untis` client. This collects lessons, exams and homeworks and sends a
   * `GOT_DATA` socket notification back to the frontend.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {Object} student - Student config object
   * @param {string} identifier - Module instance identifier
   * @param {string} credKey - Credential grouping key
   */
  async fetchData(untis, student, identifier, credKey) {
    const logger = (msg) => {
      this._mmLog("debug", student, msg);
    };

    // use shared toMinutes helper (defined at module top)

    let lessons = [];
    let exams = [];
    let homeworks = [];
    const startTimes = [];
    const timeUnits = [];
    let todayLessons = [];

    var rangeStart = new Date(Date.now());
    var rangeEnd = new Date(Date.now());

    rangeStart.setDate(rangeStart.getDate() - student.pastDaysToShow);
    rangeEnd.setDate(
      rangeEnd.getDate() -
        student.pastDaysToShow +
        parseInt(student.daysToShow),
    );

    // Get Timegrid (for mapping start/end times) - cached per credential
    let grid = [];
    try {
      grid = await this._getTimegrid(untis, credKey);
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
            name: element.name,
          });
        });
      }
    } catch (error) {
      this._mmLog(
        "error",
        null,
        `getTimegrid error for ${credKey}: ${error && error.message ? error.message : error}`,
      );
    }

    if (student.daysToShow > 0) {
      try {
        let timetable;

        // Additionally fetch the week's timetable to get full WebAPI timetable entries
        // This helps to obtain stable lesson IDs (WebAPITimetable) to link homeworks
        let weekTimetable = await this._getWeekTimetable(
          untis,
          credKey,
          rangeStart,
        );

        if (student.useClassTimetable) {
          logger(
            `[MMM-Webuntis] getOwnClassTimetableForRange from ${rangeStart} to ${rangeEnd}`,
          );
          timetable = await untis.getOwnClassTimetableForRange(
            rangeStart,
            rangeEnd,
          );
          logger(
            `[MMM-Webuntis] ownClassTimetable received for ${student.title}`,
          );
        } else {
          logger(
            `[MMM-Webuntis] getOwnTimetableForRange from ${rangeStart} to ${rangeEnd}`,
          );
          timetable = await untis.getOwnTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownTimetable received for ${student.title}`);
        }
        // Convert timetable entries to lesson objects and try to enrich them with lessonId.
        // Keep processed lessons for backward compatibility, but also include raw data so the
        // frontend can rely on raw data if desired.
        lessons = this.timetableToLessons(startTimes, timetable, weekTimetable);

        // Filter lessons for today
        const today = new Date();
        const todayStr =
          today.getFullYear().toString() +
          ("0" + (today.getMonth() + 1)).slice(-2) +
          ("0" + today.getDate()).slice(-2);
        todayLessons = timetable
          .filter((l) => l.date.toString() === todayStr)
          .map((l) => ({
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
            lessonId: l.id ?? l.lid ?? l.lessonId ?? null,
          }));
      } catch (error) {
        this._mmLog(
          "error",
          student,
          `Timetable fetch error for ${student.title}: ${error && error.message ? error.message : error}`,
        );
      }
    }

    if (student.examsDaysAhead > 0) {
      // Validate the number of days
      if (
        student.examsDaysAhead < 1 ||
        student.examsDaysAhead > 360 ||
        isNaN(student.examsDaysAhead)
      ) {
        student.examsDaysAhead = 30;
      }

      // var rangeStart = new Date(Date.now());
      // var rangeEnd = new Date(Date.now());
      rangeEnd.setDate(rangeStart.getDate() + student.examsDaysAhead);

      try {
        const rawExams = await untis.getExamsForRange(rangeStart, rangeEnd);
        exams = this.examsToFlat(rawExams);
        // keep rawExams as well for frontend processing if desired
        exams = exams || [];
        this._lastRawExams = rawExams;
      } catch (error) {
        this._mmLog(
          "error",
          student,
          `Exams fetch error for ${student.title}: ${error && error.message ? error.message : error}`,
        );
      }
    }

    // Load homework for the period (from today until rangeEnd + 7 days)
    try {
      let hwRangeEnd = new Date(rangeEnd);
      hwRangeEnd.setDate(hwRangeEnd.getDate() + 7);
      // Try a sequence of candidate homework API calls (first that succeeds wins)
      let hwResult = null;
      try {
        const candidates = [
          () => untis.getHomeWorkAndLessons(new Date(), hwRangeEnd),
          () => untis.getHomeWorksFor(new Date(), hwRangeEnd),
        ];
        let lastErr = null;
        for (const fn of candidates) {
          try {
            hwResult = await fn();
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (hwResult === null) {
          logger(
            `[MMM-Webuntis] Homework fetch failed for ${student.title}: ${lastErr}`,
          );
        }
      } catch (error) {
        logger(
          `[MMM-Webuntis] Homework fetch unexpected error for ${student.title}: ${error}`,
        );
        hwResult = null;
      }

      // Normalize homework result to an array
      if (Array.isArray(hwResult)) {
        homeworks = hwResult;
      } else if (hwResult && Array.isArray(hwResult.homeworks)) {
        homeworks = hwResult.homeworks;
      } else if (
        hwResult &&
        Array.isArray(hwResult.homeworks || hwResult.homework)
      ) {
        homeworks = hwResult.homeworks || hwResult.homework;
      } else {
        homeworks = [];
        logger(
          `[MMM-Webuntis] Unexpected homework result for ${student.title}: ${JSON.stringify(hwResult).slice(0, 200)}`,
        );
      }
      logger(
        `[MMM-Webuntis] Loaded ${homeworks.length} homeworks for ${student.title}`,
      );
    } catch (error) {
      this._mmLog(
        "error",
        student,
        `Homework fetch error for ${student.title}: ${error && error.message ? error.message : error}`,
      );
    }

    // Before sending data, perform a quick debug validation: ensure lessons/timeUnits have numeric minutes
    if (student.logLevel) {
      const missingLessonMinutes = lessons.filter(
        (l) =>
          l.startMin === undefined ||
          l.startMin === null ||
          l.endMin === undefined ||
          l.endMin === null,
      ).length;
      const missingTimeUnits = timeUnits.filter(
        (tu) => tu.startMin === undefined || tu.startMin === null,
      ).length;
      logger(
        `Debug validation for ${student.title}: lessons without minutes=${missingLessonMinutes}, timeUnits without minutes=${missingTimeUnits}`,
      );
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
      //_raw: {
      //  timetable: typeof timetable !== 'undefined' ? timetable : null,
      //  weekTimetable: typeof weekTimetable !== 'undefined' ? weekTimetable : null,
      //  timegrid: grid || null
      //}
    });
  },

  /**
   * Convert raw timetable entries into a lightweight lesson object used by the
   * frontend. Also attempt to preserve stable lesson IDs when available.
   *
   * @param {Object} startTimes - map of startTime -> lesson number/name
   * @param {Array} timetable - raw timetable entries from WebUntis
   * @param {Array} weekTimetable - optional week timetable used to enrich IDs
   * @returns {Array} normalized lesson objects
   */
  timetableToLessons(startTimes, timetable, weekTimetable = []) {
    // use shared toMinutes helper (defined at module top)
    const lessons = [];

    // Build a quick map from date+startTime to weekTimetable entry to get stable IDs when possible
    const weekMap = new Map();
    if (Array.isArray(weekTimetable)) {
      weekTimetable.forEach((we) => {
        try {
          const key = `${we.date}-${we.startTime}`;
          weekMap.set(key, we);
        } catch (err) {
          this._mmLog(
            "error",
            null,
            `timetableToLessons weekMap error: ${err && err.message ? err.message : err}`,
          );
        }
      });
    }

    timetable.forEach((element) => {
      const key = `${element.date}-${element.startTime}`;
      const weekEntry = weekMap.get(key);

      const lesson = {
        year: element.date.toString().substring(0, 4),
        month: element.date.toString().substring(4, 6),
        day: element.date.toString().substring(6, 8),
        hour: element.startTime.toString().padStart(4, "0").substring(0, 2),
        minutes: element.startTime.toString().padStart(4, "0").substring(2),
        startTime: element.startTime.toString().padStart(4, "0"),
        endTime: element.endTime
          ? element.endTime.toString().padStart(4, "0")
          : null,
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
        lessonId:
          weekEntry?.id ??
          weekEntry?.lessonId ??
          element.id ??
          element.lid ??
          element.lessonId ??
          null,
      };

      // Set code to "info" if there is an "substText" from WebUntis to display it if configuration "showRegularLessons" is set to false
      if (lesson.substText !== "" && lesson.code === "") {
        lesson.code = "info";
      }

      // Create sort string
      lesson.sortString =
        lesson.year + lesson.month + lesson.day + lesson.hour + lesson.minutes;
      switch (lesson.code) {
        case "cancelled":
          lesson.sortString += "1";
          break;
        case "irregular":
          lesson.sortString += "2";
          break;
        case "info":
          lesson.sortString += "3";
          break;
        default:
          lesson.sortString += "9";
      }

      lessons.push(lesson);
    });
    return lessons;
  },

  /**
   * Flatten raw exam objects into a simple format suitable for rendering.
   *
   * @param {Array} exams - raw exam objects returned by WebUntis
   * @returns {Array} flattened exam objects
   */
  examsToFlat(exams) {
    const ret_exams = [];

    exams.forEach((element) => {
      const exam = {
        year: element.examDate.toString().substring(0, 4),
        month: element.examDate.toString().substring(4, 6),
        day: element.examDate.toString().substring(6, 8),
        hour: element.startTime.toString().padStart(4, "0").substring(0, 2),
        minutes: element.startTime.toString().padStart(4, "0").substring(2),
        startTime: element.startTime.toString().padStart(4, "0"),
        teacher: element.teachers[0] || "N/A",
        subject: element.subject || "N/A",
        name: element.name || "",
        text: element.text || "",
        sortString: "",
      };

      // Create sort string
      exam.sortString = exam.year + exam.month + exam.day;

      ret_exams.push(exam);
    });
    return ret_exams;
  },
});
