// Import required modules
/* eslint-disable n/no-missing-require */
const NodeHelper = require('node_helper');
/* eslint-enable n/no-missing-require */
const { WebUntis } = require('webuntis');
const { WebUntisQR } = require('webuntis');
const { URL } = require('url');
const Authenticator = require('otplib').authenticator;
/* eslint-disable n/no-missing-require */
const Log = require('logger');
/* eslint-enable n/no-missing-require */

// Default cache TTL for per-request responses (ms). Small to favor freshness.
const DEFAULT_CACHE_TTL_MS = 30 * 1000;
// Default interval for periodic cache cleanup (ms)
const DEFAULT_CACHE_CLEANUP_INTERVAL_MS = 30 * 1000;

// Always fetch current data from WebUntis to ensure the frontend shows up-to-date information.

// Create a NodeHelper module
module.exports = NodeHelper.create({
  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start() {
    Log.info('[MMM-Webuntis] Node helper started');
    // node helper ready
    // initialize a tiny in-memory response cache
    this._responseCache = new Map(); // signature -> { ts, payload }
    this._cacheTTLMs = DEFAULT_CACHE_TTL_MS;
    // cache cleanup timer id
    this._cacheCleanupTimer = null;
    this._cacheCleanupIntervalMs = DEFAULT_CACHE_CLEANUP_INTERVAL_MS;
    // start periodic cache cleanup
    this._startCacheCleanup();
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

  // Reduce memory by keeping only the fields the frontend uses
  _compactTimegrid(rawGrid) {
    if (!Array.isArray(rawGrid)) return [];
    return rawGrid.map((row) => ({
      timeUnits: Array.isArray(row?.timeUnits)
        ? row.timeUnits.map((u) => ({
            startTime: u.startTime,
            endTime: u.endTime,
            name: u.name,
          }))
        : [],
    }));
  },

  _compactLessons(rawLessons) {
    if (!Array.isArray(rawLessons)) return [];
    return rawLessons.map((el) => ({
      date: el.date,
      startTime: el.startTime,
      endTime: el.endTime,
      su: el.su && el.su[0] ? [{ name: el.su[0].name, longname: el.su[0].longname }] : [],
      te: el.te && el.te[0] ? [{ name: el.te[0].name, longname: el.te[0].longname }] : [],
      code: el.code || '',
      substText: el.substText || '',
      lstext: el.lstext || '',
      id: el.id ?? null,
      lid: el.lid ?? null,
      lessonId: el.lessonId ?? null,
    }));
  },

  _compactExams(rawExams) {
    if (!Array.isArray(rawExams)) return [];
    return rawExams.map((ex) => ({
      examDate: ex.examDate,
      startTime: ex.startTime,
      endTime: ex.endTime ?? null,
      name: ex.name,
      subject: ex.subject,
      teachers: Array.isArray(ex.teachers) ? ex.teachers.slice(0, 2) : [],
      text: ex.text || '',
    }));
  },

  _compactHomeworks(rawHw) {
    if (!rawHw) return [];
    const hwArr = Array.isArray(rawHw)
      ? rawHw
      : Array.isArray(rawHw.homeworks)
        ? rawHw.homeworks
        : Array.isArray(rawHw.homework)
          ? rawHw.homework
          : [];
    return hwArr.map((hw) => ({
      id: hw.id ?? null,
      lid: hw.lid ?? null,
      lessonId: hw.lessonId ?? null,
      dueDate: hw.dueDate ?? hw.date ?? null,
      completed: hw.completed ?? null,
      text: hw.text ?? hw.description ?? hw.remark ?? '',
      remark: hw.remark ?? '',
      su:
        hw.su && typeof hw.su === 'object'
          ? { name: hw.su.name, longname: hw.su.longname }
          : hw.su && hw.su[0]
            ? { name: hw.su[0].name, longname: hw.su[0].longname }
            : null,
    }));
  },

  _compactAbsences(rawAbsences) {
    if (!Array.isArray(rawAbsences)) return [];
    return rawAbsences.map((a) => ({
      date: a.date ?? a.absenceDate ?? a.day ?? null,
      startTime: a.startTime ?? a.start ?? null,
      endTime: a.endTime ?? a.end ?? null,
      reason: a.reason ?? a.reasonText ?? a.text ?? '',
      excused: a.excused ?? a.isExcused ?? null,
      student: a.student ?? null,
      su: a.su && a.su[0] ? [{ name: a.su[0].name, longname: a.su[0].longname }] : [],
      te: a.te && a.te[0] ? [{ name: a.te[0].name, longname: a.te[0].longname }] : [],
      lessonId: a.lessonId ?? a.lid ?? a.id ?? null,
    }));
  },

  _wantsWidget(widgetName, displayMode) {
    const w = String(widgetName || '').toLowerCase();
    const dm = (displayMode === undefined || displayMode === null ? '' : String(displayMode)).toLowerCase();
    if (!w) return false;
    if (dm === w) return true;
    // Backwards compatible values
    if (w === 'grid' && dm.trim() === 'grid') return true;
    if ((w === 'lessons' || w === 'exams') && dm.trim() === 'list') return true;
    return dm
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .some((p) => {
        if (p === w) return true;
        if (w === 'homework' && (p === 'homeworks' || p === 'homework')) return true;
        if (w === 'absences' && (p === 'absence' || p === 'absences')) return true;
        return false;
      });
  },

  // Backend performs API calls only; no data normalization here.

  /*
   * Small in-memory cache helpers keyed by a request signature (stringified
   * object describing credential + request options). Each entry stores a
   * payload and a timestamp and expires after `_cacheTTLMs` milliseconds.
   */
  _makeRequestSignature(student) {
    try {
      const credKey = this._getCredentialKey(student);
      const wantsHomeworkWidget = this._wantsWidget('homework', this.config?.displayMode);
      const wantsAbsencesWidget = this._wantsWidget('absences', this.config?.displayMode);

      const wantsGridWidget = this._wantsWidget('grid', this.config?.displayMode);
      const wantsLessonsWidget = this._wantsWidget('lessons', this.config?.displayMode);
      const wantsExamsWidget = this._wantsWidget('exams', this.config?.displayMode);

      // Data fetching is driven by widgets; legacy per-student flags can only disable.
      const fetchHomeworksEffective = Boolean(wantsHomeworkWidget && student.fetchHomeworks !== false);
      const fetchAbsencesEffective = Boolean(wantsAbsencesWidget && student.fetchAbsences !== false);
      // include the most relevant options that affect the backend fetch
      const sig = {
        credKey,
        daysToShow: Number(student.daysToShow || 0),
        pastDaysToShow: Number(student.pastDaysToShow || 0),
        useClassTimetable: Boolean(student.useClassTimetable),
        examsDaysAhead: Number(student.examsDaysAhead || 0),
        wantsGrid: wantsGridWidget,
        wantsLessons: wantsLessonsWidget,
        wantsExams: wantsExamsWidget,
        fetchHomeworks: fetchHomeworksEffective,
        fetchAbsences: fetchAbsencesEffective,
      };
      return JSON.stringify(sig);
    } catch {
      return String(Date.now());
    }
  },

  _getCachedResponse(signature) {
    if (!this._responseCache) return null;
    const rec = this._responseCache.get(signature);
    if (!rec) return null;
    const age = Date.now() - (rec.ts || 0);
    const ttl = Number(this._cacheTTLMs || DEFAULT_CACHE_TTL_MS);
    if (age > ttl) {
      this._responseCache.delete(signature);
      return null;
    }
    return rec.payload;
  },

  _storeCachedResponse(signature, payload) {
    if (!this._responseCache) this._responseCache = new Map();
    try {
      this._responseCache.set(signature, { ts: Date.now(), payload });
    } catch (e) {
      // if cache insert fails, don't block operation
      this._mmLog('debug', null, `Cache store failed for ${signature}: ${e && e.message ? e.message : e}`);
    }
  },

  /* Periodic cache cleanup ------------------------------------------------
   * Removes expired cache entries. Runs on an interval configured by
   * `_cacheCleanupIntervalMs` and respects `_cacheTTLMs` for entry expiration.
   */
  _cacheCleanup() {
    try {
      if (!this._responseCache || this._responseCache.size === 0) return;
      const now = Date.now();
      const ttl = Number(this._cacheTTLMs || DEFAULT_CACHE_TTL_MS);
      for (const [sig, rec] of this._responseCache.entries()) {
        if (!rec || !rec.ts) {
          this._responseCache.delete(sig);
          continue;
        }
        if (now - rec.ts > ttl) {
          this._responseCache.delete(sig);
        }
      }
      this._mmLog('debug', null, `Cache cleanup completed (remaining=${this._responseCache.size})`);
    } catch (err) {
      this._mmLog('debug', null, `Cache cleanup error: ${this._formatErr(err)}`);
    }
  },

  _startCacheCleanup() {
    try {
      if (this._cacheCleanupTimer) return;
      const interval = Number(this._cacheCleanupIntervalMs || DEFAULT_CACHE_CLEANUP_INTERVAL_MS) || DEFAULT_CACHE_CLEANUP_INTERVAL_MS;
      this._cacheCleanupTimer = setInterval(() => this._cacheCleanup(), interval);
      this._mmLog('debug', null, `Started cache cleanup interval ${interval}ms`);
    } catch {
      // non-fatal
    }
  },

  _stopCacheCleanup() {
    try {
      if (this._cacheCleanupTimer) {
        clearInterval(this._cacheCleanupTimer);
        this._cacheCleanupTimer = null;
      }
    } catch {
      // ignore
    }
  },

  /**
   * Process a credential group: login, fetch data for students and logout.
   * This function respects the inflightRequests Map's pending flag: if pending
   * becomes true while running, it will loop once more to handle the coalesced request.
   */
  async processGroup(credKey, students, identifier) {
    // Single-run processing: authenticate, fetch data for each student, and logout.
    let untis = null;
    const sample = students[0];
    try {
      try {
        untis = this._createUntisClient(sample);
      } catch {
        this._mmLog('error', null, `No credentials for group ${credKey}`);
        return;
      }

      await untis.login();
      for (const student of students) {
        try {
          // Build a signature for this student's request and consult cache
          const sig = this._makeRequestSignature(student);
          const cached = this._getCachedResponse(sig);
          if (cached) {
            // deliver cached payload to the requesting module id (preserve id)
            try {
              const cachedForSend = { ...cached, id: identifier };
              this.sendSocketNotification('GOT_DATA', cachedForSend);
              this._mmLog('debug', student, `Cache hit for ${student.title} (sig=${sig})`);
              continue;
            } catch (err) {
              this._mmLog('error', student, `Failed to send cached GOT_DATA for ${student.title}: ${this._formatErr(err)}`);
              // fall through to perform a fresh fetch
            }
          }

          // Not cached or send failed: fetch fresh and store in cache
          const payload = await this.fetchData(untis, student, identifier, credKey);
          if (payload) {
            try {
              // store a copy without the id (id varies per requester)
              const storeable = { ...payload, id: undefined };
              this._storeCachedResponse(sig, storeable);
              this._mmLog('debug', student, `Stored payload in cache for ${student.title} (sig=${sig})`);
            } catch (err) {
              this._mmLog('debug', student, `Cache store skipped for ${student.title}: ${this._formatErr(err)}`);
            }
          }
        } catch (err) {
          this._mmLog('error', student, `Error fetching data for ${student.title}: ${this._formatErr(err)}`);
        }
      }
    } catch (error) {
      this._mmLog('error', null, `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`);
    } finally {
      try {
        if (untis) await untis.logout();
      } catch (err) {
        this._mmLog('error', null, `Error during logout for group ${credKey}: ${this._formatErr(err)}`);
      }
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

        // For each credential group process independently. Do not coalesce requests
        // across module instances so that per-instance options are always respected.
        for (const [credKey, students] of groups.entries()) {
          // Run sequentially to reduce peak memory usage on low-RAM devices
          await this.processGroup(credKey, students, identifier);
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

    const wantsGridWidget = this._wantsWidget('grid', this.config?.displayMode);
    const wantsLessonsWidget = this._wantsWidget('lessons', this.config?.displayMode);
    const wantsExamsWidget = this._wantsWidget('exams', this.config?.displayMode);
    const wantsHomeworkWidget = this._wantsWidget('homework', this.config?.displayMode);
    const wantsAbsencesWidget = this._wantsWidget('absences', this.config?.displayMode);

    // Data fetching is driven by widgets; legacy per-student flags can only disable.
    const fetchTimegrid = Boolean(wantsGridWidget);
    const fetchTimetable = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchExams = Boolean(wantsGridWidget || wantsExamsWidget);
    const fetchHomeworks = Boolean(wantsHomeworkWidget && student.fetchHomeworks !== false);
    const fetchAbsences = Boolean(wantsAbsencesWidget && student.fetchAbsences !== false);

    var rangeStart = new Date(Date.now());
    var rangeEnd = new Date(Date.now());

    rangeStart.setDate(rangeStart.getDate() - student.pastDaysToShow);
    rangeEnd.setDate(rangeEnd.getDate() - student.pastDaysToShow + parseInt(student.daysToShow));

    // Get Timegrid (raw) - only needed for grid widget
    let grid = [];
    if (fetchTimegrid) {
      try {
        grid = await this._getTimegrid(untis, credKey);
      } catch (error) {
        this._mmLog('error', null, `getTimegrid error for ${credKey}: ${error && error.message ? error.message : error}`);
      }
    }

    // Prepare raw timetable containers
    let timetable = [];

    if (fetchTimetable && student.daysToShow > 0) {
      try {
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
    if (fetchExams && student.examsDaysAhead > 0) {
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
    if (fetchHomeworks) {
      try {
        let hwRangeEnd = new Date(rangeEnd);
        hwRangeEnd.setDate(hwRangeEnd.getDate() + 7);
        // Try a sequence of candidate homework API calls (first that succeeds wins)
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
    } else {
      logger(`[MMM-Webuntis] Homework fetch skipped for ${student.title} (fetchHomeworks=false)`);
    }

    // Absences (raw)
    let rawAbsences = [];
    if (fetchAbsences) {
      try {
        const candidates = [
          () => untis.getAbsentLesson(rangeStart, rangeEnd),
          () => untis.getAbsentLesson(rangeStart, rangeEnd, student.id),
          () => untis.getAbsentLesson(rangeStart, rangeEnd, student.studentId),
        ];
        let lastErr = null;
        for (const fn of candidates) {
          try {
            const res = await fn();
            rawAbsences = Array.isArray(res)
              ? res
              : Array.isArray(res?.absences)
                ? res.absences
                : Array.isArray(res?.absentLessons)
                  ? res.absentLessons
                  : [];
            break;
          } catch (err) {
            lastErr = err;
          }
        }
        if (!Array.isArray(rawAbsences) || rawAbsences.length === 0) {
          logger(
            `[MMM-Webuntis] Absences fetch returned no data for ${student.title}${lastErr ? ` (lastErr=${this._formatErr(lastErr)})` : ''}`
          );
        } else {
          logger(`[MMM-Webuntis] Loaded absences (raw) for ${student.title}: count=${rawAbsences.length}`);
        }
      } catch (error) {
        this._mmLog('error', student, `Absences fetch error for ${student.title}: ${error && error.message ? error.message : error}`);
      }
    } else {
      logger(`[MMM-Webuntis] Absences fetch skipped for ${student.title} (fetchAbsences=false)`);
    }

    // Compact payload to reduce memory before caching and sending to the frontend.
    const compactGrid = this._compactTimegrid(grid);
    const compactTimetable = this._compactLessons(timetable);
    const compactExams = this._compactExams(rawExams);
    const compactHomeworks = fetchHomeworks ? this._compactHomeworks(hwResult) : [];
    const compactAbsences = fetchAbsences ? this._compactAbsences(rawAbsences) : [];

    // Build payload and send it. Also return the payload for caching callers.
    const payload = {
      title: student.title,
      config: student,
      // id will be assigned by the caller to preserve per-request id
      timegrid: compactGrid,
      timetableRange: compactTimetable,
      exams: compactExams,
      homeworks: compactHomeworks,
      absences: compactAbsences,
    };
    try {
      const forSend = { ...payload, id: identifier };
      this.sendSocketNotification('GOT_DATA', forSend);
    } catch (err) {
      this._mmLog('error', student, `Failed to send GOT_DATA to ${identifier}: ${this._formatErr(err)}`);
    }
    return payload;
  },
});
