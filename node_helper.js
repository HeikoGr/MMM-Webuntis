// Import required modules
const NodeHelper = require("node_helper");
const {WebUntis} = require("webuntis");
const {WebUntisQR} = require("webuntis");
const {URL} = require("url");
const Authenticator = require("otplib").authenticator;
const Log = require("logger");

/*
 * Simple caches to avoid redundant API calls across students/sessions
 * Limited size caches with TTL to prevent memory leaks
 */
const timegridCache = {}; // keyed by credentialKey
const weekTimetableCache = {}; // keyed by credentialKey + rangeStart
const MAX_CACHE_ENTRIES = 50; // Limit cache size to prevent unbounded growth
const WEEK_CACHE_TTL = 1000 * 60 * 30; // 30 minutes for week timetable cache

// Create a NodeHelper module
module.exports = NodeHelper.create({

  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start () {
    Log.info("[MMM-Webuntis] Node helper started");
    // track inflight fetches per credential key to avoid duplicate parallel work
    this._inflightRequests = this._inflightRequests || {};

    // Periodic cache cleanup to prevent unbounded growth
    this._cacheCleanupTimer = setInterval(() => {
      this._cleanupCaches();
    }, 1000 * 60 * 60); // Run every hour
  },

  /**
   * Centralized backend logger that honors module and per-student debug flags.
   * Emits messages using the MagicMirror `Log` helper.
   *
   * @param {'info'|'debug'|'error'} level
   * @param {Object|null} student
   * @param {string} message
   */
  _mmLog (level, student, message) {
    try {
      const prefix = "[MMM-Webuntis]";
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
      // swallow
    }
  },

  /**
   * Clean up caches to prevent memory leaks. Removes old entries based on TTL
   * and limits total cache size.
   */
  _cleanupCaches () {
    try {
      const now = Date.now();

      // Clean week timetable cache (TTL-based)
      const weekKeys = Object.keys(weekTimetableCache);
      let removed = 0;
      for (const key of weekKeys) {
        const entry = weekTimetableCache[key];
        // If entry has a timestamp and is older than TTL, remove it
        if (entry && entry._fetchedAt && now - entry._fetchedAt > WEEK_CACHE_TTL) {
          delete weekTimetableCache[key];
          removed++;
        }
      }

      // If still too many entries, remove oldest
      const remainingKeys = Object.keys(weekTimetableCache);
      if (remainingKeys.length > MAX_CACHE_ENTRIES) {
        const sortedKeys = remainingKeys.sort((a, b) => {
          const aTime = weekTimetableCache[a]?._fetchedAt || 0;
          const bTime = weekTimetableCache[b]?._fetchedAt || 0;
          return aTime - bTime;
        });
        const toRemove = sortedKeys.slice(0, remainingKeys.length - MAX_CACHE_ENTRIES);
        toRemove.forEach((k) => delete weekTimetableCache[k]);
        removed += toRemove.length;
      }

      // Limit timegrid cache size (keep most recent entries)
      const timegridKeys = Object.keys(timegridCache);
      if (timegridKeys.length > MAX_CACHE_ENTRIES) {
        const sortedKeys = timegridKeys.sort((a, b) => {
          const aTime = timegridCache[a]?.fetchedAt || 0;
          const bTime = timegridCache[b]?.fetchedAt || 0;
          return aTime - bTime;
        });
        const toRemove = sortedKeys.slice(0, timegridKeys.length - MAX_CACHE_ENTRIES);
        toRemove.forEach((k) => delete timegridCache[k]);
        removed += toRemove.length;
      }

      if (removed > 0) {
        this._mmLog("debug", null, `Cache cleanup: removed ${removed} old entries`);
      }
    } catch (e) {
      this._mmLog("error", null, `Cache cleanup error: ${e && e.message
        ? e.message
        : e}`);
    }
  },

  /**
   * Handle socket notifications sent by the frontend module.
   * Currently listens for `FETCH_DATA` which contains the module config.
   *
   * @param {string} notification - Notification name
   * @param {any} payload - Notification payload
   */
  async socketNotificationReceived (notification, payload) {
    if (notification === "FETCH_DATA") {
      // Assign incoming payload to config (payload may contain legacy keys)
      this.config = payload;
      this._mmLog("info", null, `FETCH_DATA received (students=${Array.isArray(this.config.students)
        ? this.config.students.length
        : 0})`);

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
          "logLevel"
        ];

        // normalize student configs and group
        for (const student of this.config.students) {
          properties.forEach((prop) => {
            student[prop] = student[prop] !== undefined
              ? student[prop]
              : this.config[prop];
          });
          if (student.daysToShow < 0 || student.daysToShow > 10 || isNaN(student.daysToShow)) {
            student.daysToShow = 1;
          }

          const credKey = this._getCredentialKey(student);
          if (!groups.has(credKey)) {
            groups.set(credKey, []);
          }
          groups.get(credKey).push(student);
        }

        /*
         * For each credential group, process with coalescing inflight handling.
         * If a fetch for the same credKey is already running, we set a pending flag
         * so that the group is fetched once more when the current run finishes.
         */
        for (const [credKey, students] of groups.entries()) {
          if (!this._inflightRequests) {
            this._inflightRequests = {};
          }
          // If already running, mark pending and continue
          if (this._inflightRequests[credKey] && this._inflightRequests[credKey].running) {
            this._inflightRequests[credKey].pending = true;
            this._mmLog("info", null, `Fetch for ${credKey} already in progress - coalescing request`);
            continue;
          }

          // initialize inflight entry
          this._inflightRequests[credKey] = {running: true, pending: false};

          // Launch an async worker that will process the group and rerun if pending was set
          (async () => {
            while (true) {
              let untis = null;
              const sample = students[0];
              try {
                if (sample.qrcode) {
                  untis = new WebUntisQR(sample.qrcode, "custom-identity", Authenticator, URL);
                } else if (sample.username) {
                  untis = new WebUntis(sample.school, sample.username, sample.password, sample.server);
                } else {
                  this._mmLog("error", null, `No credentials for group ${credKey}`);
                  break;
                }

                await untis.login();
                for (const student of students) {
                  try {
                    await this.fetchData(untis, student, identifier, credKey);
                  } catch (err) {
                    this._mmLog("error", student, `Error fetching data for ${student.title}: ${err && err.message
                      ? err.message
                      : err}`);
                  }
                }
              } catch (error) {
                this._mmLog("error", null, `Error during login/fetch for group ${credKey}: ${error && error.message
                  ? error.message
                  : error}`);
              } finally {
                try {
                  if (untis) {
                    await untis.logout();
                  }
                } catch (e) {
                  // ignore logout errors
                }
              }

              // if another request arrived while we were running, run again once
              if (this._inflightRequests[credKey] && this._inflightRequests[credKey].pending) {
                this._inflightRequests[credKey].pending = false;
                // loop again to process the latest coalesced request
                continue;
              }

              // no pending work: clear running flag and exit worker
              if (this._inflightRequests[credKey]) {
                this._inflightRequests[credKey].running = false;
              }
              break;
            }
          })();
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
  _getCredentialKey (student) {
    if (student.qrcode) {
      return `qrcode:${student.qrcode}`;
    }
    const server = student.server || "default";
    return `user:${student.username}@${server}/${student.school}`;
  },

  /**
   * Return the timegrid for the given credential, using an in-memory cache.
   * The timegrid contains named time units that are used to position lessons
   * in the UI. Cache TTL is one hour.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {string} credKey - Credential key
   * @returns {Promise<Array>} timegrid array
   */
  async _getTimegridCached (untis, credKey) {
    const ttl = 1000 * 60 * 60; // 1 hour
    const now = Date.now();
    const cached = timegridCache[credKey];
    if (cached && now - cached.fetchedAt < ttl) {
      return cached.data;
    }
    try {
      const grid = await untis.getTimegrid();
      timegridCache[credKey] = {fetchedAt: now, data: grid};
      return grid;
    } catch (err) {
      // return empty array on error
      return [];
    }
  },

  /**
   * Return the week's timetable for the given credential and week start.
   * Cached per credential+week to avoid repeated API calls.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {string} credKey - Credential key
   * @param {Date} rangeStart - Week start date
   * @returns {Promise<Array>} week timetable
   */
  async _getWeekTimetableCached (untis, credKey, rangeStart) {
    const key = `${credKey}:${rangeStart.toDateString()}`;
    const cached = weekTimetableCache[key];
    const now = Date.now();

    // Return cached if exists and not expired
    if (cached && cached.data && (!cached._fetchedAt || now - cached._fetchedAt < WEEK_CACHE_TTL)) {
      return cached.data;
    }

    try {
      const weekTimetable = await untis.getOwnTimetableForWeek(rangeStart);
      weekTimetableCache[key] = {
        data: weekTimetable || [],
        _fetchedAt: now
      };
      return weekTimetableCache[key].data;
    } catch (err) {
      weekTimetableCache[key] = {
        data: [],
        _fetchedAt: now
      };
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
  async fetchData (untis, student, identifier, credKey) {
    const logger = (msg) => {
      this._mmLog("debug", student, msg);
    };

    // small helper: convert HHMM (number|string) or H:MM to minutes since midnight
    function toMinutes (t) {
      if (t === null || t === undefined) {
        return NaN;
      }
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
    }

    let lessons = [];
    let exams = [];
    let homeworks = [];
    const startTimes = [];
    const timeUnits = [];
    let todayLessons = [];

    var rangeStart = new Date(Date.now());
    var rangeEnd = new Date(Date.now());

    rangeStart.setDate(rangeStart.getDate() - student.pastDaysToShow);
    rangeEnd.setDate(rangeEnd.getDate() - student.pastDaysToShow + parseInt(student.daysToShow));

    // Get Timegrid (for mapping start/end times) - cached per credential
    let grid = [];
    try {
      grid = await this._getTimegridCached(untis, credKey);
      if (grid && grid[0] && grid[0].timeUnits) {
        grid[0].timeUnits.forEach((element) => {
          startTimes[element.startTime] = element.name;
          const startMin = toMinutes(element.startTime);
          const endMin = element.endTime
            ? toMinutes(element.endTime)
            : null;
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
      this._mmLog("error", null, `getTimegrid error for ${credKey}: ${error && error.message
        ? error.message
        : error}`);
    }

    if (student.daysToShow > 0) {
      try {
        let timetable;

        /*
         * Additionally fetch the week's timetable to get full WebAPI timetable entries
         * This helps to obtain stable lesson IDs (WebAPITimetable) to link homeworks
         * Use cached week timetable per credential+start date to avoid duplicate calls
         */
        const weekTimetable = await this._getWeekTimetableCached(untis, credKey, rangeStart);

        if (student.useClassTimetable) {
          logger(`[MMM-Webuntis] getOwnClassTimetableForRange from ${rangeStart} to ${rangeEnd}`);
          timetable = await untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownClassTimetable received for ${student.title}`);
        } else {
          logger(`[MMM-Webuntis] getOwnTimetableForRange from ${rangeStart} to ${rangeEnd}`);
          timetable = await untis.getOwnTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownTimetable received for ${student.title}`);
        }

        /*
         * Convert timetable entries to lesson objects and try to enrich them with lessonId.
         * Keep processed lessons for backward compatibility, but also include raw data so the
         * frontend can rely on raw data if desired.
         */
        lessons = this.timetableToLessons(startTimes, timetable, weekTimetable);

        // Filter lessons for today
        const today = new Date();
        const todayStr = today.getFullYear().toString() + `0${today.getMonth() + 1}`.slice(-2) + `0${today.getDate()}`.slice(-2);
        todayLessons = timetable.filter((l) => l.date.toString() === todayStr).map((l) => ({
          subject: l.su?.[0]?.longname || "N/A",
          subjectShort: l.su?.[0]?.name || "N/A",
          teacher: l.te?.[0]?.longname || "N/A",
          teacherInitial: l.te?.[0]?.name || "N/A",
          startTime: l.startTime,
          endTime: l.endTime,
          startMin: toMinutes(l.startTime),
          endMin: l.endTime
            ? toMinutes(l.endTime)
            : null,
          code: l.code || "",
          text: l.lstext || "",
          substText: l.substText || "",
          lessonNumber: startTimes[l.startTime],
          // try to capture lesson id from common fields (depends on WebUntis wrapper version)
          lessonId: l.id ?? l.lid ?? l.lessonId ?? null
        }));
      } catch (error) {
        this._mmLog("error", student, `Timetable fetch error for ${student.title}: ${error && error.message
          ? error.message
          : error}`);
      }
    }

    if (student.examsDaysAhead > 0) {
      // Validate the number of days
      if (student.examsDaysAhead < 1 || student.examsDaysAhead > 360 || isNaN(student.examsDaysAhead)) {
        student.examsDaysAhead = 30;
      }

      var rangeStart = new Date(Date.now());
      var rangeEnd = new Date(Date.now());
      rangeEnd.setDate(rangeStart.getDate() + student.examsDaysAhead);

      try {
        const rawExams = await untis.getExamsForRange(rangeStart, rangeEnd);
        exams = this.examsToFlat(rawExams);
        // keep rawExams as well for frontend processing if desired
        exams ||= [];
        this._lastRawExams = rawExams;
      } catch (error) {
        this._mmLog("error", student, `Exams fetch error for ${student.title}: ${error && error.message
          ? error.message
          : error}`);
      }
    }

    /*
     * Load homework for the period (from today until rangeEnd + 7 days)
     * Limit homework lookback to prevent excessive data accumulation
     */
    try {
      const hwRangeEnd = new Date(rangeEnd);
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

      // Limit homework array size to prevent memory issues (keep most recent 100)
      if (homeworks.length > 100) {
        homeworks = homeworks.slice(0, 100);
      }

      logger(`[MMM-Webuntis] Loaded ${homeworks.length} homeworks for ${student.title}`);
    } catch (error) {
      this._mmLog("error", student, `Homework fetch error for ${student.title}: ${error && error.message
        ? error.message
        : error}`);
    }

    // Before sending data, perform a quick debug validation: ensure lessons/timeUnits have numeric minutes
    if (student.logLevel) {
      const missingLessonMinutes = lessons.filter((l) => l.startMin === undefined || l.startMin === null || l.endMin === undefined || l.endMin === null).length;
      const missingTimeUnits = timeUnits.filter((tu) => tu.startMin === undefined || tu.startMin === null).length;
      logger(`Debug validation for ${student.title}: lessons without minutes=${missingLessonMinutes}, timeUnits without minutes=${missingTimeUnits}`);
    }

    /*
     * Send processed data for backward compatibility, and include minimal raw API responses
     * to reduce memory usage on low-memory devices
     */
    this.sendSocketNotification("GOT_DATA", {
      title: student.title,
      config: student,
      lessons,
      exams,
      id: identifier,
      todayLessons,
      timeUnits,
      homeworks
      // Raw data removed to reduce memory footprint - frontend has all needed processed data
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
  timetableToLessons (startTimes, timetable, weekTimetable = []) {
    // Convert time strings like '0740' or '7:40' to minutes since midnight
    const toMinutes = (t) => {
      if (t === null || t === undefined) {
        return NaN;
      }
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
        endTime: element.endTime
          ? element.endTime.toString().padStart(4, "0")
          : null,
        startMin: toMinutes(element.startTime),
        endMin: element.endTime
          ? toMinutes(element.endTime)
          : null,
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

  /**
   * Flatten raw exam objects into a simple format suitable for rendering.
   *
   * @param {Array} exams - raw exam objects returned by WebUntis
   * @returns {Array} flattened exam objects
   */
  examsToFlat (exams) {
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
