// Import required modules
const NodeHelper = require('node_helper');
const { WebUntis } = require('webuntis');
const { WebUntisQR } = require('webuntis');
const { URL } = require('url');
const Authenticator = require('otplib').authenticator;
const Log = require('logger');

// Always fetch current data from WebUntis to ensure the frontend shows up-to-date information.

// Create a NodeHelper module
module.exports = NodeHelper.create({
  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start() {
    Log.info('[MMM-Webuntis] Node helper started');
    // track inflight fetches per credential key to avoid duplicate parallel work
    this._inflightRequests = this._inflightRequests || new Map();
  },

  /*
   * Create an authenticated WebUntis client from a student sample config.
   * Returns a client instance or throws an Error if credentials missing.
   */
  _createUntisClient(sample) {
    if (sample.qrcode) {
      return new WebUntisQR(sample.qrcode, 'custom-identity', Authenticator, URL);
    }
    if (sample.username) {
      return new WebUntis(sample.school, sample.username, sample.password, sample.server);
    }
    throw new Error('No credentials provided');
  },

  // Format errors consistently for logs
  _formatErr(err) {
    if (!err) return '(no error)';
    return err && err.message ? err.message : String(err);
  },

  // Backend performs API calls only; no data normalization here.

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
          this._mmLog('error', null, `No credentials for group ${credKey}`);
          break;
        }

        await untis.login();
        for (const student of students) {
          try {
            await this.fetchData(untis, student, identifier, credKey);
          } catch (err) {
            this._mmLog('error', student, `Error fetching data for ${student.title}: ${this._formatErr(err)}`);
          }
        }
      } catch (error) {
        this._mmLog('error', null, `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`);
      } finally {
        try {
          if (untis) await untis.logout();
        } catch (e) {
          this._mmLog('error', null, `Error during logout for group ${credKey}: ${this._formatErr(e)}`);
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
      if (level === 'info') {
        Log.info(`${prefix} ${message}`);
      } else if (level === 'error') {
        Log.error(`${prefix} ${message}`);
      } else if (level === 'debug') {
        if (this.config && this.config.logLevel === 'debug') {
          if (typeof Log.debug === 'function') {
            Log.debug(`${prefix} ${message}`);
          } else {
            Log.info(`${prefix} [DEBUG] ${message}`);
          }
        }
      } else {
        Log.info(`${prefix} ${message}`);
      }
    } catch (e) {
      Log.error(`[MMM-Webuntis] Error in logging: ${e && e.message ? e.message : e}`);
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
    if (notification === 'FETCH_DATA') {
      // Assign incoming payload to module config
      this.config = payload;
      this._mmLog('info', null, `FETCH_DATA received (students=${Array.isArray(this.config.students) ? this.config.students.length : 0})`);

      try {
        // Group students by credential so we can reuse the same untis session
        const identifier = this.config.id;
        const groups = new Map();

        const properties = [
          'daysToShow',
          'pastDaysToShow',
          'showStartTime',
          'useClassTimetable',
          'showRegularLessons',
          'showTeacherMode',
          'useShortSubject',
          'showSubstitutionText',
          'examsDaysAhead',
          'showExamSubject',
          'showExamTeacher',
          'logLevel',
        ];

        // normalize student configs and group
        for (const student of this.config.students) {
          properties.forEach((prop) => {
            student[prop] = student[prop] !== undefined ? student[prop] : this.config[prop];
          });
          if (student.daysToShow < 0 || student.daysToShow > 10 || isNaN(student.daysToShow)) {
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
            this._mmLog('info', null, `Fetch for ${credKey} already in progress - coalescing request`);
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
        this._mmLog('info', null, 'Successfully fetched data');
      } catch (error) {
        this._mmLog('error', null, `Error loading Untis data: ${error}`);
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
    const server = student.server || 'default';
    return `user:${student.username}@${server}/${student.school}`;
  },

  /**
   * Return the timegrid for the given credential. Always fetch fresh data from WebUntis.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {string} credKey - Credential key (currently unused)
   * @returns {Promise<Array>} timegrid array
   */
  async _getTimegrid(untis, credKey) {
    try {
      const grid = await untis.getTimegrid();
      return grid || [];
    } catch (err) {
      // return empty array on error
      this._mmLog('error', null, `Error fetching timegrid for ${credKey}: ${err && err.message ? err.message : err}`);
      return [];
    }
  },

  /**
   * Return the week's timetable for the given credential and week start.
   * Always fetch fresh data from WebUntis.
   *
   * @param {Object} untis - Authenticated WebUntis client
   * @param {string} credKey - Credential key (currently unused)
   * @param {Date} rangeStart - Week start date
   * @returns {Promise<Array>} week timetable
   */
  async _getWeekTimetable(untis, credKey, rangeStart) {
    try {
      const weekTimetable = await untis.getOwnTimetableForWeek(rangeStart);
      return weekTimetable || [];
    } catch (err) {
      this._mmLog('error', null, `Error fetching week timetable for ${credKey}: ${err && err.message ? err.message : err}`);
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
      this._mmLog('debug', student, msg);
    };
    // Backend fetches raw data from Untis API. No transformation here.

    var rangeStart = new Date(Date.now());
    var rangeEnd = new Date(Date.now());

    rangeStart.setDate(rangeStart.getDate() - student.pastDaysToShow);
    rangeEnd.setDate(rangeEnd.getDate() - student.pastDaysToShow + parseInt(student.daysToShow));

    // Get Timegrid (raw) - cached per credential by WebUntis itself
    let grid = [];
    try {
      grid = await this._getTimegrid(untis, credKey);
    } catch (error) {
      this._mmLog('error', null, `getTimegrid error for ${credKey}: ${error && error.message ? error.message : error}`);
    }

    // Prepare raw timetable containers
    let timetable = [];
    let weekTimetable = [];

    if (student.daysToShow > 0) {
      try {
        // Additionally fetch the week's timetable (raw)
        weekTimetable = await this._getWeekTimetable(untis, credKey, rangeStart);

        if (student.useClassTimetable) {
          logger(`[MMM-Webuntis] getOwnClassTimetableForRange from ${rangeStart} to ${rangeEnd}`);
          timetable = await untis.getOwnClassTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownClassTimetable received for ${student.title}`);
        } else {
          logger(`[MMM-Webuntis] getOwnTimetableForRange from ${rangeStart} to ${rangeEnd}`);
          timetable = await untis.getOwnTimetableForRange(rangeStart, rangeEnd);
          logger(`[MMM-Webuntis] ownTimetable received for ${student.title}`);
        }
      } catch (error) {
        this._mmLog('error', student, `Timetable fetch error for ${student.title}: ${error && error.message ? error.message : error}`);
      }
    }

    // Exams (raw)
    let rawExams = [];
    if (student.examsDaysAhead > 0) {
      // Validate the number of days
      if (student.examsDaysAhead < 1 || student.examsDaysAhead > 360 || isNaN(student.examsDaysAhead)) {
        student.examsDaysAhead = 30;
      }

      // var rangeStart = new Date(Date.now());
      // var rangeEnd = new Date(Date.now());
      rangeEnd.setDate(rangeStart.getDate() + student.examsDaysAhead);

      try {
        rawExams = await untis.getExamsForRange(rangeStart, rangeEnd);
        this._lastRawExams = rawExams;
      } catch (error) {
        this._mmLog('error', student, `Exams fetch error for ${student.title}: ${error && error.message ? error.message : error}`);
      }
    }

    // Load homework for the period (from today until rangeEnd + 7 days) – keep raw
    let hwResult = null;
    try {
      let hwRangeEnd = new Date(rangeEnd);
      hwRangeEnd.setDate(hwRangeEnd.getDate() + 7);
      // Try a sequence of candidate homework API calls (first that succeeds wins)
      try {
        const candidates = [() => untis.getHomeWorkAndLessons(new Date(), hwRangeEnd), () => untis.getHomeWorksFor(new Date(), hwRangeEnd)];
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
          logger(`[MMM-Webuntis] Homework fetch failed for ${student.title}: ${lastErr}`);
        }
      } catch (error) {
        logger(`[MMM-Webuntis] Homework fetch unexpected error for ${student.title}: ${error}`);
        hwResult = null;
      }
      // Send raw homework payload to the frontend without normalization
      const hwCount = Array.isArray(hwResult)
        ? hwResult.length
        : Array.isArray(hwResult?.homeworks)
          ? hwResult.homeworks.length
          : Array.isArray(hwResult?.homework)
            ? hwResult.homework.length
            : 0;
      logger(`[MMM-Webuntis] Loaded homeworks (raw) for ${student.title}: count=${hwCount}`);
    } catch (error) {
      this._mmLog('error', student, `Homework fetch error for ${student.title}: ${error && error.message ? error.message : error}`);
    }

    // Send raw API responses only; frontend will handle all transformations
    this.sendSocketNotification('GOT_DATA', {
      title: student.title,
      config: student,
      id: identifier,
      timegrid: grid || [],
      timetableRange: timetable || [],
      weekTimetable: weekTimetable || [],
      exams: rawExams || [],
      homeworks: hwResult || null,
    });
  },
});
