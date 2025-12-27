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

// Default cache TTL for per-request responses (ms). Small to favor freshness.
const DEFAULT_CACHE_TTL_MS = 30 * 1;
// Default interval for periodic cache cleanup (ms)
const DEFAULT_CACHE_CLEANUP_INTERVAL_MS = 30 * 1;

// Always fetch current data from WebUntis to ensure the frontend shows up-to-date information.
// Create a NodeHelper module
module.exports = NodeHelper.create({
  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start() {
    this._mmLog('debug', null, 'Node helper started');
    // initialize a tiny in-memory response cache
    this._responseCache = new Map(); // signature -> { ts, payload }
    this._cacheTTLMs = DEFAULT_CACHE_TTL_MS;
    // cache cleanup timer id
    this._cacheCleanupTimer = null;
    this._cacheCleanupIntervalMs = DEFAULT_CACHE_CLEANUP_INTERVAL_MS;
    // start periodic cache cleanup
    this._startCacheCleanup();
    // Initialize REST API cache (token + cookies) keyed by credential
    this._restAuthCache = new Map(); // cacheKey -> { token, cookieString, expiresAt }
    // Cache resolved class ids per credential/class name to avoid repeated filter calls
    this._classIdCache = new Map(); // cacheKey -> classId
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
    mapLegacy(out, 'days', 'daysToShow', (v) => Number(v), 'config');
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
        const msg = `Deprecated config keys detected and mapped: ${uniq.join(', ')}. Please update your config to use the new keys.`;
        if (typeof Log !== 'undefined' && Log && typeof Log.warn === 'function') {
          Log.warn('[MMM-Webuntis] ' + msg);
        } else {
          console.warn('[MMM-Webuntis] ' + msg);
        }
      } catch {
        // ignore
      }
    }

    this._mmLog('debug', null, 'Normalized legacy config keys (node helper)');
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

    if (level === 'debug') {
      if (this.config && this.config.logLevel === 'debug') {
        Log.debug(formatted);
      }
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
    this._mmLog('debug', null, `Obtaining REST auth token and cookies for user=${username || 'session'}`);
    const restCache = this._restAuthCache instanceof Map ? this._restAuthCache : new Map();
    this._restAuthCache = restCache;

    const { cacheKey, untisClient } = options || {};
    const effectiveCacheKey = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;

    const cached = restCache.get(effectiveCacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      this._mmLog('debug', null, `[REST] Using cached auth`);
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
   * Get timetable via REST API
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
    const startDate = rangeStart.toISOString().split('T')[0];
    const endDate = rangeEnd.toISOString().split('T')[0];
    const wantsClass = Boolean(useClassTimetable || options.useClassTimetable);
    this._mmLog('debug', null, `Fetching ${wantsClass ? 'class' : 'student'} timetable via REST API (${startDate} to ${endDate})`);
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

      // Format dates as YYYY-MM-DD for API
      const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };

      const headers = {
        Cookie: cookieString,
        Accept: 'application/json',
      };
      // Add tenant/schoolyear headers if available (needed for some schools)
      if (tenantId) headers['Tenant-Id'] = String(tenantId);
      if (schoolYearId) headers['X-Webuntis-Api-School-Year-Id'] = String(schoolYearId);
      if (token) headers.Authorization = `Bearer ${token}`;

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

      const resp = await axios.get(`https://${server}/WebUntis/api/rest/view/v1/timetable/entries`, {
        params: {
          start: formatDate(rangeStart),
          end: formatDate(rangeEnd),
          resourceType,
          resources: String(resourceId), // IMPORTANT: Must be string, not number!
          timetableType: 'STANDARD',
        },
        headers,
        validateStatus: () => true,
        timeout: 15000,
      });

      this._mmLog('debug', null, `REST API response status: ${resp.status}`);
      if (resp.status !== 200) {
        this._mmLog('debug', null, `REST API response body: ${JSON.stringify(resp.data).substring(0, 500)}`);
        // ===== ENHANCE ERROR MESSAGES =====
        if (resp.status === 401 || resp.status === 403) {
          throw new Error(`Authentication failed (HTTP ${resp.status}): Check credentials`);
        } else if (resp.status === 404) {
          throw new Error(`Resource not found (HTTP 404): Check school name or studentId`);
        } else if (resp.status === 503) {
          throw new Error(`WebUntis API unavailable (HTTP 503): Server temporarily down`);
        }
        throw new Error(`REST API returned HTTP ${resp.status}`);
      }

      // Transform REST response to JSON-RPC format
      const lessons = [];
      this._mmLog(
        'debug',
        null,
        `Response data structure: days=${resp.data?.days ? 'present' : 'missing'}, hasDays=${Array.isArray(resp.data?.days)}`
      );
      if (resp.data && resp.data.days && Array.isArray(resp.data.days)) {
        this._mmLog('debug', null, `Processing ${resp.data.days.length} days from API response`);
        resp.data.days.forEach((day) => {
          if (day.gridEntries && Array.isArray(day.gridEntries)) {
            day.gridEntries.forEach((entry) => {
              const lesson = {
                id: entry.ids && entry.ids[0] ? entry.ids[0] : null,
                date: day.date.split('T')[0], // Extract date part only
                startTime: entry.duration?.start ? entry.duration.start.split('T')[1] : '', // Extract time
                endTime: entry.duration?.end ? entry.duration.end.split('T')[1] : '', // Extract time
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
                // Status information: cancelled, regular, substitution
                status: entry.status || 'REGULAR', // REGULAR, CANCELLED, SUBSTITUTION, etc.
                statusDetail: entry.statusDetail || null, // Additional detail (e.g., reason)
              };
              lessons.push(lesson);
            });
          }
        });
      }

      this._mmLog('debug', null, `REST API returned ${lessons.length} lessons`);
      return lessons;
    } catch (error) {
      // ===== ENHANCED ERROR HANDLING =====
      if (error.code === 'ECONNREFUSED') {
        const msg = `Cannot connect to WebUntis server "${server}". Check server name and network connection.`;
        this._mmLog('error', null, msg);
        const err = new Error(msg);
        err.response = { status: 'ECONNREFUSED' };
        throw err;
      }
      if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
        const msg = `Connection timeout to WebUntis server "${server}". Check network or try again.`;
        this._mmLog('error', null, msg);
        const err = new Error(msg);
        err.response = { status: 'TIMEOUT' };
        throw err;
      }
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

      // Build request for exams
      // Endpoint: /WebUntis/api/exams (from WebUI, uses startDate/endDate in YYYYMMDD format)
      const headers = {
        Cookie: cookieString,
        Accept: 'application/json',
      };
      if (tenantId) headers['Tenant-Id'] = String(tenantId);
      if (schoolYearId) headers['X-Webuntis-Api-School-Year-Id'] = String(schoolYearId);
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await axios.get(`https://${server}/WebUntis/api/exams`, {
        params: {
          startDate: formatDateYYYYMMDD(rangeStart),
          endDate: formatDateYYYYMMDD(rangeEnd),
          studentId: studentId ?? -1,
          klasseId: -1,
          withGrades: true,
        },
        headers,
        validateStatus: () => true,
        timeout: 15000,
      });

      if (resp.status !== 200) {
        throw new Error(`REST API returned status ${resp.status} for exams`);
      }

      // Transform REST response to expected format
      const exams = [];
      let examArr = [];
      if (Array.isArray(resp.data?.data?.exams)) {
        examArr = resp.data.data.exams;
      } else if (Array.isArray(resp.data?.exams)) {
        examArr = resp.data.exams;
      } else if (Array.isArray(resp.data)) {
        examArr = resp.data;
      }

      examArr.forEach((exam) => {
        // Filter to only include exams assigned to the requested studentId
        const isAssignedToStudent =
          studentId && Array.isArray(exam.assignedStudents) && exam.assignedStudents.some((s) => s.id === studentId);

        // Include exam if we're not filtering by studentId OR if student is assigned
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
   */
  async _getHomeworkViaRest(school, username, password, server, rangeStart, rangeEnd, options = {}) {
    const startDate = rangeStart.toISOString().split('T')[0];
    const endDate = rangeEnd.toISOString().split('T')[0];
    this._mmLog('debug', null, `Fetching homework via REST API (${startDate} to ${endDate})`);
    try {
      const { token, cookieString } = await this._getRestAuthTokenAndCookies(school, username, password, server, options);

      const formatDateYYYYMMDD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      // Build request for homework via lessons endpoint
      // Endpoint: /WebUntis/api/homeworks/lessons
      // Returns: { data: { homeworks: [...], lessons: [...], records: [...], teachers: [...] } }
      const headers = {
        Cookie: cookieString,
        Accept: 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await axios.get(`https://${server}/WebUntis/api/homeworks/lessons`, {
        params: {
          startDate: formatDateYYYYMMDD(rangeStart),
          endDate: formatDateYYYYMMDD(rangeEnd),
        },
        headers,
        validateStatus: () => true,
        timeout: 15000,
      });

      if (resp.status !== 200) {
        throw new Error(`REST API returned status ${resp.status} for homework`);
      }

      // Extract homework from response
      // Response structure: { data: { homeworks: [...], lessons: [...] } }
      const homeworks = [];
      const seenIds = new Set(); // Avoid duplicates

      const data = resp.data.data || resp.data;

      if (Array.isArray(data.homeworks)) {
        const lessonsMap = {};
        if (Array.isArray(data.lessons)) {
          data.lessons.forEach((lesson) => {
            if (lesson.id) {
              lessonsMap[lesson.id] = lesson;
            }
          });
        }

        data.homeworks.forEach((hw) => {
          // Avoid duplicates by checking homework ID
          const hwId = hw.id ?? `${hw.lessonId}_${hw.dueDate}`;
          if (!seenIds.has(hwId)) {
            seenIds.add(hwId);
            const lesson = lessonsMap[hw.lessonId];

            // Extract subject name from lesson object
            let suName = null;
            if (lesson) {
              if (lesson.su && lesson.su[0]) {
                suName = { name: lesson.su[0].name, longname: lesson.su[0].longname };
              } else if (lesson.subject) {
                suName = { name: lesson.subject };
              }
            }

            homeworks.push({
              id: hw.id ?? null,
              lid: hw.lid ?? hw.lessonId ?? null,
              lessonId: hw.lessonId ?? null,
              dueDate: this._normalizeDateToInteger(hw.dueDate ?? hw.date),
              completed: hw.completed ?? hw.isCompleted ?? false,
              text: this._sanitizeHtmlText(hw.text ?? hw.description ?? hw.remark ?? '', true),
              remark: this._sanitizeHtmlText(hw.remark ?? '', false),
              su: suName,
            });
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

  /**
   * Fetch absences via REST API for a student (parent account or own)
   * Returns absences in the format: [{ date, startTime, endTime, reason, excused, student, su, te, lessonId }, ...]
   * Note: The REST API /WebUntis/api/absences returns all absences for the authenticated user
   */
  async _getAbsencesViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const startDate = rangeStart.toISOString().split('T')[0];
    const endDate = rangeEnd.toISOString().split('T')[0];
    this._mmLog('debug', null, `Fetching absences via REST API (${startDate} to ${endDate})`);
    try {
      const { token, cookieString } = await this._getRestAuthTokenAndCookies(school, username, password, server, options);

      const formatDateYYYYMMDD = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}${month}${day}`;
      };

      // Build request for absences
      // Endpoint: /WebUntis/api/classreg/absences/students (from WebUI)
      // Parameters: startDate, endDate (YYYYMMDD format), studentId, excuseStatusId
      const headers = {
        Cookie: cookieString,
        Accept: 'application/json',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await axios.get(`https://${server}/WebUntis/api/classreg/absences/students`, {
        params: {
          startDate: formatDateYYYYMMDD(rangeStart),
          endDate: formatDateYYYYMMDD(rangeEnd),
          studentId: studentId ?? -1,
          excuseStatusId: -1,
        },
        headers,
        validateStatus: () => true,
        timeout: 15000,
      });

      if (resp.status !== 200) {
        let bodyStr = '';
        try {
          bodyStr = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
        } catch {
          bodyStr = String(resp.data);
        }
        this._mmLog('error', null, `getAbsencesViaRest: REST ${resp.status} response body: ${bodyStr}`);
        throw new Error(`REST API returned status ${resp.status} for absences: ${bodyStr}`);
      }

      // Transform REST response to expected format
      const absences = [];
      let absArr = [];
      if (Array.isArray(resp.data?.data?.absences)) {
        absArr = resp.data.data.absences;
      } else if (Array.isArray(resp.data?.absences)) {
        absArr = resp.data.absences;
      } else if (Array.isArray(resp.data?.absentLessons)) {
        absArr = resp.data.absentLessons;
      } else if (Array.isArray(resp.data)) {
        absArr = resp.data;
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
      const defNoStudents = { ...(moduleConfig || {}) };
      delete defNoStudents.students;
      const normalizedAutoStudents = autoStudents.map((s) => {
        const merged = { ...defNoStudents, ...(s || {}) };
        return this._normalizeLegacyConfig(merged, this.defaults);
      });

      moduleConfig.students = normalizedAutoStudents;

      // Log all discovered students with their IDs in a prominent way
      const studentList = normalizedAutoStudents.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
      this._mmLog('info', null, `✓ Auto-discovered ${normalizedAutoStudents.length} student(s):\n  ${studentList}`);
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

  _compactLessons(rawLessons) {
    if (!Array.isArray(rawLessons)) return [];
    return rawLessons.map((el) => ({
      date: this._normalizeDateToInteger(el.date),
      startTime: this._normalizeTimeToMinutes(el.startTime),
      endTime: this._normalizeTimeToMinutes(el.endTime),
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
      examDate: this._normalizeDateToInteger(ex.examDate),
      startTime: this._normalizeTimeToMinutes(ex.startTime),
      endTime: this._normalizeTimeToMinutes(ex.endTime),
      name: this._sanitizeHtmlText(ex.name ?? '', false),
      subject: this._sanitizeHtmlText(ex.subject ?? '', false),
      teachers: Array.isArray(ex.teachers) ? ex.teachers.slice(0, 2) : [],
      text: this._sanitizeHtmlText(ex.text ?? '', true),
    }));
  },

  _compactHomeworks(rawHw, studentId = null) {
    if (!rawHw) return [];
    const hwArr = Array.isArray(rawHw)
      ? rawHw
      : Array.isArray(rawHw.homeworks)
        ? rawHw.homeworks
        : Array.isArray(rawHw.homework)
          ? rawHw.homework
          : [];

    // Build a map from homeworkId to elementIds (studentIds) using the records
    const homeworkToStudents = {};
    if (rawHw && Array.isArray(rawHw.records)) {
      for (const record of rawHw.records) {
        if (record.homeworkId && Array.isArray(record.elementIds)) {
          homeworkToStudents[record.homeworkId] = record.elementIds;
        }
      }
    }

    // If we have student filtering info, filter the homework list
    let filteredHw = hwArr;
    if (studentId !== null && Object.keys(homeworkToStudents).length > 0) {
      filteredHw = hwArr.filter((hw) => {
        const elementIds = homeworkToStudents[hw.id];
        // Include homework if: no mapping found (all get it) OR studentId is in elementIds
        return !elementIds || elementIds.includes(studentId);
      });
    }

    return filteredHw.map((hw) => ({
      id: hw.id ?? null,
      lid: hw.lid ?? null,
      lessonId: hw.lessonId ?? null,
      dueDate: hw.dueDate ?? hw.date ?? null,
      completed: hw.completed ?? null,
      text: this._sanitizeHtmlText(hw.text ?? hw.description ?? hw.remark ?? '', true),
      remark: this._sanitizeHtmlText(hw.remark ?? '', false),
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
      // Accept several common date field names returned by different
      // webuntis versions/providers (startDate, date, absenceDate, day)
      date: this._normalizeDateToInteger(a.date ?? a.startDate ?? a.absenceDate ?? a.day),
      startTime: this._normalizeTimeToMinutes(a.startTime ?? a.start),
      endTime: this._normalizeTimeToMinutes(a.endTime ?? a.end),
      reason: this._sanitizeHtmlText(a.reason ?? a.reasonText ?? a.text ?? '', false),
      excused: a.isExcused ?? a.excused ?? null,
      student: a.student ?? null,
      su: a.su && a.su[0] ? [{ name: a.su[0].name, longname: a.su[0].longname }] : [],
      te: a.te && a.te[0] ? [{ name: a.te[0].name, longname: a.te[0].longname }] : [],
      lessonId: a.lessonId ?? a.lid ?? a.id ?? null,
    }));
  },

  _compactMessagesOfDay(rawMessages) {
    if (!Array.isArray(rawMessages)) return [];
    return rawMessages.map((m) => ({
      id: m.id ?? null,
      subject: this._sanitizeHtmlText(m.subject ?? m.title ?? '', true),
      text: this._sanitizeHtmlText(m.text ?? m.content ?? '', true),
      isExpanded: m.isExpanded ?? false,
    }));
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

    // Validate numeric ranges
    if (Number.isFinite(config.daysToShow) && config.daysToShow < 0) {
      warnings.push(`daysToShow cannot be negative. Value: ${config.daysToShow}`);
    }

    if (Number.isFinite(config.examsDaysAhead) && (config.examsDaysAhead < 0 || config.examsDaysAhead > 365)) {
      warnings.push(`examsDaysAhead should be between 0 and 365. Value: ${config.examsDaysAhead}`);
    }

    if (Number.isFinite(config.mergeGapMinutes) && config.mergeGapMinutes < 0) {
      warnings.push(`mergeGapMinutes cannot be negative. Value: ${config.mergeGapMinutes}`);
    }

    return warnings;
  },

  // Backend performs API calls only; no data normalization here.

  /*
   * Small in-memory cache helpers keyed by a request signature (stringified
   * object describing credential + request options). Each entry stores a
   * payload and a timestamp and expires after `_cacheTTLMs` milliseconds.
   */
  _makeRequestSignature(student) {
    try {
      const credKey = this._getCredentialKey(student, this.config);
      const wantsHomeworkWidget = this._wantsWidget('homework', this.config?.displayMode);
      const wantsAbsencesWidget = this._wantsWidget('absences', this.config?.displayMode);
      const wantsGridWidget = this._wantsWidget('grid', this.config?.displayMode);
      const wantsLessonsWidget = this._wantsWidget('lessons', this.config?.displayMode);
      const wantsExamsWidget = this._wantsWidget('exams', this.config?.displayMode);

      // include the most relevant options that affect the backend fetch
      // Include studentId to differentiate caches when multiple students use the same credentials
      const sig = {
        credKey,
        studentId: student.studentId,
        className: student.class || student.className || null,
        daysToShow: Number(student.daysToShow || 0),
        pastDaysToShow: Number(student.pastDaysToShow || 0),
        useClassTimetable: Boolean(student.useClassTimetable),
        examsDaysAhead: Number(student.examsDaysAhead || 0),
        wantsGrid: wantsGridWidget,
        wantsLessons: wantsLessonsWidget,
        wantsExams: wantsExamsWidget,
        fetchHomeworks: Boolean(wantsHomeworkWidget),
        fetchAbsences: Boolean(wantsAbsencesWidget),
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
    this._responseCache.set(signature, { ts: Date.now(), payload });
  },

  /* Periodic cache cleanup ------------------------------------------------
   * Removes expired cache entries. Runs on an interval configured by
   * `_cacheCleanupIntervalMs` and respects `_cacheTTLMs` for entry expiration.
   */
  _cacheCleanup() {
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
    const groupWarnings = [];

    try {
      try {
        untis = this._createUntisClient(sample, this.config);
      } catch (err) {
        const msg = `No valid credentials for group ${credKey}: ${this._formatErr(err)}`;
        this._mmLog('error', null, msg);
        groupWarnings.push(msg);
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
            });
            groupWarnings.push(...studentValidationWarnings);
          }

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
          const errorMsg = `Error fetching data for ${student.title}: ${this._formatErr(err)}`;
          this._mmLog('error', student, errorMsg);

          // ===== CONVERT REST ERRORS TO USER-FRIENDLY WARNINGS =====
          const warningMsg = this._convertRestErrorToWarning(err, {
            studentTitle: student.title,
            school: student.school || this.config?.school,
            server: student.server || this.config?.server || 'webuntis.com',
          });
          if (warningMsg) {
            groupWarnings.push(warningMsg);
            this._mmLog('warn', student, warningMsg);
          }
        }
      }
    } catch (error) {
      this._mmLog('error', null, `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`);
      groupWarnings.push(`Authentication failed for group: ${this._formatErr(error)}`);
    } finally {
      try {
        if (untis) await untis.logout();
      } catch (err) {
        this._mmLog('error', null, `Error during logout for group ${credKey}: ${this._formatErr(err)}`);
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
    if (notification === 'FETCH_DATA') {
      // Assign incoming payload to module config
      // Normalize legacy config keys server-side as a defensive measure
      try {
        // require can fail in browser-like environments; wrap defensively
        const mapper = require(path.join(__dirname, 'config', 'legacy-config-mapper.js'));
        if (mapper && typeof mapper.normalizeConfig === 'function') {
          this.config = mapper.normalizeConfig(payload);
        } else {
          this.config = payload;
        }
      } catch (e) {
        // If mapping fails, fall back to raw payload
        this._mmLog('debug', null, `legacy-config-mapper not available or failed: ${e && e.message ? e.message : e}`);
        this.config = payload;
      }
      this._mmLog(
        'info',
        null,
        `Data request received (FETCH_DATA for students=${Array.isArray(this.config.students) ? this.config.students.length : 0})`
      );

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
                this.config.students = autoStudents;
                const studentList = autoStudents.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
                this._mmLog('info', null, `Auto-built students array from app/data: ${autoStudents.length} students:\n  ${studentList}`);
              }
            }
          } catch (e) {
            this._mmLog('debug', null, `Auto-build students from app/data failed: ${this._formatErr(e)}`);
          }
        }

        // Group students by credential so we can reuse the same untis session
        const identifier = this.config.id;
        const groups = new Map();

        // Group students by credential. Student configs are expected to be
        // normalized by the frontend before sending FETCH_DATA
        const studentsList = Array.isArray(this.config.students) ? this.config.students : [];
        for (const student of studentsList) {
          const credKey = this._getCredentialKey(student, this.config);
          if (!groups.has(credKey)) groups.set(credKey, []);
          groups.get(credKey).push(student);
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
    const isParentAccount = !useQrLogin && Boolean(student.studentId && Number.isFinite(Number(student.studentId)));
    const studentId = isParentAccount ? Number(student.studentId) : null;
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

    let rangeStart = new Date(Date.now());
    let rangeEnd = new Date(Date.now());

    rangeStart.setDate(rangeStart.getDate() - student.pastDaysToShow);
    rangeEnd.setDate(rangeEnd.getDate() - student.pastDaysToShow + parseInt(student.daysToShow));
    // Compute absences-specific start and end dates (allow per-student override or global config)
    const absPast = Number.isFinite(Number(student.absencesPastDays))
      ? Number(student.absencesPastDays)
      : Number.isFinite(Number(this.config?.absencesPastDays))
        ? Number(this.config.absencesPastDays)
        : 0;
    const absFuture = Number.isFinite(Number(student.absencesFutureDays))
      ? Number(student.absencesFutureDays)
      : Number.isFinite(Number(this.config?.absencesFutureDays))
        ? Number(this.config.absencesFutureDays)
        : 0;

    const absencesRangeStart = new Date(Date.now());
    absencesRangeStart.setDate(absencesRangeStart.getDate() - absPast);
    const absencesRangeEnd = new Date(rangeEnd);
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

    if (fetchTimetable && student.daysToShow > 0) {
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
    if (fetchExams && student.examsDaysAhead > 0) {
      // Validate the number of days
      if (student.examsDaysAhead < 1 || student.examsDaysAhead > 360 || isNaN(student.examsDaysAhead)) {
        student.examsDaysAhead = 30;
      }

      rangeStart = new Date(Date.now());
      rangeStart.setDate(rangeStart.getDate() - student.pastDaysToShow); // important for grid widget
      rangeEnd = new Date(Date.now());
      rangeEnd.setDate(rangeEnd.getDate() + student.examsDaysAhead);

      logger(`Exams: querying ${student.examsDaysAhead} days ahead...`);

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
      logger(`Exams: skipped (examsDaysAhead=${student.examsDaysAhead})`);
    }

    // Load homework for the period (from today until rangeEnd + 7 days) – keep raw
    let hwResult = null;
    if (fetchHomeworks) {
      logger(`Homework: fetching...`);
      try {
        let hwRangeEnd = new Date(rangeEnd);
        hwRangeEnd.setDate(hwRangeEnd.getDate() + 7);

        for (const target of restTargets) {
          logger(`Homework: fetching via REST (${describeTarget(target)})...`);
          try {
            const homeworks = await this._callRest(this._getHomeworkViaRest, target, new Date(), hwRangeEnd, restOptions);
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
    const compactTimetable = this._compactLessons(timetable);
    const compactExams = this._compactExams(rawExams);
    const compactHomeworks = fetchHomeworks ? this._compactHomeworks(hwResult, studentId) : [];
    const compactAbsences = fetchAbsences ? this._compactAbsences(rawAbsences) : [];
    const compactMessagesOfDay = fetchMessagesOfDay ? this._compactMessagesOfDay(rawMessagesOfDay) : [];
    const compactHolidays = fetchHolidays ? this._compactHolidays(rawHolidays) : [];

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
      // Absences are now available via REST API even for parent accounts
      absencesUnavailable: false,
    };
    try {
      // Collect any warnings attached to the student and expose them at the
      // top-level payload so the frontend can display module-level warnings
      // independent of per-student sections. Dedupe messages so each is shown once.
      let warnings = [];
      if (payload && payload.config && Array.isArray(payload.config.__warnings)) {
        warnings = warnings.concat(payload.config.__warnings);
      }

      // ===== ADD EMPTY DATA WARNINGS =====
      if (timetable.length === 0 && fetchTimetable && student.daysToShow > 0) {
        const emptyWarn = this._checkEmptyDataWarning(timetable, 'lessons', student.title, true);
        if (emptyWarn) warnings.push(emptyWarn);
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
