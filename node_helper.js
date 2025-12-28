/* eslint-disable n/no-missing-require */
const NodeHelper = require('node_helper');
/* eslint-enable n/no-missing-require */
const { WebUntis, WebUntisQR } = require('webuntis');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { authenticator: OtpAuthenticator } = require('otplib');
const { URL } = require('url');
/* eslint-disable n/no-missing-require */
const Log = require('logger');
/* eslint-enable n/no-missing-require */

// New utility modules for refactoring
const restClient = require('./lib/restClient');
const { compactArray, schemas } = require('./lib/payloadCompactor');
const { validateConfig, applyLegacyMappings } = require('./lib/configValidator');
const { createBackendLogger } = require('./lib/logger');

// Always fetch current data from WebUntis to ensure the frontend shows up-to-date information.
// Create a NodeHelper module
module.exports = NodeHelper.create({
  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start() {
    this._mmLog('debug', null, 'Node helper started');
    // Initialize unified logger
    this.logger = createBackendLogger(this._mmLog.bind(this), 'MMM-Webuntis');
    // expose payload compactor so linters don't flag unused imports until full refactor
    this.payloadCompactor = { compactArray };
    // Initialize REST API cache (token + cookies) keyed by credential
    this._restAuthCache = new Map(); // cacheKey -> { token, cookieString, expiresAt }
    // Cache resolved class ids per credential/class name to avoid repeated filter calls
    this._classIdCache = new Map(); // cacheKey -> classId
    // Track whether config warnings have been emitted to frontend to avoid repeat spam
    this._configWarningsSent = false;
    // Persist debugDate across FETCH_DATA requests to ensure consistent date-based testing
    this._persistedDebugDate = null;
  },

  _normalizeLegacyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;
    const out = { ...cfg };

    const legacyUsed = [];
    const mapLegacy = (obj, legacyKey, newKey, transform, context = 'config') => {
      if (!obj || typeof obj !== 'object') return;
      const hasLegacy = obj[legacyKey] !== undefined && obj[legacyKey] !== null && obj[legacyKey] !== '';
      if (!hasLegacy) return;
      legacyUsed.push(`${context}.${legacyKey}`);
      const legacyVal = typeof transform === 'function' ? transform(obj[legacyKey]) : obj[legacyKey];
      obj[newKey] = legacyVal;
    };

    mapLegacy(out, 'fetchInterval', 'fetchIntervalMs', (v) => Number(v), 'config');
    // Map legacy `days` to the new preferred `nextDays` key
    mapLegacy(out, 'days', 'nextDays', (v) => Number(v), 'config');
    mapLegacy(out, 'examsDays', 'examsDaysAhead', (v) => Number(v), 'config');
    mapLegacy(out, 'mergeGapMin', 'mergeGapMinutes', (v) => Number(v), 'config');

    const dbg = out.debug ?? out.enableDebug;
    if (typeof dbg === 'boolean') {
      legacyUsed.push('config.debug|enableDebug');
      out.logLevel = dbg ? 'debug' : 'none';
    }

    if (out.displaymode !== undefined && out.displaymode !== null && out.displaymode !== '') {
      legacyUsed.push('config.displaymode');
      out.displayMode = String(out.displaymode).toLowerCase();
    }
    if (typeof out.displayMode === 'string') out.displayMode = out.displayMode.toLowerCase();

    if (legacyUsed.length > 0) {
      try {
        const uniq = Array.from(new Set(legacyUsed));
        const warningMsg = `⚠️ Deprecated config keys detected and mapped: ${uniq.join(', ')}. Please update your config to use the new keys. Look in debug output for the normalized config.`;

        // Attach warning to config.__warnings so it gets sent to frontend and displayed in GUI
        out.__warnings = out.__warnings || [];
        out.__warnings.push(warningMsg);

        // Also log it to server logs
        this._mmLog('warn', null, warningMsg);

        // Log the normalized config as formatted JSON (with redacted sensitive data) for reference (server-side only)
        const redacted = { ...out };
        if (redacted.password) redacted.password = '***redacted***';
        if (redacted.qrcode) redacted.qrcode = '***redacted***';
        if (redacted.students && Array.isArray(redacted.students)) {
          redacted.students = redacted.students.map((s) => {
            const student = { ...s };
            if (student.password) student.password = '***redacted***';
            if (student.qrcode) student.qrcode = '***redacted***';
            return student;
          });
        }
        const formattedJson = JSON.stringify(redacted, null, 2);
        this._mmLog('info', null, `Normalized config:\n${formattedJson}`);
      } catch (e) {
        this._mmLog('debug', null, `Failed to process legacy config: ${e && e.message ? e.message : e}`);
      }
    }

    return out;
  },

  /**
   * Build REST targets for a student depending on login mode (QR vs. parent account).
   * Returns an ordered array of targets; QR login (if present) comes first, then parent.
   */
  _buildRestTargets(student, moduleConfig, school, server, ownPersonId) {
    const targets = [];
    const useQrLogin = Boolean(student.qrcode);
    const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
    const studentId = hasStudentId ? Number(student.studentId) : null;
    const hasParentCreds = Boolean(moduleConfig?.username && moduleConfig?.password);

    if (useQrLogin && school && server) {
      targets.push({
        mode: 'qr',
        school,
        server,
        username: null,
        password: null,
        studentId: ownPersonId || studentId || null,
      });
    }

    if (!useQrLogin && hasParentCreds && studentId !== null) {
      targets.push({
        mode: 'parent',
        school: school || moduleConfig.school,
        server: server || moduleConfig.server || 'webuntis.com',
        username: moduleConfig.username,
        password: moduleConfig.password,
        studentId,
      });
    }

    return targets;
  },

  /**
   * Invoke a REST helper with a target descriptor (school/server + credentials).
   * Keeps call sites concise and consistent.
   */
  async _callRest(fn, target, ...args) {
    return fn.call(this, target.school, target.username, target.password, target.server, ...args);
  },

  // ---------------------------------------------------------------------------
  // Logging and error helpers
  // ---------------------------------------------------------------------------

  _mmLog(level, student, message) {
    const moduleTag = '[MMM-Webuntis]';
    const studentTag = student && student.title ? ` [${String(student.title).trim()}]` : '';
    const formatted = `${moduleTag}${studentTag} ${message}`;

    // Always forward debug messages to the underlying MagicMirror logger.
    // The MagicMirror logging subsystem (or the environment) decides which
    // levels to actually emit. Avoid double-filtering here to ensure debug
    // output is visible when the system is configured for debug logging.
    if (level === 'debug') {
      Log.debug(formatted);
      return;
    }

    if (level === 'error') {
      Log.error(formatted);
      return;
    }

    if (level === 'warn') {
      Log.warn(formatted);
      return;
    }

    // default/info
    Log.info(formatted);
  },

  _formatErr(err) {
    if (!err) return '(no error)';
    return String(err?.message || err);
  },

  /**
   * Map REST API status to legacy JSON-RPC code format
   * REST status values: REGULAR, CANCELLED, ADDITIONAL, CHANGED, SUBSTITUTION
   * Legacy code values: '', 'cancelled', 'error', 'info', 'irregular'
   * 'irregular' is used for replacement/substitution lessons
   */
  _mapRestStatusToLegacyCode(status, substitutionText) {
    if (!status) return '';

    const statusUpper = String(status).toUpperCase();
    const hasSubstitutionText = substitutionText && String(substitutionText).trim() !== '';

    switch (statusUpper) {
      case 'CANCELLED':
      case 'CANCEL':
        return 'cancelled'; // Display with cancelled styling
      case 'ADDITIONAL':
      case 'CHANGED':
      case 'SUBSTITUTION':
      case 'SUBSTITUTE':
        return 'irregular'; // Use 'irregular' for replacement/substitution lessons (legacy compat)
      case 'REGULAR':
      case 'NORMAL':
      case 'NORMAL_TEACHING_PERIOD':
        // If there's substitution text, treat it as a replacement lesson
        return hasSubstitutionText ? 'irregular' : '';
      default:
        return hasSubstitutionText ? 'irregular' : '';
    }
  },

  /**
   * REST API Authentication: Get Bearer Token and Session Cookies
   * Returns: { token, cookieString, tenantId, schoolYearId, expiresAt }
   */
  async _getRestAuthTokenAndCookies(school, username, password, server, options = {}) {
    const restCache = this._restAuthCache instanceof Map ? this._restAuthCache : new Map();
    this._restAuthCache = restCache;

    const { cacheKey, untisClient } = options || {};
    const effectiveCacheKey = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;

    const cached = restCache.get(effectiveCacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        appData: cached.appData,
      };
    }

    let appData = null;

    // Prefer an already logged-in Untis client (QR or parent login) to avoid duplicate logins
    if (untisClient && typeof untisClient._buildCookies === 'function') {
      const cookieString = untisClient._buildCookies();
      if (!cookieString) {
        throw new Error('No session cookies available from existing login');
      }

      let token = null;
      if (typeof untisClient._getJWT === 'function') {
        try {
          token = await untisClient._getJWT(false);
        } catch (err) {
          this._mmLog('debug', null, `[REST] JWT via existing session failed: ${this._formatErr(err)}`);
        }
      }

      // Fetch app/data to get tenantId and schoolYearId
      let tenantId = null;
      let schoolYearId = null;
      try {
        const appDataResp = await axios.get(`https://${server}/WebUntis/api/rest/view/v1/app/data`, {
          headers: {
            Cookie: cookieString,
            Accept: 'application/json',
          },
          validateStatus: () => true,
          timeout: 15000,
        });

        if (appDataResp.status === 200 && appDataResp.data) {
          appData = appDataResp.data;
          tenantId = appDataResp.data?.tenant?.id;
          schoolYearId = appDataResp.data?.currentSchoolYear?.id;
        }
      } catch (err) {
        this._mmLog('debug', null, `[REST] Failed to fetch app/data: ${this._formatErr(err)}`);
      }

      restCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId,
        schoolYearId,
        appData,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      return { token, cookieString, tenantId, schoolYearId, appData };
    }

    try {
      // Step 1: Authenticate via JSON-RPC to get session cookies
      const authResp = await axios.post(
        `https://${server}/WebUntis/jsonrpc.do?school=${encodeURIComponent(school)}`,
        {
          jsonrpc: '2.0',
          method: 'authenticate',
          params: {
            user: username,
            password,
            client: 'App',
          },
          id: 1,
        },
        { validateStatus: () => true, timeout: 10000 }
      );

      if (authResp.status !== 200) {
        throw new Error(`JSON-RPC auth failed: ${authResp.status}`);
      }

      // Step 2: Extract cookies from Set-Cookie headers
      const cookies = {};
      const setCookies = authResp.headers['set-cookie'] || [];
      setCookies.forEach((setCookie) => {
        const [cookie] = setCookie.split(';');
        const [key, value] = cookie.split('=');
        if (key && value) {
          cookies[key.trim()] = value;
        }
      });

      const cookieString = Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');

      if (!cookieString) {
        throw new Error('No session cookies received');
      }

      // Step 3: Get Bearer Token using the session cookies
      const tokenResp = await axios.get(`https://${server}/WebUntis/api/token/new`, {
        headers: { Cookie: cookieString },
        validateStatus: () => true,
        timeout: 10000,
      });

      if (tokenResp.status !== 200 || typeof tokenResp.data !== 'string') {
        throw new Error(`Bearer token request failed: ${tokenResp.status}`);
      }

      const token = tokenResp.data;

      // Fetch app/data to get tenantId and schoolYearId
      let tenantId = null;
      let schoolYearId = null;
      try {
        const appDataResp = await axios.get(`https://${server}/WebUntis/api/rest/view/v1/app/data`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Cookie: cookieString,
            Accept: 'application/json',
          },
          validateStatus: () => true,
          timeout: 15000,
        });

        if (appDataResp.status === 200 && appDataResp.data) {
          appData = appDataResp.data;
          tenantId = appDataResp.data?.tenant?.id;
          schoolYearId = appDataResp.data?.currentSchoolYear?.id;
        }
      } catch (err) {
        this._mmLog('debug', null, `[REST] Failed to fetch app/data: ${this._formatErr(err)}`);
      }

      // Cache the token (expires in 900 seconds, with buffer we cache for 14 minutes)
      restCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId,
        schoolYearId,
        appData,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      this._mmLog('debug', null, 'REST auth token obtained successfully');
      return { token, cookieString, tenantId, schoolYearId, appData };
    } catch (error) {
      Log.error(`REST auth failed: ${error.message}`);
      throw error;
    }
  },

  _collectClassCandidates(data) {
    const candidates = new Map(); // id -> candidate

    const addCandidate = (item) => {
      if (!item || typeof item !== 'object') return;
      const type = (item.resourceType || item.elementType || item.type || item.category || '').toString().toUpperCase();
      // Accept only class-typed or untyped entries to avoid pulling in rooms/teachers
      if (type && type !== 'CLASS') return;

      const name =
        item.name ||
        item.shortName ||
        item.longName ||
        item.displayName ||
        (item.current && (item.current.shortName || item.current.name || item.current.longName));
      if (!item.id || !name) return;

      if (!candidates.has(item.id)) {
        candidates.set(item.id, {
          id: item.id,
          name: name,
          shortName: item.shortName || (item.current && item.current.shortName) || name,
          longName: item.longName || (item.current && item.current.longName) || name,
        });
      }
    };

    const walk = (node) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node !== 'object') return;

      addCandidate(node);
      Object.values(node).forEach((v) => walk(v));
    };

    walk(data);
    return Array.from(candidates.values());
  },

  async _resolveClassIdViaRest(school, username, password, server, rangeStart, rangeEnd, className, options = {}) {
    const desiredName = className && String(className).trim();
    const cacheKeyBase = options.cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;
    // Include studentId in cache key so each student has their own class cache entry
    const studentIdPart = options.studentId ? `::student::${options.studentId}` : '';
    const cacheKey = `${cacheKeyBase}${studentIdPart}::class::${(desiredName || '').toLowerCase()}`;
    if (this._classIdCache && this._classIdCache.has(cacheKey)) {
      return this._classIdCache.get(cacheKey);
    }

    const formatDateISO = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    const formatDateYYYYMMDD = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };

    const { token, cookieString, tenantId, schoolYearId } = await this._getRestAuthTokenAndCookies(
      school,
      username,
      password,
      server,
      options
    );

    if (!cookieString) {
      throw new Error('Missing REST auth cookies for class resolution');
    }

    const headers = {
      Cookie: cookieString,
      Accept: 'application/json',
    };
    if (tenantId) headers['Tenant-Id'] = String(tenantId);
    if (schoolYearId) headers['X-Webuntis-Api-School-Year-Id'] = String(schoolYearId);
    if (token) headers.Authorization = `Bearer ${token}`;

    let candidates = [];

    let mappedClassId = null;

    // Aggressive path: if we have a studentId, try classservices first (closest to "what this student sees")
    if (options.studentId) {
      try {
        const resp = await axios.get(`https://${server}/WebUntis/api/classreg/classservices`, {
          params: {
            startDate: formatDateYYYYMMDD(rangeStart),
            endDate: formatDateYYYYMMDD(rangeEnd),
            elementId: options.studentId,
          },
          headers,
          validateStatus: () => true,
          timeout: 15000,
        });

        if (resp.status === 200 && resp.data) {
          candidates = this._collectClassCandidates(resp.data);
          // Prefer explicit mapping from personKlasseMap when present
          const map = resp.data?.data?.personKlasseMap;
          if (map && Object.prototype.hasOwnProperty.call(map, options.studentId)) {
            const mapped = map[options.studentId];
            if (Number.isFinite(Number(mapped))) mappedClassId = Number(mapped);
          }
          this._mmLog('debug', null, `[REST] classservices returned ${candidates.length} class candidates`);
        } else {
          this._mmLog('debug', null, `[REST] classservices failed with status ${resp.status}`);
        }
      } catch (err) {
        this._mmLog('debug', null, `[REST] classservices error: ${this._formatErr(err)}`);
      }
    }

    // Secondary path: timetable/filter (broader) if nothing found yet
    if (!candidates || candidates.length === 0) {
      try {
        const resp = await axios.get(`https://${server}/WebUntis/api/rest/view/v1/timetable/filter`, {
          params: {
            resourceType: 'CLASS',
            timetableType: 'STANDARD',
            start: formatDateISO(rangeStart),
            end: formatDateISO(rangeEnd),
          },
          headers,
          validateStatus: () => true,
          timeout: 15000,
        });

        if (resp.status === 200 && resp.data) {
          candidates = this._collectClassCandidates(resp.data);
          this._mmLog('debug', null, `[REST] timetable/filter returned ${candidates.length} class candidates`);
        } else {
          this._mmLog('debug', null, `[REST] timetable/filter failed with status ${resp.status}`);
        }
      } catch (err) {
        this._mmLog('debug', null, `[REST] timetable/filter error: ${this._formatErr(err)}`);
      }
    }

    if (!candidates || candidates.length === 0) {
      throw new Error('No accessible classes returned by REST API');
    }

    let chosen = null;
    // If classservices told us the class id for this student, pick it first
    if (mappedClassId && candidates.some((c) => Number(c.id) === Number(mappedClassId))) {
      chosen = candidates.find((c) => Number(c.id) === Number(mappedClassId));
      this._mmLog('debug', null, `[REST] personKlasseMap selected classId=${mappedClassId}`);
    }

    if (desiredName) {
      const desiredLower = desiredName.toLowerCase();
      chosen = candidates.find((c) =>
        [c.name, c.shortName, c.longName].filter(Boolean).some((n) => String(n).toLowerCase() === desiredLower)
      );
    }

    if (!chosen && !desiredName && candidates.length === 1) {
      chosen = candidates[0];
      this._mmLog('debug', null, `[REST] No class name configured; using sole available class ${chosen.name} (${chosen.id})`);
    }

    if (!chosen) {
      const available = candidates
        .map((c) => `${c.name || c.shortName || c.longName || c.id}`)
        .filter(Boolean)
        .join(', ');
      const hint = desiredName ? `Class "${desiredName}" not found. Available: ${available}` : `Multiple classes available: ${available}`;
      throw new Error(hint);
    }

    this._classIdCache.set(cacheKey, chosen.id);
    return chosen.id;
  },

  /**
   * Get timetable via REST API using unified restClient
   */
  async _getTimetableViaRest(
    school,
    username,
    password,
    server,
    rangeStart,
    rangeEnd,
    studentId,
    options = {},
    useClassTimetable = false,
    className = null
  ) {
    const wantsClass = Boolean(useClassTimetable || options.useClassTimetable);
    this._mmLog(
      'debug',
      null,
      `Fetching ${wantsClass ? 'class' : 'student'} timetable via REST API (${restClient.formatDateForAPI(
        rangeStart
      )} to ${restClient.formatDateForAPI(rangeEnd)})`
    );
    try {
      const { token, cookieString, tenantId, schoolYearId } = await this._getRestAuthTokenAndCookies(
        school,
        username,
        password,
        server,
        options
      );

      if (!cookieString) {
        throw new Error('Missing REST auth cookies');
      }

      let resourceType = wantsClass ? 'CLASS' : 'STUDENT';
      let resourceId = wantsClass ? options.classId : studentId;

      if (wantsClass) {
        if (!resourceId) {
          resourceId = await this._resolveClassIdViaRest(
            school,
            username,
            password,
            server,
            rangeStart,
            rangeEnd,
            className || options.className || null,
            { ...options, studentId }
          );
        }
        if (!resourceId) {
          throw new Error('Class timetable requested but class id could not be resolved');
        }
      }

      if (!resourceId) {
        throw new Error('Missing resource id for timetable request');
      }

      // ✅ Use unified REST call with restClient.callRestAPI
      const resp = await restClient.callRestAPI({
        server,
        path: '/WebUntis/api/rest/view/v1/timetable/entries',
        method: 'GET',
        params: {
          start: restClient.formatDateForAPI(rangeStart),
          end: restClient.formatDateForAPI(rangeEnd),
          resourceType,
          resources: String(resourceId),
          timetableType: 'STANDARD',
        },
        token,
        cookies: cookieString,
        tenantId,
        schoolYearId,
        timeout: 15000,
        logger: (level, msg) => this._mmLog(level, null, msg),
      });

      // Transform REST response to JSON-RPC format
      const lessons = [];
      this._mmLog(
        'debug',
        null,
        `Response data structure: days=${resp?.days ? 'present' : 'missing'}, hasDays=${Array.isArray(resp?.days)}`
      );
      if (resp && resp.days && Array.isArray(resp.days)) {
        this._mmLog('debug', null, `Processing ${resp.days.length} days from API response`);
        resp.days.forEach((day) => {
          if (day.gridEntries && Array.isArray(day.gridEntries)) {
            day.gridEntries.forEach((entry) => {
              const lesson = {
                id: entry.ids && entry.ids[0] ? entry.ids[0] : null,
                date: day.date.split('T')[0],
                startTime: entry.duration?.start ? entry.duration.start.split('T')[1] : '',
                endTime: entry.duration?.end ? entry.duration.end.split('T')[1] : '',
                su: entry.position2
                  ? [
                      {
                        name: entry.position2[0].current.shortName,
                        longname: entry.position2[0].current.longName,
                      },
                    ]
                  : [],
                te: entry.position1
                  ? [
                      {
                        name: entry.position1[0].current.shortName,
                        longname: entry.position1[0].current.longName,
                      },
                    ]
                  : [],
                ro: entry.position3
                  ? [
                      {
                        name: entry.position3[0].current.shortName,
                        longname: entry.position3[0].current.longName,
                      },
                    ]
                  : [],
                code: this._mapRestStatusToLegacyCode(entry.status, entry.substitutionText),
                substText: entry.substitutionText || '',
                lstext: entry.lessonInfo || '',
                activityType: entry.type || 'NORMAL_TEACHING_PERIOD',
                lessonText: entry.lessonText || '',
                status: entry.status || 'REGULAR',
                statusDetail: entry.statusDetail || null,
              };
              lessons.push(lesson);
            });
          }
        });
      }

      this._mmLog('debug', null, `REST API returned ${lessons.length} lessons`);
      return lessons;
    } catch (error) {
      this._mmLog('error', null, `getTimetableViaRest failed: ${error.message}`);
      throw error;
    }
  },

  /**
   * Fetch exams via REST API for a student (parent account or own)
   * Returns exams in the format: [{ examDate, startTime, endTime, name, subject, teachers, text }, ...]
   */
  async _getExamsViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const startDate = rangeStart.toISOString().split('T')[0];
    const endDate = rangeEnd.toISOString().split('T')[0];
    this._mmLog('debug', null, `Fetching exams via REST API (${startDate} to ${endDate})`);
    try {
      const { token, cookieString, tenantId, schoolYearId } = await this._getRestAuthTokenAndCookies(
        school,
        username,
        password,
        server,
        options
      );

      const formatDateYYYYMMDD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      const data = await restClient.callRestAPI({
        server,
        path: '/WebUntis/api/exams',
        method: 'GET',
        params: {
          startDate: formatDateYYYYMMDD(rangeStart),
          endDate: formatDateYYYYMMDD(rangeEnd),
          studentId: studentId ?? -1,
          klasseId: -1,
          withGrades: true,
        },
        token,
        cookies: cookieString,
        tenantId,
        schoolYearId,
        timeout: 15000,
        logger: (level, msg) => this._mmLog(level, null, msg),
      });

      // Transform REST response to expected format
      const exams = [];
      let examArr = [];
      if (Array.isArray(data?.data?.exams)) {
        examArr = data.data.exams;
      } else if (Array.isArray(data?.exams)) {
        examArr = data.exams;
      } else if (Array.isArray(data)) {
        examArr = data;
      }

      examArr.forEach((exam) => {
        const isAssignedToStudent =
          studentId && Array.isArray(exam.assignedStudents) && exam.assignedStudents.some((s) => s.id === studentId);

        if (!studentId || isAssignedToStudent) {
          exams.push({
            examDate: this._normalizeDateToInteger(exam.examDate ?? exam.date),
            startTime: this._normalizeTimeToMinutes(exam.startTime ?? exam.start),
            endTime: this._normalizeTimeToMinutes(exam.endTime ?? exam.end),
            name: this._sanitizeHtmlText(exam.name ?? exam.examType ?? exam.lessonName ?? '', false),
            subject: this._sanitizeHtmlText(exam.subject ?? exam.lessonName ?? '', false),
            teachers: Array.isArray(exam.teachers) ? exam.teachers : [],
            text: this._sanitizeHtmlText(exam.text ?? exam.description ?? '', true),
          });
        }
      });

      this._mmLog('debug', null, `REST API returned ${exams.length} exams`);
      return exams;
    } catch (error) {
      this._mmLog('error', null, `getExamsViaRest failed: ${error.message}`);
      throw error;
    }
  },

  /**
   * Fetch homework via REST API for a student (parent account or own)
   * Returns homework in the format: [{ id, lid, lessonId, dueDate, completed, text, remark, su }, ...]
   * Uses /WebUntis/api/homeworks/lessons which returns homework and lesson data in parallel arrays
   *
   * @param {string} school - School identifier
   * @param {string} username - Username or email
   * @param {string} password - Password
   * @param {string} server - WebUntis server (e.g., "school.webuntis.com")
   * @param {Date} rangeStart - Start date for range
   * @param {Date} rangeEnd - End date for range
   * @param {number} studentId - Student ID for filtering homework
   * @param {object} options - Additional options (e.g., { logger: fn })
   * @returns {Promise<Array>} Normalized homework array
   */
  async _getHomeworkViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const startDate = rangeStart.toISOString().split('T')[0];
    const endDate = rangeEnd.toISOString().split('T')[0];
    this._mmLog('debug', null, `Fetching homework via REST API (${startDate} to ${endDate})`);
    try {
      const { token, cookieString, tenantId, schoolYearId } = await this._getRestAuthTokenAndCookies(
        school,
        username,
        password,
        server,
        options
      );

      const formatDateYYYYMMDD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      // Build request for homework via lessons endpoint
      // Endpoint: /WebUntis/api/homeworks/lessons
      // Returns: { data: { homeworks: [...], lessons: [...], teachers: [...], records: [...] } }
      // Build query params; include studentId when provided to allow server-side filtering
      const hwParams = {
        startDate: formatDateYYYYMMDD(rangeStart),
        endDate: formatDateYYYYMMDD(rangeEnd),
      };
      // Do not pass studentId as a query parameter to the /homeworks/lessons
      // endpoint — filter client-side using records/elementIds instead.

      const data = await restClient.callRestAPI({
        server,
        path: '/WebUntis/api/homeworks/lessons',
        method: 'GET',
        params: hwParams,
        token,
        cookies: cookieString,
        tenantId,
        schoolYearId,
        timeout: 15000,
        logger: (level, msg) => this._mmLog(level, null, msg),
      });

      // Extract homework from response
      // API returns: { data: { homeworks: [...], lessons: [...], records: [...], teachers: [...] } }

      const homeworks = [];
      const seenIds = new Set(); // Avoid duplicates

      // Handle both response formats:
      // Old (direct): { homeworks: [...], lessons: [...] }
      // New (nested): { data: { homeworks: [...], lessons: [...], records: [...] } }
      let hwArray = data.homeworks;
      let lessonsArray = data.lessons;

      if (!hwArray && data.data) {
        hwArray = data.data.homeworks;
        lessonsArray = data.data.lessons;
      }

      if (Array.isArray(hwArray)) {
        const lessonsMap = {};
        if (Array.isArray(lessonsArray)) {
          lessonsArray.forEach((lesson) => {
            if (lesson.id) {
              lessonsMap[lesson.id] = lesson;
            }
          });
        }

        // Build map of homeworkId -> elementIds from records (if provided)
        let recordsArray = data.records;
        if (!recordsArray && data.data) recordsArray = data.data.records;
        const recordsMap = {};
        if (Array.isArray(recordsArray)) {
          recordsArray.forEach((rec) => {
            if (rec && rec.homeworkId !== undefined && rec.homeworkId !== null) {
              recordsMap[rec.homeworkId] = Array.isArray(rec.elementIds) ? rec.elementIds.slice() : [];
            }
          });
        }

        hwArray.forEach((hw) => {
          // Avoid duplicates by checking homework ID
          const hwId = hw.id ?? `${hw.lessonId}_${hw.dueDate}`;
          if (!seenIds.has(hwId)) {
            seenIds.add(hwId);
            const lesson = lessonsMap[hw.lessonId];

            if (!lesson && hw.lessonId) {
              this._mmLog(
                'debug',
                null,
                `⚠️ No lesson found for homework ${hwId}. hw.lessonId=${hw.lessonId}, available lessonIds: ${Object.keys(lessonsMap).slice(0, 3).join(', ')}`
              );
            }

            // elementIds from records (may be empty)
            const elementIds = recordsMap[hw.id] || [];

            // If a specific studentId was requested, skip homeworks that don't target that element
            if (Number.isFinite(Number(studentId)) && Number(studentId) !== -1) {
              const matchesByElement = Array.isArray(elementIds) && elementIds.some((e) => Number(e) === Number(studentId));
              const matchesByField = hw.studentId && Number(hw.studentId) === Number(studentId);
              if (!matchesByElement && !matchesByField) return; // skip
            }

            // Build homework record
            const hwRecord = {
              id: hw.id ?? null,
              lessonId: hw.lessonId ?? hw.lid ?? null,
              dueDate: hw.dueDate ?? hw.date ?? null,
              completed: hw.completed ?? hw.isDone ?? false,
              text: hw.text ?? hw.homework ?? hw.remark ?? '',
              remark: hw.remark ?? '',
              // Transform lesson data into su format { name, longname }
              // If lesson has subject field, use it; otherwise use existing su
              su: lesson && lesson.subject ? [{ name: lesson.subject, longname: lesson.subject }] : (lesson?.su ?? (hw.su ? hw.su : [])),
              // Preserve elementIds so frontend can determine which students this homework targets
              elementIds,
              // Try to preserve an explicit studentId if present; otherwise infer from elementIds or request
              studentId: hw.studentId ?? (elementIds && elementIds.length ? elementIds[0] : (studentId ?? null)),
            };

            homeworks.push(hwRecord);
          }
        });
      }

      this._mmLog('debug', null, `REST API returned ${homeworks.length} homeworks`);
      return homeworks;
    } catch (error) {
      this._mmLog('error', null, `getHomeworkViaRest failed: ${error.message}`);
      throw error;
    }
  },

  async _getAbsencesViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    try {
      const { token, cookieString, tenantId, schoolYearId } = await this._getRestAuthTokenAndCookies(
        school,
        username,
        password,
        server,
        options
      );

      const formatDateYYYYMMDD = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      const data = await restClient.callRestAPI({
        server,
        path: '/WebUntis/api/classreg/absences/students',
        method: 'GET',
        params: {
          startDate: formatDateYYYYMMDD(rangeStart),
          endDate: formatDateYYYYMMDD(rangeEnd),
          studentId: studentId ?? -1,
          excuseStatusId: -1,
        },
        token,
        cookies: cookieString,
        tenantId,
        schoolYearId,
        timeout: 15000,
        logger: (level, msg) => this._mmLog(level, null, msg),
      });

      const absences = [];
      let absArr = [];
      if (Array.isArray(data?.data?.absences)) {
        absArr = data.data.absences;
      } else if (Array.isArray(data?.absences)) {
        absArr = data.absences;
      } else if (Array.isArray(data?.absentLessons)) {
        absArr = data.absentLessons;
      } else if (Array.isArray(data)) {
        absArr = data;
      }

      absArr.forEach((abs) => {
        absences.push({
          date: abs.date ?? abs.startDate ?? abs.absenceDate ?? abs.day ?? null,
          startTime: abs.startTime ?? abs.start ?? null,
          endTime: abs.endTime ?? abs.end ?? null,
          reason: abs.reason ?? abs.reasonText ?? abs.text ?? '',
          excused: abs.isExcused ?? abs.excused ?? null,
          student: abs.student ?? null,
          su: abs.su && abs.su[0] ? [{ name: abs.su[0].name, longname: abs.su[0].longname }] : [],
          te: abs.te && abs.te[0] ? [{ name: abs.te[0].name, longname: abs.te[0].longname }] : [],
          lessonId: abs.lessonId ?? abs.lid ?? abs.id ?? null,
        });
      });

      this._mmLog('debug', null, `REST API returned ${absences.length} absences`);
      return absences;
    } catch (error) {
      this._mmLog('error', null, `getAbsencesViaRest failed: ${error.message}`);
      throw error;
    }
  },

  async _getMessagesOfDayViaRest(school, username, password, server, date, options = {}) {
    this._mmLog('debug', null, `Fetching messages of day via REST API for date=${date.toISOString()}`);
    try {
      const { token, cookieString } = await this._getRestAuthTokenAndCookies(school, username, password, server, options);

      const formatDateYYYYMMDD = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      // Build request for messages of the day
      // Endpoint: /WebUntis/api/public/news/newsWidgetData (from WebUI)
      const headers = {
        Cookie: cookieString,
        Accept: 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await axios.get(`https://${server}/WebUntis/api/public/news/newsWidgetData`, {
        params: {
          date: formatDateYYYYMMDD(date),
        },
        headers,
        validateStatus: () => true,
        timeout: 15000,
      });

      if (resp.status !== 200) {
        throw new Error(`REST API returned status ${resp.status} for messages of day`);
      }

      // Parse response - handles nested data.messagesOfDay structure
      let messages = [];
      if (Array.isArray(resp.data?.data?.messagesOfDay)) {
        messages = resp.data.data.messagesOfDay;
      } else if (Array.isArray(resp.data?.messagesOfDay)) {
        messages = resp.data.messagesOfDay;
      } else if (Array.isArray(resp.data?.messages)) {
        messages = resp.data.messages;
      } else if (Array.isArray(resp.data)) {
        messages = resp.data;
      }

      this._mmLog('debug', null, `REST API returned ${messages.length} messages of the day`);
      return messages;
    } catch (error) {
      this._mmLog('error', null, `getMessagesOfDayViaRest failed: ${error.message}`);
      throw error;
    }
  },

  _resolveSchoolAndServer(student) {
    let school = student.school || this.config?.school || null;
    let server = student.server || this.config?.server || null;

    if ((!school || !server) && student.qrcode) {
      try {
        const qrUrl = new URL(student.qrcode);
        school = school || qrUrl.searchParams.get('school');
        server = server || qrUrl.searchParams.get('url');
      } catch (err) {
        this._mmLog('error', student, `Failed to parse QR code for school/server: ${this._formatErr(err)}`);
      }
    }

    // Normalize server host if a full URL was provided
    if (server && server.startsWith('http')) {
      try {
        server = new URL(server).hostname;
      } catch {
        // leave as-is
      }
    }

    return { school, server };
  },

  _deriveStudentsFromAppData(appData) {
    if (!appData || !appData.user || !Array.isArray(appData.user.students)) return [];
    const derived = [];
    appData.user.students.forEach((st, idx) => {
      const sid = Number(st?.id ?? st?.studentId ?? st?.personId);
      if (!Number.isFinite(sid)) return;
      const title = st?.displayName || st?.name || `Student ${idx + 1}`;
      derived.push({ title, studentId: sid, imageUrl: st?.imageUrl || null });
    });
    return derived;
  },

  async _ensureStudentsFromAppData(moduleConfig) {
    try {
      if (!moduleConfig || typeof moduleConfig !== 'object') return;

      const configuredStudentsRaw = Array.isArray(moduleConfig.students) ? moduleConfig.students : [];
      // Treat students array as "not configured" when it contains no real credentials
      const configuredStudents = configuredStudentsRaw.filter((s) => {
        if (!s || typeof s !== 'object') return false;
        const hasStudentId = s.studentId !== undefined && s.studentId !== null && String(s.studentId).trim() !== '';
        const hasQr = Boolean(s.qrcode);
        const hasCreds = Boolean(s.username && s.password);
        return hasStudentId || hasQr || hasCreds;
      });
      let autoStudents = null;

      const hasParentCreds = Boolean(moduleConfig.username && moduleConfig.password && moduleConfig.school);
      if (!hasParentCreds) return;

      // Only auto-discover if NO students with real credentials are configured at all
      // If user explicitly configured ANY real students, respect that choice
      if (configuredStudents.length > 0) {
        // However, if any student is missing a title but has a studentId,
        // try to fetch auto-discovered data to fill in the missing titles
        const server = moduleConfig.server || 'webuntis.com';
        try {
          const { appData } = await this._getRestAuthTokenAndCookies(
            moduleConfig.school,
            moduleConfig.username,
            moduleConfig.password,
            server
          );
          autoStudents = this._deriveStudentsFromAppData(appData);

          if (autoStudents && autoStudents.length > 0) {
            // For each configured student try to improve the configured data:
            // - If studentId exists but title is missing, fill title from auto-discovered list
            // - If title exists but no studentId, compute candidate ids (prefer title matches)
            configuredStudents.forEach((configStudent) => {
              if (!configStudent || typeof configStudent !== 'object') return;

              // Fill missing title when we have an id
              if (configStudent.studentId && !configStudent.title) {
                const autoStudent = autoStudents.find((auto) => Number(auto.studentId) === Number(configStudent.studentId));
                if (autoStudent) {
                  configStudent.title = autoStudent.title;
                  this._mmLog(
                    'debug',
                    configStudent,
                    `Filled in auto-discovered name: "${autoStudent.title}" for studentId ${configStudent.studentId}`
                  );
                  return;
                }
              }

              // If title is present but no studentId, suggest candidate ids based on title match
              if ((!configStudent.studentId || configStudent.studentId === '') && configStudent.title) {
                const titleLower = String(configStudent.title).toLowerCase();
                const matched = autoStudents.filter((a) => (a.title || '').toLowerCase().includes(titleLower));
                const candidateIds = (matched.length > 0 ? matched : autoStudents).map((s) => Number(s.studentId));
                const msg = `Student with title "${configStudent.title}" has no studentId configured. Possible studentIds: ${candidateIds.join(', ')}.`;
                configStudent.__warnings = configStudent.__warnings || [];
                configStudent.__warnings.push(msg);
                this._mmLog('warn', configStudent, msg);
                return;
              }
            });
          }
        } catch (err) {
          this._mmLog('warn', null, `Could not fetch auto-discovered names for title fallback: ${this._formatErr(err)}`);
        }
        // Additionally validate configured studentIds against discovered students
        try {
          if (autoStudents && autoStudents.length > 0) {
            configuredStudents.forEach((configStudent) => {
              if (!configStudent || !configStudent.studentId) return;
              const match = autoStudents.find((a) => Number(a.studentId) === Number(configStudent.studentId));
              if (!match) {
                // Prefer candidates that match by title; otherwise include all ids
                const candidateMatches = configStudent.title
                  ? autoStudents.filter((a) => (a.title || '').toLowerCase().includes(String(configStudent.title).toLowerCase()))
                  : [];
                const candidateIds = (candidateMatches.length > 0 ? candidateMatches : autoStudents).map((s) => Number(s.studentId));
                const msg = `Configured studentId ${configStudent.studentId} for title "${configStudent.title || ''}" was not found in auto-discovered students. Possible studentIds: ${candidateIds.join(', ')}.`;
                configStudent.__warnings = configStudent.__warnings || [];
                configStudent.__warnings.push(msg);
                this._mmLog('warn', configStudent, msg);
              }
            });
          }
        } catch {
          // ignore validation errors
        }

        return;
      }

      const server = moduleConfig.server || 'webuntis.com';
      const { appData } = await this._getRestAuthTokenAndCookies(moduleConfig.school, moduleConfig.username, moduleConfig.password, server);
      autoStudents = this._deriveStudentsFromAppData(appData);

      if (!autoStudents || autoStudents.length === 0) {
        this._mmLog('warn', null, 'No students discovered via app/data; please configure students[] manually');
        return;
      }

      // Merge module-level defaults into each discovered student so downstream
      // fetch logic has the expected fields (daysToShow, examsDaysAhead, etc.)
      // Only assign discovered students once to avoid repeated re-assignment
      // during periodic fetches which can lead to duplicate or inconsistent
      // entries being appended to the runtime config.
      if (!moduleConfig._autoStudentsAssigned) {
        const defNoStudents = { ...(moduleConfig || {}) };
        delete defNoStudents.students;
        const normalizedAutoStudents = autoStudents.map((s) => {
          const merged = { ...defNoStudents, ...(s || {}) };
          return this._normalizeLegacyConfig(merged, this.defaults);
        });

        moduleConfig.students = normalizedAutoStudents;
        moduleConfig._autoStudentsAssigned = true;

        // Log all discovered students with their IDs in a prominent way
        const studentList = normalizedAutoStudents.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
        this._mmLog('info', null, `✓ Auto-discovered ${normalizedAutoStudents.length} student(s):\n  ${studentList}`);
      } else {
        this._mmLog('debug', null, 'Auto-discovered students already assigned; skipping reassignment');
      }
    } catch (err) {
      this._mmLog('warn', null, `Auto student discovery failed: ${this._formatErr(err)}`);
    }
  },

  /*
   * Create an authenticated WebUntis client from a student sample config.
   * For parent account mode (student has studentId but no own credentials),
   * use the module-level username and password.
   * Returns a WebUntis client instance (logged in) or throws an Error if credentials missing.
   */
  _createUntisClient(sample, moduleConfig) {
    const hasStudentId = sample.studentId && Number.isFinite(Number(sample.studentId));
    const useQrLogin = Boolean(sample.qrcode);
    const hasOwnCredentials = sample.username && sample.password && sample.school && sample.server;
    const isParentMode = hasStudentId && !hasOwnCredentials && !useQrLogin;

    // Mode 0: QR Code Login (student)
    if (useQrLogin) {
      this._mmLog('debug', sample, 'Creating WebUntisQR client for QR code login');
      return new WebUntisQR(sample.qrcode, 'MMM-Webuntis', OtpAuthenticator, URL);
    }

    // Mode 1: Parent Account (studentId + parent credentials from moduleConfig)
    if (isParentMode && moduleConfig && moduleConfig.username && moduleConfig.password) {
      const school = sample.school || moduleConfig.school;
      const server = sample.server || moduleConfig.server || 'webuntis.com';
      this._mmLog('debug', sample, `Creating WebUntis client for parent account (school=${school}, server=${server})`);
      return new WebUntis(school, moduleConfig.username, moduleConfig.password, server);
    }

    // Mode 2: Direct Student Login (own credentials)
    if (hasOwnCredentials) {
      this._mmLog('debug', sample, `Creating WebUntis client for direct login (school=${sample.school}, server=${sample.server})`);
      return new WebUntis(sample.school, sample.username, sample.password, sample.server);
    }

    // No valid credentials found
    let errorMsg = '\nCredentials missing! need either:';
    errorMsg += '\n  (1) studentId + username/password in module config, or';
    errorMsg += '\n  (2) username/password/school/server in student config, or';
    errorMsg += '\n  (3) qrcode in student config for QR code login\n';

    this._mmLog('error', sample, errorMsg);
    throw new Error(errorMsg);
  },

  // Reduce memory by keeping only the fields the frontend uses
  // Returns timeUnits array directly instead of wrapping in an object,
  // since timeUnits (lesson slots) are the same for all days.
  _compactTimegrid(rawGrid) {
    if (!Array.isArray(rawGrid) || rawGrid.length === 0) return [];
    // All rows should have identical timeUnits; use the first row as canonical
    const firstRow = rawGrid[0];
    if (firstRow && Array.isArray(firstRow.timeUnits)) {
      return firstRow.timeUnits.map((u) => ({
        startTime: u.startTime,
        endTime: u.endTime,
        name: u.name,
      }));
    }
    return [];
  },

  /**
   * Sanitize HTML text by removing tags but preserving intentional line breaks (<br>)
   * Converts <br>, <br/>, <br /> to newlines, then strips all remaining HTML tags
   */
  _sanitizeHtmlText(text, preserveLineBreaks = true) {
    if (!text) return '';
    let result = String(text);

    // Step 1: Preserve intentional line breaks by converting <br> tags to placeholders
    if (preserveLineBreaks) {
      result = result.replace(/<br\s*\/?>/gi, '\n');
    }

    // Step 2: Remove all remaining HTML tags
    result = result.replace(/<[^>]*>/g, '');

    // Step 3: Decode HTML entities
    result = result
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&'); // Must be last

    // Step 4: Clean up extra whitespace (but preserve intentional newlines)
    result = result.replace(/\s+/g, ' ').trim();

    return result;
  },

  /**
   * Normalize date format from REST API (ISO string) to internal format (YYYYMMDD integer)
   * Accepts: "2025-12-17" → 20251217
   */
  _normalizeDateToInteger(date) {
    if (!date) return null;
    // If already an integer in YYYYMMDD format, return as-is
    if (typeof date === 'number' && date > 10000000 && date < 99991231) {
      return date;
    }
    // Parse ISO string format "YYYY-MM-DD" → YYYYMMDD
    const dateStr = String(date);
    if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const y = parts[0].padStart(4, '0');
        const m = parts[1].padStart(2, '0');
        const d = parts[2].padStart(2, '0');
        return parseInt(`${y}${m}${d}`, 10);
      }
    }
    // Try to parse as plain number
    const num = parseInt(String(date).replace(/\D/g, ''), 10);
    return num > 10000000 && num < 99991231 ? num : null;
  },

  /**
   * Normalize time format from REST API (HH:MM string) to internal format (HHMM integer)
   * Accepts: "07:50" → 750 or "08:45" → 845
   */
  _normalizeTimeToMinutes(time) {
    if (!time && time !== 0) return null;
    // If already an integer in HHMM format, return as-is
    if (typeof time === 'number' && time >= 0 && time < 2400) {
      return time;
    }
    // Parse HH:MM string format
    const timeStr = String(time).trim();
    if (timeStr.includes(':')) {
      const parts = timeStr.split(':');
      if (parts.length >= 2) {
        const hh = parseInt(parts[0], 10) || 0;
        const mm = parseInt(parts[1], 10) || 0;
        return hh * 100 + mm;
      }
    }
    // Try to parse as plain number
    const num = parseInt(String(time).replace(/\D/g, ''), 10);
    return num >= 0 && num < 2400 ? num : null;
  },

  _compactHolidays(rawHolidays) {
    if (!Array.isArray(rawHolidays)) return [];
    return rawHolidays.map((h) => ({
      id: h.id ?? null,
      name: h.name ?? h.longName ?? '',
      longName: h.longName ?? h.name ?? '',
      startDate: h.startDate ?? null,
      endDate: h.endDate ?? null,
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
        if (w === 'messagesofday' && (p === 'messagesofday' || p === 'messages')) return true;
        return false;
      });
  },

  // ===== WARNING VALIDATION FUNCTIONS =====

  /**
   * Validate student credentials and configuration before attempting fetch
   */
  _validateStudentConfig(student) {
    const warnings = [];

    // Check for missing credentials
    const hasQr = Boolean(student.qrcode);
    const hasDirectCreds = Boolean(student.username && student.password && student.school);
    const hasStudentId = Number.isFinite(Number(student.studentId));

    if (!hasQr && !hasDirectCreds && !hasStudentId) {
      warnings.push(
        `Student "${student.title}": No credentials configured. Provide either qrcode OR (username + password + school) OR studentId (for parent account).`
      );
    }

    // Check for invalid QR code format
    if (hasQr && !student.qrcode.startsWith('untis://')) {
      warnings.push(
        `Student "${student.title}": QR code malformed. Expected format: untis://setschool?url=...&school=...&user=...&key=...`
      );
    }

    return warnings;
  },

  /**
   * Convert REST API errors to user-friendly warning messages
   */
  _convertRestErrorToWarning(error, context = {}) {
    const { studentTitle = 'Student', school = 'school', server = 'server' } = context;

    if (!error) return null;

    const msg = (error.message || '').toLowerCase();
    const status = error.response?.status;

    // Authentication errors
    if (status === 401 || status === 403 || msg.includes('401') || msg.includes('403')) {
      return `Authentication failed for "${studentTitle}": Invalid credentials or insufficient permissions.`;
    }

    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || msg.includes('timeout')) {
      return `Cannot connect to WebUntis server "${server}". Check server name and network connection.`;
    }

    // API unavailable
    if (status === 503 || msg.includes('503')) {
      return `WebUntis API temporarily unavailable (HTTP 503). Retrying on next fetch...`;
    }

    // School not found (typically 401 with specific error message)
    if (msg.includes('school') || msg.includes('not found')) {
      return `School "${school}" not found or invalid credentials. Check school name and spelling.`;
    }

    // Generic network error
    if (!error.response) {
      return `Network error connecting to WebUntis: ${error.message || 'Unknown error'}`;
    }

    // Generic HTTP error
    if (status && status >= 400 && status < 500) {
      return `HTTP ${status} error for "${studentTitle}": ${error.message || 'Client error'}`;
    }

    if (status && status >= 500) {
      return `Server error (HTTP ${status}): ${error.message || 'Server error'}`;
    }

    return null;
  },

  /**
   * Check if empty data array should trigger a warning
   */
  _checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData = true) {
    if (Array.isArray(dataArray) && dataArray.length === 0 && isExpectedData) {
      return `Student "${studentTitle}": No ${dataType} found in selected date range. Check if student is enrolled.`;
    }
    return null;
  },

  /**
   * Validate module configuration for common issues
   */
  _validateModuleConfig(config) {
    const warnings = [];

    // Validate displayMode
    const validWidgets = ['grid', 'lessons', 'exams', 'homework', 'absences', 'messagesofday'];
    if (config.displayMode && typeof config.displayMode === 'string') {
      const widgets = config.displayMode
        .split(',')
        .map((w) => w.trim())
        .filter(Boolean);
      const invalid = widgets.filter((w) => !validWidgets.includes(w.toLowerCase()));
      if (invalid.length > 0) {
        warnings.push(`displayMode contains unknown widgets: "${invalid.join(', ')}". Supported: ${validWidgets.join(', ')}`);
      }
    }

    // Validate logLevel
    const validLogLevels = ['none', 'error', 'warn', 'info', 'debug'];
    if (config.logLevel && !validLogLevels.includes(config.logLevel.toLowerCase())) {
      warnings.push(`Invalid logLevel "${config.logLevel}". Use: ${validLogLevels.join(', ')}`);
    }

    // Validate numeric ranges (prefer new keys `nextDays` / `pastDays`)
    if (Number.isFinite(config.nextDays) && config.nextDays < 0) {
      warnings.push(`nextDays cannot be negative. Value: ${config.nextDays}`);
    }
    if (Number.isFinite(config.pastDays) && config.pastDays < 0) {
      warnings.push(`pastDays cannot be negative. Value: ${config.pastDays}`);
    }
    if (Number.isFinite(config.daysToShow) && config.daysToShow < 0) {
      warnings.push(`daysToShow cannot be negative (deprecated). Value: ${config.daysToShow}`);
    }

    // Get exams.daysAhead (from new namespace or legacy)
    const examsDaysAhead = config.exams?.daysAhead ?? config.examsDaysAhead ?? 0;
    if (Number.isFinite(examsDaysAhead) && (examsDaysAhead < 0 || examsDaysAhead > 365)) {
      warnings.push(`exams.daysAhead should be between 0 and 365. Value: ${examsDaysAhead}`);
    }

    // Get grid.mergeGap (from new namespace or legacy)
    const gridMergeGap = config.grid?.mergeGap ?? config.mergeGapMinutes ?? 0;
    if (Number.isFinite(gridMergeGap) && gridMergeGap < 0) {
      warnings.push(`grid.mergeGap cannot be negative. Value: ${gridMergeGap}`);
    }

    return warnings;
  },

  // Backend performs API calls only; no data normalization here.

  /*
   * Small in-memory cache helpers keyed by a request signature (stringified





  /**
   * Process a credential group: login, fetch data for students and logout.
   * This function respects the inflightRequests Map's pending flag: if pending
   * becomes true while running, it will loop once more to handle the coalesced request.
   */
  async processGroup(credKey, students, identifier) {
    // Single-run processing: authenticate, fetch data for each student, and logout.
    let untis = null;
    const sample = students[0];
    const groupWarnings = [];
    // Per-fetch-cycle warning deduplication set. Ensures identical warnings
    // are reported only once per processing run (prevents spam across students).
    this._currentFetchWarnings = new Set();

    try {
      try {
        untis = this._createUntisClient(sample, this.config);
      } catch (err) {
        const msg = `No valid credentials for group ${credKey}: ${this._formatErr(err)}`;
        this._mmLog('error', null, msg);
        // Record and mark this warning for the current fetch cycle
        if (!this._currentFetchWarnings.has(msg)) {
          groupWarnings.push(msg);
          this._currentFetchWarnings.add(msg);
        }
        // Send error payload to frontend with warnings
        for (const student of students) {
          this.sendSocketNotification('GOT_DATA', {
            title: student.title,
            id: identifier,
            config: student,
            warnings: groupWarnings,
            timeUnits: [],
            timetableRange: [],
            exams: [],
            homeworks: [],
            absences: [],
          });
        }
        return;
      }

      await untis.login();
      for (const student of students) {
        try {
          // ===== VALIDATE STUDENT CONFIG =====
          const studentValidationWarnings = this._validateStudentConfig(student);
          if (studentValidationWarnings.length > 0) {
            studentValidationWarnings.forEach((w) => {
              this._mmLog('warn', student, w);
              if (!this._currentFetchWarnings.has(w)) {
                groupWarnings.push(w);
                this._currentFetchWarnings.add(w);
              }
            });
          }

          // Fetch fresh data for this student
          this._mmLog('debug', student, `Fetching data for ${student.title}...`);
          const payload = await this.fetchData(untis, student, identifier, credKey);
          if (!payload) {
            this._mmLog('warn', student, `fetchData returned empty payload for ${student.title}`);
          }
        } catch (err) {
          const errorMsg = `Error fetching data for ${student.title}: ${this._formatErr(err)}`;
          this._mmLog('error', student, errorMsg);

          // ===== CONVERT REST ERRORS TO USER-FRIENDLY WARNINGS =====
          const warningMsg = this._convertRestErrorToWarning(err, {
            studentTitle: student.title,
            school: student.school || this.config?.school,
            server: student.server || this.config?.server || 'webuntis.com',
          });
          if (warningMsg) {
            // Only record each distinct warning once per fetch cycle
            if (!this._currentFetchWarnings.has(warningMsg)) {
              groupWarnings.push(warningMsg);
              this._currentFetchWarnings.add(warningMsg);
            }
            this._mmLog('warn', student, warningMsg);
          }
        }
      }
    } catch (error) {
      this._mmLog('error', null, `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`);
      const authMsg = `Authentication failed for group: ${this._formatErr(error)}`;
      if (!this._currentFetchWarnings.has(authMsg)) {
        groupWarnings.push(authMsg);
        this._currentFetchWarnings.add(authMsg);
      }
    } finally {
      try {
        if (untis) await untis.logout();
      } catch (err) {
        this._mmLog('error', null, `Error during logout for group ${credKey}: ${this._formatErr(err)}`);
      }
      // Clear per-fetch warning dedupe set now that processing for this group finished
      try {
        this._currentFetchWarnings = undefined;
      } catch {
        this._currentFetchWarnings = undefined;
      }
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
    this._mmLog('debug', null, `[socketNotificationReceived] Notification: ${notification}`);

    if (notification === 'FETCH_DATA') {
      // Assign incoming payload to module config
      // Normalize legacy config keys server-side
      const { normalizedConfig } = applyLegacyMappings(payload);
      this.config = normalizedConfig;

      // Persist debugDate: save it if present in current config, otherwise use the persisted one
      if (this.config.debugDate) {
        this._persistedDebugDate = this.config.debugDate;
        this._mmLog('debug', null, `[FETCH_DATA] Received debugDate="${this.config.debugDate}"`);
      } else if (this._persistedDebugDate) {
        // No debugDate in current request, use the persisted one from previous request
        this.config.debugDate = this._persistedDebugDate;
        this._mmLog('debug', null, `[FETCH_DATA] Using persisted debugDate="${this._persistedDebugDate}"`);
      } else {
        this._mmLog('debug', null, `[FETCH_DATA] No debugDate configured`);
      }

      // Apply legacy config normalization to show warnings and formatted output
      this.config = this._normalizeLegacyConfig(this.config);

      // Validate configuration and return errors to frontend if invalid
      try {
        // First apply legacy mappings to convert old keys to new structure
        const { normalizedConfig, legacyUsed } = applyLegacyMappings(this.config);

        // Persist normalized config so the helper uses mapped keys everywhere
        this.config = normalizedConfig;

        // Log any legacy keys that were used
        if (legacyUsed && legacyUsed.length > 0) {
          this._mmLog(
            'warn',
            null,
            `Legacy config keys detected: ${legacyUsed.join(', ')}. These are still supported but will be auto-converted.`
          );
        }

        const validatorLogger = this.logger || { log: (level, msg) => this._mmLog(level, null, msg) };
        const { valid, errors, warnings } = validateConfig(normalizedConfig, validatorLogger);

        // Add legacy key usage to the warning list so users see a clear notice
        const legacyWarnings = (legacyUsed || []).map(
          (key) => `Deprecated configuration field detected: "${key}" has been mapped to the new schema.`
        );
        const combinedWarnings = [...(warnings || []), ...legacyWarnings];
        if (!valid) {
          this.sendSocketNotification('CONFIG_ERROR', {
            errors,
            warnings: combinedWarnings,
            severity: 'ERROR',
            message: 'Configuration validation failed',
          });
          return;
        }
        if (combinedWarnings.length > 0) {
          // Only send CONFIG_WARNING once per helper lifecycle to avoid repeated warnings
          if (!this._configWarningsSent) {
            this.sendSocketNotification('CONFIG_WARNING', {
              warnings: combinedWarnings,
              severity: 'WARN',
              message: 'Configuration has warnings (deprecated fields detected)',
            });
            this._configWarningsSent = true;
          } else {
            this._mmLog('debug', null, 'CONFIG_WARNING suppressed (already sent)');
          }
        }
      } catch (e) {
        this._mmLog('debug', null, `Config validation failed unexpectedly: ${this._formatErr(e)}`);
      }

      this._mmLog(
        'info',
        null,
        `Data request received (FETCH_DATA for students=${Array.isArray(this.config.students) ? this.config.students.length : 0})`
      );

      // Debug: show which interval keys frontend sent (updateInterval preferred)
      try {
        this._mmLog(
          'debug',
          null,
          `Received intervals: updateInterval=${this.config.updateInterval} fetchIntervalMs=${this.config.fetchIntervalMs}`
        );
      } catch {
        // ignore
      }

      try {
        // Auto-discover students from app/data when parent credentials are provided but students[] is missing
        await this._ensureStudentsFromAppData(this.config);

        // If after normalization there are still no students configured, attempt to build
        // the students array internally from app/data so the rest of the flow can proceed.
        if (!Array.isArray(this.config.students) || this.config.students.length === 0) {
          try {
            const server = this.config.server || 'webuntis.com';
            const creds = { username: this.config.username, password: this.config.password, school: this.config.school };
            if (creds.username && creds.password && creds.school) {
              const { appData } = await this._getRestAuthTokenAndCookies(creds.school, creds.username, creds.password, server);
              const autoStudents = this._deriveStudentsFromAppData(appData);
              if (autoStudents && autoStudents.length > 0) {
                if (!this.config._autoStudentsAssigned) {
                  const defNoStudents = { ...(this.config || {}) };
                  delete defNoStudents.students;
                  const normalized = autoStudents.map((s) =>
                    this._normalizeLegacyConfig({ ...defNoStudents, ...(s || {}) }, this.defaults)
                  );
                  this.config.students = normalized;
                  this.config._autoStudentsAssigned = true;
                  const studentList = normalized.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
                  this._mmLog('info', null, `Auto-built students array from app/data: ${normalized.length} students:\n  ${studentList}`);
                } else {
                  this._mmLog('debug', null, 'Auto-built students already assigned; skipping');
                }
              }
            }
          } catch (e) {
            this._mmLog('debug', null, `Auto-build students from app/data failed: ${this._formatErr(e)}`);
          }
        }

        // Group students by credential so we can reuse the same untis session
        const identifier = this.config.id;
        const groups = new Map();

        // Group students by credential. Normalize each student config for legacy key compatibility.
        const studentsList = Array.isArray(this.config.students) ? this.config.students : [];
        for (const student of studentsList) {
          // Apply legacy config mapping to student-level config
          const { normalizedConfig: normalizedStudent } = applyLegacyMappings(student);
          const credKey = this._getCredentialKey(normalizedStudent, this.config);
          if (!groups.has(credKey)) groups.set(credKey, []);
          groups.get(credKey).push(normalizedStudent);
        }

        // For each credential group process independently. Do not coalesce requests
        // across module instances so that per-instance options are always respected.
        for (const [credKey, students] of groups.entries()) {
          // Run sequentially to reduce peak memory usage on low-RAM devices
          await this.processGroup(credKey, students, identifier);
        }
        this._mmLog('debug', null, 'Successfully fetched data');
      } catch (error) {
        this._mmLog('error', null, `Error loading Untis data: ${error}`);
      }
    }
  },

  /**
   * Build a stable key that represents a login/session so results can be cached.
   * For parent accounts (studentId + module-level username), group by parent credentials.
   * For direct logins, group by student credentials.
   *
   * @param {Object} student - Student credential object
   * @returns {string} credential key
   */
  _getCredentialKey(student, moduleConfig) {
    const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
    const hasOwnCredentials = student.qrcode || (student.username && student.password && student.school && student.server);
    const isParentMode = hasStudentId && !hasOwnCredentials;

    // Parent account mode: group by module-level parent credentials
    if (isParentMode && moduleConfig) {
      return `parent:${moduleConfig.username || 'undefined'}@${moduleConfig.server || 'webuntis.com'}/${moduleConfig.school || 'undefined'}`;
    }

    // Direct student login: group by student credentials
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
    this._mmLog('debug', null, `Fetching timegrid`);
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
    this._mmLog('debug', null, `Fetching week timetable for ${credKey} starting ${rangeStart.toDateString()}`);
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

    // Detect login mode
    const useQrLogin = Boolean(student.qrcode);
    const restOptions = { cacheKey: credKey, untisClient: untis };
    const { school, server } = this._resolveSchoolAndServer(student);
    const ownPersonId = useQrLogin && untis?.sessionInformation ? untis.sessionInformation.personId : null;
    const restTargets = this._buildRestTargets(student, this.config, school, server, ownPersonId);
    const describeTarget = (t) =>
      t.mode === 'qr' ? `QR login${t.studentId ? ` (id=${t.studentId})` : ''}` : `parent (studentId=${t.studentId})`;
    const className = student.class || student.className || this.config?.class || null;

    const wantsGridWidget = this._wantsWidget('grid', this.config?.displayMode);
    const wantsLessonsWidget = this._wantsWidget('lessons', this.config?.displayMode);
    const wantsExamsWidget = this._wantsWidget('exams', this.config?.displayMode);
    const wantsHomeworkWidget = this._wantsWidget('homework', this.config?.displayMode);
    const wantsAbsencesWidget = this._wantsWidget('absences', this.config?.displayMode);
    const wantsMessagesOfDayWidget = this._wantsWidget('messagesofday', this.config?.displayMode);

    // Data fetching is driven by widgets.
    const fetchTimegrid = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchTimetable = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchExams = Boolean(wantsGridWidget || wantsExamsWidget);
    const fetchHomeworks = Boolean(wantsGridWidget || wantsHomeworkWidget);
    // NOTE: With REST API updates, absences are now available for parent accounts via /WebUntis/api/absences
    const fetchAbsences = Boolean(wantsAbsencesWidget);
    const fetchMessagesOfDay = Boolean(wantsMessagesOfDayWidget);
    const fetchHolidays = Boolean(wantsGridWidget || wantsLessonsWidget);

    // Respect optional debug date from module config to allow reproducible fetches.
    const baseNow = function () {
      try {
        const dbg = (typeof this.config?.debugDate === 'string' && this.config.debugDate) || null;
        if (dbg) {
          // accept YYYY-MM-DD or YYYYMMDD
          const s = String(dbg).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
          if (/^\d{8}$/.test(s)) return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00`);
        }
      } catch {
        // fall through to real now
      }
      return new Date(Date.now());
    }.call(this);

    let rangeStart = new Date(baseNow);
    let rangeEnd = new Date(baseNow);
    const todayYmd = baseNow.getFullYear() * 10000 + (baseNow.getMonth() + 1) * 100 + baseNow.getDate();

    // Use per-student `pastDays` / `nextDays` (preferred). Fall back to legacy keys.
    const pastDaysValue = Number(student.pastDays ?? student.pastDaysToShow ?? this.config?.pastDays ?? this.config?.pastDaysToShow ?? 0);
    // Prefer explicit `nextDays` (student), then module-level `nextDays`,
    // then fall back to legacy `daysToShow` values.
    const nextDaysValue = Number(student.nextDays ?? this.config?.nextDays ?? student.daysToShow ?? this.config?.daysToShow ?? 2);

    // For timetable/grid, also check grid-specific nextDays/pastDays
    // If grid.nextDays is set, use max(global nextDays, grid.nextDays) to ensure we fetch enough data
    let gridNextDays = nextDaysValue;
    let gridPastDays = pastDaysValue;
    if (wantsGridWidget) {
      const gridNext = Number(student.grid?.nextDays ?? this.config?.grid?.nextDays ?? 0);
      const gridPast = Number(student.grid?.pastDays ?? this.config?.grid?.pastDays ?? 0);
      gridNextDays = Math.max(nextDaysValue, gridNext > 0 ? gridNext : 0);
      gridPastDays = Math.max(pastDaysValue, gridPast > 0 ? gridPast : 0);
    }

    rangeStart.setDate(rangeStart.getDate() - gridPastDays);
    rangeEnd.setDate(rangeEnd.getDate() - gridPastDays + parseInt(gridNextDays, 10));
    logger(
      `Computed timetable range params: base=${baseNow.toISOString().split('T')[0]}, pastDays=${gridPastDays}, nextDays=${gridNextDays}`
    );
    logger(
      `Config values: module.nextDays=${this.config?.nextDays}, module.grid.nextDays=${this.config?.grid?.nextDays}, student.grid.nextDays=${student.grid?.nextDays}`
    );
    // Compute absences-specific start and end dates (allow per-student override or global config)
    const absPast = Number.isFinite(Number(student.absences?.pastDays ?? student.absencesPastDays))
      ? Number(student.absences?.pastDays ?? student.absencesPastDays)
      : Number.isFinite(Number(this.config?.absences?.pastDays ?? this.config?.absencesPastDays))
        ? Number(this.config?.absences?.pastDays ?? this.config?.absencesPastDays)
        : 0;
    const absFuture = Number.isFinite(Number(student.absences?.futureDays ?? student.absencesFutureDays))
      ? Number(student.absences?.futureDays ?? student.absencesFutureDays)
      : Number.isFinite(Number(this.config?.absences?.futureDays ?? this.config?.absencesFutureDays))
        ? Number(this.config?.absences?.futureDays ?? this.config?.absencesFutureDays)
        : 0;

    const absencesRangeStart = new Date(baseNow);
    absencesRangeStart.setDate(absencesRangeStart.getDate() - absPast);
    const absencesRangeEnd = new Date(baseNow);
    absencesRangeEnd.setDate(absencesRangeEnd.getDate() + absFuture);

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

    if (fetchTimetable && (student.daysToShow ?? student.nextDays ?? this.config?.daysToShow ?? this.config?.nextDays) > 0) {
      try {
        for (const target of restTargets) {
          logger(`Timetable: fetching via REST (${describeTarget(target)})...`);
          try {
            timetable = await this._callRest(
              this._getTimetableViaRest,
              target,
              rangeStart,
              rangeEnd,
              target.studentId,
              {
                ...restOptions,
                useClassTimetable: Boolean(student.useClassTimetable),
                className,
                classId: student.classId || null,
                studentId: target.studentId,
              },
              Boolean(student.useClassTimetable),
              className
            );
            logger(`✓ Timetable: ${timetable.length} lessons\n`);
            break;
          } catch (restError) {
            logger(`✗ Timetable failed (${describeTarget(target)}): ${restError.message}\n`);
          }
        }
      } catch (error) {
        this._mmLog('error', student, `Timetable failed: ${error && error.message ? error.message : error}`);
      }
    } else if (fetchTimetable) {
      logger(`Timetable: skipped (daysToShow=${student.daysToShow})`);
    }

    // Exams (raw)
    let rawExams = [];
    const examsDaysAheadValue =
      student.exams?.daysAhead ?? student.examsDaysAhead ?? this.config?.exams?.daysAhead ?? this.config?.examsDaysAhead ?? 0;
    if (fetchExams && examsDaysAheadValue > 0) {
      // Validate the number of days
      let validatedDays = examsDaysAheadValue;
      if (validatedDays < 1 || validatedDays > 360 || isNaN(validatedDays)) {
        validatedDays = 30;
      }

      rangeStart = new Date(baseNow);
      rangeStart.setDate(rangeStart.getDate() - (student.pastDaysToShow ?? student.pastDays ?? this.config?.pastDays ?? 0));
      rangeEnd = new Date(baseNow);
      rangeEnd.setDate(rangeEnd.getDate() + validatedDays);

      logger(`Exams: querying ${validatedDays} days ahead...`);

      try {
        for (const target of restTargets) {
          logger(`Exams: fetching via REST (${describeTarget(target)})...`);
          try {
            rawExams = await this._callRest(this._getExamsViaRest, target, rangeStart, rangeEnd, target.studentId, restOptions);
            logger(`✓ Exams: ${rawExams.length} found\n`);
            break;
          } catch (restError) {
            logger(`✗ Exams failed (${describeTarget(target)}): ${restError.message}`);
          }
        }
        this._lastRawExams = rawExams;
      } catch (error) {
        this._mmLog('error', student, `Exams failed: ${error && error.message ? error.message : error}\n`);
      }
    } else {
      logger(`Exams: skipped (exams.daysAhead=${examsDaysAheadValue})`);
    }

    // Load homework for the period – keep raw
    let hwResult = null;
    if (fetchHomeworks) {
      logger(`Homework: fetching...`);
      try {
        // Calculate the maximum time range needed across ALL widgets to fetch comprehensive homework data.
        // Then filter by dueDate during display based on homework.nextDays / homework.pastDays.

        // Collect all the relevant day ranges from active widgets
        const allRanges = [];

        // Timetable/Grid range
        allRanges.push({ pastDays: gridPastDays, futureDays: gridNextDays });

        // Exams range
        if (fetchExams && examsDaysAheadValue > 0) {
          const examsPastDays = student.pastDaysToShow ?? student.pastDays ?? this.config?.pastDays ?? 0;
          allRanges.push({ pastDays: examsPastDays, futureDays: examsDaysAheadValue });
        }

        // Absences range
        if (fetchAbsences && (absPast > 0 || absFuture > 0)) {
          allRanges.push({ pastDays: absPast, futureDays: absFuture });
        }

        // Find the maximum range
        let maxPastDays = 0;
        let maxFutureDays = 0;
        allRanges.forEach((range) => {
          maxPastDays = Math.max(maxPastDays, range.pastDays || 0);
          maxFutureDays = Math.max(maxFutureDays, range.futureDays || 0);
        });

        // Apply at least some defaults if no other widgets are fetching
        if (maxFutureDays === 0) {
          maxFutureDays = 28; // Default homework lookahead
        }

        const hwRangeStart = new Date(baseNow);
        const hwRangeEnd = new Date(baseNow);
        hwRangeStart.setDate(hwRangeStart.getDate() - maxPastDays);
        hwRangeEnd.setDate(hwRangeEnd.getDate() + maxFutureDays);

        logger(`Homework: fetching with max widget range (past: ${maxPastDays}, future: ${maxFutureDays})`);
        logger(`Homework REST API range: ${hwRangeStart.toISOString().split('T')[0]} to ${hwRangeEnd.toISOString().split('T')[0]}`);

        for (const target of restTargets) {
          logger(`Homework: fetching via REST (${describeTarget(target)})...`);
          try {
            const homeworks = await this._callRest(
              this._getHomeworkViaRest,
              target,
              hwRangeStart,
              hwRangeEnd,
              target.studentId,
              restOptions
            );
            hwResult = homeworks;
            logger(`✓ Homework: ${homeworks.length} items\n`);
            break;
          } catch (restError) {
            logger(`✗ Homework failed (${describeTarget(target)}): ${restError.message}\n`);
          }
        }
        // Send  raw homework payload to the frontend without normalization
      } catch (error) {
        this._mmLog('error', student, `Homework failed: ${error && error.message ? error.message : error}`);
      }

      // Filter homework by dueDate based on homework widget config (pastDays / nextDays)
      if (hwResult && Array.isArray(hwResult) && hwResult.length > 0) {
        const hwNextDays = Number(
          student.homework?.nextDays ??
            student.homework?.daysAhead ??
            this.config?.homework?.nextDays ??
            this.config?.homework?.daysAhead ??
            999 // Default: show all if not configured
        );
        const hwPastDays = Number(student.homework?.pastDays ?? this.config?.homework?.pastDays ?? 999);

        // Only filter if explicitly configured
        if (hwNextDays < 999 || hwPastDays < 999) {
          const filterStart = new Date(baseNow);
          const filterEnd = new Date(baseNow);
          filterStart.setDate(filterStart.getDate() - hwPastDays);
          filterEnd.setDate(filterEnd.getDate() + hwNextDays);

          // Filter by dueDate
          hwResult = hwResult.filter((hw) => {
            if (!hw.dueDate) return true; // Keep homeworks without dueDate
            const dueDateNum = Number(hw.dueDate);
            const dueDateStr = String(dueDateNum).padStart(8, '0');
            const dueYear = parseInt(dueDateStr.substring(0, 4), 10);
            const dueMonth = parseInt(dueDateStr.substring(4, 6), 10);
            const dueDay = parseInt(dueDateStr.substring(6, 8), 10);
            const dueDate = new Date(dueYear, dueMonth - 1, dueDay);
            return dueDate >= filterStart && dueDate <= filterEnd;
          });

          logger(
            `Homework: filtered to ${hwResult.length} items by dueDate range ` +
              `${filterStart.toISOString().split('T')[0]} to ${filterEnd.toISOString().split('T')[0]}`
          );
        }
      }
    } else {
      logger(`Homework: skipped`);
    }

    // Absences (raw)
    let rawAbsences = [];
    if (fetchAbsences) {
      logger(`Absences: fetching...`);
      try {
        for (const target of restTargets) {
          logger(`Absences: fetching via REST (${describeTarget(target)})...`);
          try {
            rawAbsences = await this._callRest(
              this._getAbsencesViaRest,
              target,
              absencesRangeStart,
              absencesRangeEnd,
              target.studentId,
              restOptions
            );
            logger(`✓ Absences: ${rawAbsences.length} records\n`);
            break;
          } catch (restError) {
            logger(`✗ Absences failed (${describeTarget(target)}): ${restError.message}\n`);
          }
        }
      } catch (error) {
        this._mmLog('error', student, `Absences failed: ${error && error.message ? error.message : error}`);
      }
    } else {
      logger(`Absences: skipped`);
    }

    // MessagesOfDay (raw)
    let rawMessagesOfDay = [];
    if (fetchMessagesOfDay) {
      logger(`MessagesOfDay: fetching...`);
      try {
        for (const target of restTargets) {
          logger(`MessagesOfDay: fetching via REST (${describeTarget(target)})...`);
          try {
            rawMessagesOfDay = await this._callRest(this._getMessagesOfDayViaRest, target, new Date(), restOptions);
            logger(`✓ MessagesOfDay: ${rawMessagesOfDay.length} found\n`);
            break;
          } catch (restError) {
            logger(`✗ MessagesOfDay failed (${describeTarget(target)}): ${restError.message}\n`);
          }
        }
      } catch (error) {
        this._mmLog('error', student, `MessagesOfDay failed: ${error && error.message ? error.message : error}`);
      }
    } else {
      logger(`MessagesOfDay: skipped`);
    }

    // Holidays (raw)
    let rawHolidays = [];
    if (fetchHolidays) {
      logger(`Holidays: fetching...`);
      try {
        rawHolidays = await untis.getHolidays();
        if (Array.isArray(rawHolidays)) {
          logger(`✓ Holidays: ${rawHolidays.length} periods\n`);
        } else {
          logger(`Holidays: none\n`);
          rawHolidays = [];
        }
      } catch (error) {
        this._mmLog('error', student, `Holidays failed: ${error && error.message ? error.message : error}\n`);
      }
    } else {
      logger(`Holidays: skipped`);
    }

    logger(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    // Compact payload to reduce memory before caching and sending to the frontend.
    const compactGrid = this._compactTimegrid(grid);
    const compactTimetable = compactArray(timetable, schemas.lesson);
    const compactExams = compactArray(rawExams, schemas.exam);
    const compactHomeworks = fetchHomeworks ? compactArray(hwResult, schemas.homework) : [];
    const compactAbsences = fetchAbsences ? compactArray(rawAbsences, schemas.absence) : [];
    const compactMessagesOfDay = fetchMessagesOfDay ? compactArray(rawMessagesOfDay, schemas.message) : [];
    const compactHolidays = fetchHolidays ? this._compactHolidays(rawHolidays) : [];

    const toYmd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rangeStartYmd = toYmd(rangeStart);
    const rangeEndYmd = toYmd(rangeEnd);
    const holidayByDate = (() => {
      if (!Array.isArray(compactHolidays) || compactHolidays.length === 0) return {};
      const map = {};
      for (let ymd = rangeStartYmd; ymd <= rangeEndYmd; ) {
        const holiday = compactHolidays.find((h) => Number(h.startDate) <= ymd && ymd <= Number(h.endDate));
        if (holiday) map[ymd] = holiday;
        // increment date
        const year = Math.floor(ymd / 10000);
        const month = Math.floor((ymd % 10000) / 100) - 1;
        const day = ymd % 100;
        const tmp = new Date(year, month, day);
        tmp.setDate(tmp.getDate() + 1);
        ymd = tmp.getFullYear() * 10000 + (tmp.getMonth() + 1) * 100 + tmp.getDate();
      }
      return map;
    })();

    const findHolidayForDate = (ymd, holidays) => {
      if (!Array.isArray(holidays) || holidays.length === 0) return null;
      const dateNum = Number(ymd);
      return holidays.find((h) => Number(h.startDate) <= dateNum && dateNum <= Number(h.endDate)) || null;
    };
    const activeHoliday = findHolidayForDate(todayYmd, compactHolidays);

    // Build payload and send it. Also return the payload for caching callers.
    const payload = {
      title: student.title,
      config: student,
      // id will be assigned by the caller to preserve per-request id
      timeUnits: compactGrid,
      timetableRange: compactTimetable,
      exams: compactExams,
      homeworks: compactHomeworks,
      absences: compactAbsences,
      messagesOfDay: compactMessagesOfDay,
      holidays: compactHolidays,
      holidayByDate,
      currentHoliday: activeHoliday,
      // Absences are now available via REST API even for parent accounts
      absencesUnavailable: false,
    };
    try {
      // Collect any warnings attached to the student and expose them at the
      // top-level payload so the frontend can display module-level warnings
      // independent of per-student sections. Dedupe messages so each is shown once.
      let warnings = [];

      // Include module-level and per-student warnings, but ensure each
      // distinct warning is emitted only once per fetch cycle to avoid spam.
      const addWarning = (msg) => {
        if (!msg) return;
        if (!this._currentFetchWarnings) this._currentFetchWarnings = new Set();
        if (!this._currentFetchWarnings.has(msg)) {
          warnings.push(msg);
          this._currentFetchWarnings.add(msg);
        }
      };

      // Include module-level warnings (e.g., legacy config warnings)
      if (this.config && Array.isArray(this.config.__warnings)) {
        this.config.__warnings.forEach(addWarning);
      }

      // Include per-student warnings
      if (payload && payload.config && Array.isArray(payload.config.__warnings)) {
        payload.config.__warnings.forEach(addWarning);
      }

      // ===== ADD EMPTY DATA WARNINGS =====
      // Suppress the empty-lessons warning during holidays to avoid noise when no lessons are expected
      if (!activeHoliday && timetable.length === 0 && fetchTimetable && student.daysToShow > 0) {
        const emptyWarn = this._checkEmptyDataWarning(timetable, 'lessons', student.title, true);
        addWarning(emptyWarn);
      }
      if (activeHoliday) {
        this._mmLog(
          'debug',
          student,
          `Skipping empty lessons warning: holiday "${activeHoliday.longName || activeHoliday.name}" (today=${todayYmd})`
        );
      }

      const uniqWarnings = Array.from(new Set(warnings));
      const forSend = { ...payload, id: identifier, warnings: uniqWarnings };

      // Optional: write debug dumps of the payload delivered to the frontend.
      // Enable by setting `dumpBackendPayloads: true` in the module config.
      try {
        if (this.config && this.config.dumpBackendPayloads) {
          const dumpDir = path.join(__dirname, 'debug_dumps');
          if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
          const safeTitle = (student && student.title ? student.title : 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
          const fname = `${Date.now()}_${safeTitle}_${String(forSend.apiUsed || 'api')}.json`;
          const target = path.join(dumpDir, fname);
          fs.writeFileSync(target, JSON.stringify(forSend, null, 2), 'utf8');
          this._mmLog('debug', student, `Wrote debug payload to ${path.join('debug_dumps', fname)}`, 'debug');
        }
      } catch (err) {
        this._mmLog('error', student, `Failed to write debug payload: ${err && err.message ? err.message : err}`, 'debug');
      }

      this._mmLog(
        'debug',
        student,
        `✓ Data ready: timetable=${compactTimetable.length} exams=${compactExams.length} hw=${compactHomeworks.length} abs=${compactAbsences.length}\n`
      );
      this.sendSocketNotification('GOT_DATA', forSend);
    } catch (err) {
      this._mmLog('error', student, `Failed to send GOT_DATA to ${identifier}: ${this._formatErr(err)}`);
    }
    return payload;
  },
});
