/* eslint-disable n/no-missing-require */
const NodeHelper = require('node_helper');
const Log = require('logger');
/* eslint-enable n/no-missing-require */
const fs = require('fs');
const path = require('path');
const fetchClient = require('./lib/fetchClient');

// New utility modules for refactoring
const { compactArray, schemas } = require('./lib/payloadCompactor');
const { validateConfig, applyLegacyMappings, generateDeprecationWarnings } = require('./lib/configValidator');
const { createBackendLogger } = require('./lib/logger');
const webuntisApiService = require('./lib/webuntisApiService');
const AuthService = require('./lib/authService');
const dataTransformer = require('./lib/dataTransformer');
const CacheManager = require('./lib/cacheManager');
const errorHandler = require('./lib/errorHandler');
const widgetConfigValidator = require('./lib/widgetConfigValidator');

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

    // Create lib logger wrapper that adapts to _mmLog signature
    // lib classes call: logger(level, message)
    // _mmLog expects: (level, student, message)
    const libLogger = (level, message) => {
      // Add [lib] prefix to distinguish lib logs from module logs
      this._mmLog(level, null, `[lib] ${message}`);
    };

    // Initialize AuthService for token and authentication management
    this.authService = new AuthService({ logger: libLogger });
    // Initialize CacheManager for class ID and other caching
    this.cacheManager = new CacheManager(this._mmLog.bind(this));
    // expose payload compactor so linters don't flag unused imports until full refactor
    this.payloadCompactor = { compactArray };
    // Track whether config warnings have been emitted to frontend to avoid repeat spam
    this._configWarningsSent = false;
    // Persist debugDate across FETCH_DATA requests to ensure consistent date-based testing
    this._persistedDebugDate = null;
    // Multi-instance support: store config per identifier
    this._configsByIdentifier = new Map();
    // Session-based config isolation: each browser window keeps its own config
    this._configsBySession = new Map();
    // Cache fetched data by credKey so we can reuse for sessions with same credentials
    this._dataByCredKey = new Map();
    this._pendingFetchByCredKey = new Map(); // Track pending fetches to coalesce requests
    // Session-based coalescing: each session gets its own timer
    this._coalescingTimerBySession = new Map();
    this._coalescingDelay = 2000; // 2 seconds window to coalesce requests
  },

  _normalizeLegacyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return cfg;

    // Use centralized legacy mapping from configValidator
    const { normalizedConfig, legacyUsed } = applyLegacyMappings(cfg, {
      warnCallback: (msg) => this._mmLog('warn', null, msg),
    });

    // Ensure displayMode is lowercase
    if (typeof normalizedConfig.displayMode === 'string') {
      normalizedConfig.displayMode = normalizedConfig.displayMode.toLowerCase();
    }

    if (legacyUsed.length > 0) {
      try {
        const uniq = Array.from(new Set(legacyUsed));

        // Generate detailed deprecation warnings
        const detailedWarnings = generateDeprecationWarnings(uniq);

        // Attach warnings to config.__warnings so they get sent to frontend and displayed in GUI
        normalizedConfig.__warnings = normalizedConfig.__warnings || [];
        normalizedConfig.__warnings.push(...detailedWarnings);

        // Also log them to server logs (only detailed warnings, not the generic summary)
        detailedWarnings.forEach((warning) => {
          this._mmLog('warn', null, warning);
        });

        // Log the normalized config as formatted JSON (with redacted sensitive data) for reference (server-side only)
        const redacted = { ...normalizedConfig };
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

    return normalizedConfig;
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
    // Don't add [MMM-Webuntis] tag here - MagicMirror's Log methods add it automatically
    const studentTag = student && student.title ? `[${String(student.title).trim()}] ` : '';
    const formatted = `${studentTag}${message}`;

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
    return errorHandler.formatError(err);
  },

  /**
   * Map REST API status to legacy JSON-RPC code format (delegated to dataTransformer)
   */
  _mapRestStatusToLegacyCode(status, substitutionText) {
    return dataTransformer.mapRestStatusToLegacyCode(status, substitutionText);
  },

  /**
   * Create standard options object for authService calls (with logging and error handlers)
   */
  _getStandardAuthOptions(additionalOptions = {}) {
    return {
      ...additionalOptions,
      mmLog: this._mmLog.bind(this),
      formatErr: this._formatErr.bind(this),
    };
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
    if (this.cacheManager.has('classId', cacheKey)) {
      return this.cacheManager.get('classId', cacheKey);
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

    const { token, cookieString, tenantId, schoolYearId } = await this.authService.getAuth({
      school,
      username,
      password,
      server,
      options: {
        ...options,
        mmLog: this._mmLog.bind(this),
        formatErr: this._formatErr.bind(this),
      },
    });

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
        const url = new URL(`https://${server}/WebUntis/api/classreg/classservices`);
        url.searchParams.append('startDate', formatDateYYYYMMDD(rangeStart));
        url.searchParams.append('endDate', formatDateYYYYMMDD(rangeEnd));
        url.searchParams.append('elementId', options.studentId);

        const resp = await fetchClient.get(url.toString(), {
          headers,
          timeout: 15000,
        });

        if (resp.data) {
          candidates = this._collectClassCandidates(resp.data);
          // Prefer explicit mapping from personKlasseMap when present
          const map = resp.data?.data?.personKlasseMap;
          if (map && Object.prototype.hasOwnProperty.call(map, options.studentId)) {
            const mapped = map[options.studentId];
            if (Number.isFinite(Number(mapped))) mappedClassId = Number(mapped);
          }
          this._mmLog('debug', null, `[REST] classservices returned ${candidates.length} class candidates`);
        }
      } catch (err) {
        this._mmLog('debug', null, `[REST] classservices error: ${this._formatErr(err)}`);
      }
    }

    // Secondary path: timetable/filter (broader) if nothing found yet
    if (!candidates || candidates.length === 0) {
      try {
        const url = new URL(`https://${server}/WebUntis/api/rest/view/v1/timetable/filter`);
        url.searchParams.append('resourceType', 'CLASS');
        url.searchParams.append('timetableType', 'STANDARD');
        url.searchParams.append('start', formatDateISO(rangeStart));
        url.searchParams.append('end', formatDateISO(rangeEnd));

        const resp = await fetchClient.get(url.toString(), {
          headers,
          timeout: 15000,
        });

        if (resp.data) {
          candidates = this._collectClassCandidates(resp.data);
          this._mmLog('debug', null, `[REST] timetable/filter returned ${candidates.length} class candidates`);
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

    this.cacheManager.set('classId', cacheKey, chosen.id);
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
    let classId = options.classId;

    // Resolve class ID if needed
    if (wantsClass && !classId) {
      classId = await this._resolveClassIdViaRest(
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

    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    return webuntisApiService.getTimetable({
      getAuth: () =>
        this.authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => this.authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      useClassTimetable: wantsClass,
      classId,
      logger: this._mmLog.bind(this),
      mapStatusToCode: this._mapRestStatusToLegacyCode.bind(this),
      debugApi: this.config?.debugApi || false,
    });
  },

  async _getExamsViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    return webuntisApiService.getExams({
      getAuth: () =>
        this.authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => this.authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      normalizeDate: this._normalizeDateToInteger.bind(this),
      normalizeTime: this._normalizeTimeToMinutes.bind(this),
      sanitizeHtml: this._sanitizeHtmlText.bind(this),
      debugApi: this.config?.debugApi || false,
    });
  },

  async _getHomeworkViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    return webuntisApiService.getHomework({
      getAuth: () =>
        this.authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => this.authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      debugApi: this.config?.debugApi || false,
    });
  },

  async _getAbsencesViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    return webuntisApiService.getAbsences({
      getAuth: () =>
        this.authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => this.authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      debugApi: this.config?.debugApi || false,
    });
  },

  async _getMessagesOfDayViaRest(school, username, password, server, date, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    return webuntisApiService.getMessagesOfDay({
      getAuth: () =>
        this.authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => this.authService.invalidateCache(cacheKey),
      server,
      date,
      logger: this._mmLog.bind(this),
      debugApi: this.config?.debugApi || false,
    });
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
          const { appData } = await this.authService.getAuth({
            school: moduleConfig.school,
            username: moduleConfig.username,
            password: moduleConfig.password,
            server,
            options: this._getStandardAuthOptions(),
          });
          autoStudents = this.authService.deriveStudentsFromAppData(appData);

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
      const { appData } = await this.authService.getAuth({
        school: moduleConfig.school,
        username: moduleConfig.username,
        password: moduleConfig.password,
        server,
        options: this._getStandardAuthOptions({ cacheKey: `parent:${moduleConfig.username}@${server}` }),
      });
      autoStudents = this.authService.deriveStudentsFromAppData(appData);

      if (!autoStudents || autoStudents.length === 0) {
        this._mmLog('warn', null, 'No students discovered via app/data; please configure students[] manually');
        return;
      }

      // Merge module-level defaults into each discovered student so downstream
      // fetch logic has the expected fields (nextDays, etc.)
      // Only assign discovered students once to avoid repeated re-assignment
      // during periodic fetches which can lead to duplicate or inconsistent
      // entries being appended to the runtime config.
      if (!moduleConfig._autoStudentsAssigned) {
        const defNoStudents = { ...(moduleConfig || {}) };
        delete defNoStudents.students;
        // Don't copy parent credentials into student configs to avoid confusion in _createAuthSession
        delete defNoStudents.username;
        delete defNoStudents.password;
        delete defNoStudents.school;
        delete defNoStudents.server;
        const normalizedAutoStudents = autoStudents.map((s) => {
          const merged = { ...defNoStudents, ...(s || {}), _autoDiscovered: true };
          // Ensure displayMode is lowercase
          if (typeof merged.displayMode === 'string') {
            merged.displayMode = merged.displayMode.toLowerCase();
          }
          return merged;
        });

        moduleConfig.students = normalizedAutoStudents;
        moduleConfig._autoStudentsAssigned = true;

        // Log all discovered students with their IDs in a prominent way
        const studentList = normalizedAutoStudents.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
        this._mmLog('debug', null, `✓ Auto-discovered ${normalizedAutoStudents.length} student(s):\n  ${studentList}`);
      } else {
        this._mmLog('debug', null, 'Auto-discovered students already assigned; skipping reassignment');
      }
    } catch (err) {
      this._mmLog('warn', null, `Auto student discovery failed: ${this._formatErr(err)}`);
    }
  },

  /**
   * Create an authenticated session for a student
   * Returns a session object with authentication data or throws an Error if credentials missing.
   *
   * @param {Object} sample - Student configuration sample
   * @param {Object} moduleConfig - Module configuration
   * @returns {Promise<Object>} Session object with { school, server, personId, cookies, token, tenantId, schoolYearId }
   */
  async _createAuthSession(sample, moduleConfig) {
    const hasStudentId = sample.studentId && Number.isFinite(Number(sample.studentId));
    const useQrLogin = Boolean(sample.qrcode);
    const hasOwnCredentials = sample.username && sample.password && sample.school && sample.server;
    const isParentMode = hasStudentId && !hasOwnCredentials && !useQrLogin;

    // Mode 0: QR Code Login (student)
    if (useQrLogin) {
      this._mmLog('debug', sample, 'Getting QR code authentication (cached or new)');
      const authResult = await this.authService.getAuthFromQRCode(sample.qrcode, {
        cacheKey: `qrcode:${sample.qrcode}`,
      });
      return {
        school: authResult.school,
        server: authResult.server,
        personId: authResult.personId,
        cookieString: authResult.cookieString, // Changed 'cookies' to 'cookieString'
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData,
        mode: 'qr',
        qrCodeUrl: sample.qrcode, // Store QR code URL for re-authentication
      };
    }

    // Mode 1: Parent Account (studentId + parent credentials from moduleConfig)
    if (isParentMode && moduleConfig && moduleConfig.username && moduleConfig.password) {
      const school = sample.school || moduleConfig.school;
      const server = sample.server || moduleConfig.server || 'webuntis.com';
      this._mmLog('debug', sample, `Authenticating with parent account (school=${school}, server=${server})`);
      const authResult = await this.authService.getAuth({
        school,
        username: moduleConfig.username,
        password: moduleConfig.password,
        server,
        options: { cacheKey: `parent:${moduleConfig.username}@${server}` },
      });
      return {
        school,
        server,
        personId: authResult.personId, // Parent's personId (used for auto-discovery)
        cookieString: authResult.cookieString, // Changed from 'cookies' to 'cookieString'
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData,
        mode: 'parent',
      };
    }

    // Mode 2: Direct Student Login (own credentials)
    if (hasOwnCredentials) {
      this._mmLog('debug', sample, `Authenticating with direct login (school=${sample.school}, server=${sample.server})`);
      const authResult = await this.authService.getAuth({
        school: sample.school,
        username: sample.username,
        password: sample.password,
        server: sample.server,
        options: { cacheKey: `direct:${sample.username}@${sample.server}` },
      });
      return {
        school: sample.school,
        server: sample.server,
        personId: authResult.personId,
        cookieString: authResult.cookieString, // Changed from 'cookies' to 'cookieString'
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData,
        mode: 'direct',
      };
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

    // Check if this is the old format (array of rows with timeUnits)
    // or new format (direct array of time slots)
    const firstRow = rawGrid[0];
    if (firstRow && Array.isArray(firstRow.timeUnits)) {
      // Old format: array of rows with timeUnits
      return firstRow.timeUnits.map((u) => ({
        startTime: u.startTime,
        endTime: u.endTime,
        name: u.name,
      }));
    }

    // New format: direct array of time slots from _extractTimegridFromTimetable
    if (firstRow && firstRow.startTime && firstRow.endTime) {
      return rawGrid.map((u) => ({
        startTime: u.startTime,
        endTime: u.endTime,
        name: u.name || '',
      }));
    }

    return [];
  },

  /**
   * Sanitize HTML text (delegated to dataTransformer)
   */
  _sanitizeHtmlText(text, preserveLineBreaks = true) {
    return dataTransformer.sanitizeHtmlText(text, preserveLineBreaks);
  },

  /**
   * Normalize date format (delegated to dataTransformer)
   */
  _normalizeDateToInteger(date) {
    return dataTransformer.normalizeDateToInteger(date);
  },

  /**
   * Normalize time format (delegated to dataTransformer)
   */
  _normalizeTimeToMinutes(time) {
    return dataTransformer.normalizeTimeToMinutes(time);
  },

  _compactHolidays(rawHolidays) {
    if (!Array.isArray(rawHolidays)) return [];
    return rawHolidays.map((h) => {
      // Handle both appData format (start/end ISO timestamps) and legacy format (startDate/endDate YYYYMMDD)
      let startDate = h.startDate;
      let endDate = h.endDate;

      // Convert ISO timestamp to YYYYMMDD if needed
      if (h.start && !h.startDate) {
        const startDateObj = new Date(h.start);
        startDate = startDateObj.getFullYear() * 10000 + (startDateObj.getMonth() + 1) * 100 + startDateObj.getDate();
      }
      if (h.end && !h.endDate) {
        const endDateObj = new Date(h.end);
        endDate = endDateObj.getFullYear() * 10000 + (endDateObj.getMonth() + 1) * 100 + endDateObj.getDate();
      }

      return {
        id: h.id ?? null,
        name: h.name ?? h.longName ?? '',
        longName: h.longName ?? h.name ?? '',
        startDate: startDate ?? null,
        endDate: endDate ?? null,
      };
    });
  },

  /**
   * Extract and compact holidays from authSession.appData.
   * This is called once per credential group to avoid redundant processing.
   * @param {Object} authSession - Authenticated session with appData
   * @param {boolean} shouldFetch - Whether holidays should be fetched
   * @returns {Array} Compacted holidays array
   */
  _extractAndCompactHolidays(authSession, shouldFetch) {
    if (!shouldFetch) return [];

    let rawHolidays = [];
    try {
      // Holidays are included in the app/data response (authSession.appData)
      if (authSession && authSession.appData) {
        // Check if holidays are directly in appData or nested
        if (Array.isArray(authSession.appData.holidays)) {
          rawHolidays = authSession.appData.holidays;
          this._mmLog('debug', null, `Holidays: ${rawHolidays.length} periods extracted from appData.holidays`);
        } else if (authSession.appData.data && Array.isArray(authSession.appData.data.holidays)) {
          rawHolidays = authSession.appData.data.holidays;
          this._mmLog('debug', null, `Holidays: ${rawHolidays.length} periods extracted from appData.data.holidays`);
        } else {
          this._mmLog('debug', null, 'Holidays: no holidays array found in appData');
        }
      } else {
        this._mmLog('debug', null, 'Holidays: no appData available');
      }
    } catch (error) {
      this._mmLog('error', null, `Holidays extraction failed: ${error && error.message ? error.message : error}`);
    }

    return this._compactHolidays(rawHolidays);
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
    // Validate credentials
    const credentialWarnings = widgetConfigValidator.validateStudentCredentials(student);

    // Validate widget-specific configurations
    const widgetWarnings = widgetConfigValidator.validateStudentWidgets(student);

    return [...credentialWarnings, ...widgetWarnings];
  },

  /**
   * Convert REST API errors to user-friendly warning messages
   */
  _convertRestErrorToWarning(error, context = {}) {
    return errorHandler.convertRestErrorToWarning(error, context);
  },

  /**
   * Check if empty data array should trigger a warning
   */
  _checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData = true) {
    return errorHandler.checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData);
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

    // Validate widget-specific configurations
    const widgetWarnings = widgetConfigValidator.validateAllWidgets(config);
    warnings.push(...widgetWarnings);

    return warnings;
  },

  // Backend performs API calls only; no data normalization here.

  /*
   * Small in-memory cache helpers keyed by a request signature (stringified





  /**
   * Process a credential group: login, fetch data for students and logout.
   * If cachedAuthSession is provided, reuses it instead of creating a new one.
   * This function respects the inflightRequests Map's pending flag: if pending
   * becomes true while running, it will loop once more to handle the coalesced request.
   */
  async processGroup(credKey, students, identifier, sessionKey, cachedAuthSession = null) {
    // Single-run processing: authenticate (or reuse cached session), fetch data for each student, and logout.
    let authSession = cachedAuthSession;
    const sample = students[0];
    const groupWarnings = [];
    // Per-fetch-cycle warning deduplication set. Ensures identical warnings
    // are reported only once per processing run (prevents spam across students).
    this._currentFetchWarnings = new Set();

    try {
      try {
        if (!authSession) {
          // No cached session - create new one
          authSession = await this._createAuthSession(sample, this.config);
        } else {
          this._mmLog('debug', null, `Reusing cached authSession for credKey=${credKey}`);
        }
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
            sessionKey: sessionKey, // Add session info for filtering
          });
        }
        return;
      }

      // ===== EXTRACT HOLIDAYS ONCE FOR ALL STUDENTS =====
      // Holidays are shared across all students in the same school/group.
      // Extract and compact them once before processing students to avoid redundant work.
      const wantsGridWidget = this._wantsWidget('grid', this.config?.displayMode);
      const wantsLessonsWidget = this._wantsWidget('lessons', this.config?.displayMode);
      const shouldFetchHolidays = Boolean(wantsGridWidget || wantsLessonsWidget);
      const sharedCompactHolidays = this._extractAndCompactHolidays(authSession, shouldFetchHolidays);
      if (shouldFetchHolidays) {
        this._mmLog(
          'debug',
          null,
          `Holidays extracted for group: ${sharedCompactHolidays.length} periods (shared across ${students.length} students)`
        );
      }

      // Authentication complete via authService (no login() needed)
      // Collect all student payloads before sending to avoid multiple DOM updates
      const studentPayloads = [];

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
          const payload = await this.fetchData(authSession, student, identifier, credKey, sharedCompactHolidays);
          if (!payload) {
            this._mmLog('warn', student, `fetchData returned empty payload for ${student.title}`);
          } else {
            // Add warnings to payload
            const uniqWarnings = Array.from(new Set(groupWarnings));
            studentPayloads.push({ ...payload, id: identifier, warnings: uniqWarnings });
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

      // Send all collected payloads at once to minimize DOM redraws
      this._mmLog('debug', null, `Sending batched GOT_DATA for ${studentPayloads.length} student(s) to identifier ${identifier}`);

      // Cache the authSession by credKey so other sessions can reuse it instead of re-authenticating
      this._dataByCredKey.set(credKey, authSession);

      for (const payload of studentPayloads) {
        // Send to ALL module instances with this identifier (via the id field)
        // Frontend filters by id, not sessionKey, so all instances receive the data
        payload.id = identifier;
        this.sendSocketNotification('GOT_DATA', payload);
      }
    } catch (error) {
      this._mmLog('error', null, `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`);
      const authMsg = `Authentication failed for group: ${this._formatErr(error)}`;
      if (!this._currentFetchWarnings.has(authMsg)) {
        groupWarnings.push(authMsg);
        this._currentFetchWarnings.add(authMsg);
      }
    } finally {
      // Cleanup not needed - session managed by authService cache
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
      // Track if this is a config update (for browser reload detection)
      let normalizedConfig; // Declare outside try so it's accessible after catch
      let sessionKey; // Declare outside try for use in coalescing logic
      let configChanged = false; // Declare outside try for use in coalescing logic

      // Validate configuration and return errors to frontend if invalid
      try {
        // Apply legacy mappings to convert old keys to new structure (includes normalization)
        const result = applyLegacyMappings(payload, {
          warnCallback: (msg) => this._mmLog('warn', null, msg),
        });
        normalizedConfig = result.normalizedConfig;
        const legacyUsed = result.legacyUsed;

        const identifier = normalizedConfig.id || 'default';
        const sessionId = payload.sessionId || 'unknown';

        // Store config per session for isolation (each browser window keeps its own config)
        sessionKey = `${identifier}:${sessionId}`;
        this._configsBySession.set(sessionKey, normalizedConfig);
        this._mmLog('debug', null, `[FETCH_DATA] Config stored for session=${sessionKey}`);

        // Persist debugDate: save it if present in current config, otherwise use the persisted one
        if (normalizedConfig.debugDate) {
          this._persistedDebugDate = normalizedConfig.debugDate;
          this._mmLog('debug', null, `[FETCH_DATA] Received debugDate="${normalizedConfig.debugDate}"`);
        } else if (this._persistedDebugDate) {
          // No debugDate in current request, use the persisted one from previous request
          normalizedConfig.debugDate = this._persistedDebugDate;
          this._mmLog('debug', null, `[FETCH_DATA] Using persisted debugDate="${this._persistedDebugDate}"`);
        } else {
          this._mmLog('debug', null, `[FETCH_DATA] No debugDate configured`);
        }

        // Ensure displayMode is lowercase (part of normalization)
        if (typeof normalizedConfig.displayMode === 'string') {
          normalizedConfig.displayMode = normalizedConfig.displayMode.toLowerCase();
        }

        const validatorLogger = this.logger || { log: (level, msg) => this._mmLog(level, null, msg) };
        const { valid, errors, warnings } = validateConfig(normalizedConfig, validatorLogger);

        // Generate detailed deprecation warnings for any legacy keys used
        const detailedWarnings = legacyUsed && legacyUsed.length > 0 ? generateDeprecationWarnings(legacyUsed) : [];
        const combinedWarnings = [...(warnings || []), ...detailedWarnings];
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

        // Store validated config per identifier for multi-instance support
        // Always update config, even if a timer is already running, to ensure
        // the latest config is used for the next execution (e.g., after browser reload)
        const existingConfig = this._configsByIdentifier.get(identifier);
        configChanged = existingConfig !== undefined; // true if config already existed (update scenario)
        this._configsByIdentifier.set(identifier, normalizedConfig);
        // Also set as global config for backward compatibility (use most recent)
        this.config = normalizedConfig;

        // Log if config was updated for an existing identifier
        if (configChanged) {
          this._mmLog('debug', null, `[FETCH_DATA] Config updated for identifier=${identifier} (likely browser reload)`);
        }

        this._mmLog(
          'debug',
          null,
          `Data request received (FETCH_DATA identifier=${identifier}, students=${Array.isArray(normalizedConfig.students) ? normalizedConfig.students.length : 0})`
        );

        // Debug: show which interval keys frontend sent (updateInterval preferred)
        this._mmLog(
          'debug',
          null,
          `Received intervals: updateInterval=${normalizedConfig.updateInterval} fetchIntervalMs=${normalizedConfig.fetchIntervalMs}`
        );
      } catch (e) {
        this._mmLog('error', null, `Config validation failed: ${this._formatErr(e)}`);
        return;
      }

      // If config was updated (browser reload), cancel the existing timer for this session and start fresh
      // This ensures the new config is used immediately instead of waiting for the next interval
      const shouldFetchImmediately = configChanged;
      if (this._coalescingTimerBySession.has(sessionKey) && shouldFetchImmediately) {
        this._mmLog(
          'debug',
          null,
          `[FETCH_DATA] Cancelling existing timer for session ${sessionKey} to apply new config immediately (configChanged=${configChanged})`
        );
        clearTimeout(this._coalescingTimerBySession.get(sessionKey));
        this._coalescingTimerBySession.delete(sessionKey);
      }

      // Debounce and coalesce requests per session
      // If this session already has a timer running, just queue the config and wait
      if (this._coalescingTimerBySession.has(sessionKey)) {
        this._mmLog('debug', null, `[FETCH_DATA] Request queued for coalescing (session=${sessionKey})`);
        return;
      }

      // Start session-specific coalescing timer
      const timer = setTimeout(async () => {
        this._coalescingTimerBySession.delete(sessionKey);
        await this._executeFetchForSession(sessionKey);
      }, this._coalescingDelay);

      this._coalescingTimerBySession.set(sessionKey, timer);
      this._mmLog('debug', null, `[FETCH_DATA] Coalescing timer started for session ${sessionKey} (${this._coalescingDelay}ms window)`);
    }
  },

  /**
   * Execute fetch for a specific session
   * This processes only the config for the given session
   */
  async _executeFetchForSession(sessionKey) {
    if (!this._configsBySession.has(sessionKey)) {
      this._mmLog('warn', null, `Session ${sessionKey} not found, skipping fetch`);
      return;
    }

    const config = this._configsBySession.get(sessionKey);

    this._mmLog('debug', null, `Processing session: ${sessionKey}`);

    // Set as active config for this execution
    this.config = config;

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
                const normalized = autoStudents.map((s) => {
                  const merged = { ...defNoStudents, ...(s || {}), _autoDiscovered: true };
                  // Ensure displayMode is lowercase
                  if (typeof merged.displayMode === 'string') {
                    merged.displayMode = merged.displayMode.toLowerCase();
                  }
                  return merged;
                });
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

      // Process each credential group for this session
      for (const [credKey, students] of groups.entries()) {
        // Check if we already have a cached authSession for this credKey
        const cachedAuthSession = this._dataByCredKey.has(credKey) ? this._dataByCredKey.get(credKey) : null;

        if (cachedAuthSession) {
          // Reuse cached authentication session - no need to re-authenticate
          this._mmLog('debug', null, `Session ${sessionKey}: Found cached authSession for credKey=${credKey}, fetching data`);

          // Check if another session is currently fetching this credKey
          if (this._pendingFetchByCredKey.has(credKey)) {
            this._mmLog('debug', null, `Session ${sessionKey}: Waiting for another session's fetch of credKey=${credKey} to complete`);
            // Wait for the other session to finish processing
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          // Process this session's data using the cached authSession
          const sessionIdentifier = sessionKey.split(':')[0];
          await this.processGroup(credKey, students, sessionIdentifier, sessionKey, cachedAuthSession);
        } else {
          // No cached authSession - need to authenticate and fetch
          this._mmLog('debug', null, `Session ${sessionKey}: No cached authSession for credKey=${credKey}, authenticating and fetching`);

          // Check if another session is already authenticating this credKey
          if (this._pendingFetchByCredKey.has(credKey)) {
            this._mmLog('debug', null, `Session ${sessionKey}: Waiting for another session's authentication of credKey=${credKey}`);
            // Wait for the other session to complete and cache the authSession
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Check again if authSession is now cached
            if (this._dataByCredKey.has(credKey)) {
              this._mmLog('debug', null, `Session ${sessionKey}: Using authSession cached by other session`);
              const cachedSession = this._dataByCredKey.get(credKey);
              const sessionIdentifier = sessionKey.split(':')[0];
              await this.processGroup(credKey, students, sessionIdentifier, sessionKey, cachedSession);
              continue;
            }
          }

          // Mark as processing
          this._pendingFetchByCredKey.set(credKey, true);

          try {
            // Authenticate and fetch - this caches the authSession in processGroup
            const sessionIdentifier = sessionKey.split(':')[0];
            await this.processGroup(credKey, students, sessionIdentifier, sessionKey);
          } finally {
            // Remove from pending after completion
            this._pendingFetchByCredKey.delete(credKey);
          }
        }
      }

      this._mmLog('debug', null, `Successfully fetched data for session ${sessionKey}`);
    } catch (error) {
      this._mmLog('error', null, `Error loading Untis data for session ${sessionKey}: ${error}`);
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
   * Extract timegrid from timetable data (REST API returns time slots with lessons)
   * The REST API doesn't have a separate timegrid endpoint, but the timetable includes time information
   *
   * @param {Array} timetable - Timetable array from REST API
   * @returns {Array} timegrid array with timeUnits
   */
  _extractTimegridFromTimetable(timetable) {
    if (!Array.isArray(timetable) || timetable.length === 0) return [];

    // Extract unique START times from all lessons
    const startTimes = new Set();
    timetable.forEach((lesson) => {
      if (lesson.startTime) {
        startTimes.add(lesson.startTime);
      }
    });

    if (startTimes.size === 0) return [];

    // Sort unique start times
    const sortedStarts = Array.from(startTimes).sort((a, b) => {
      const timeA = parseInt(a.replace(':', ''));
      const timeB = parseInt(b.replace(':', ''));
      return timeA - timeB;
    });

    // Create timeUnits (periods) from sorted start times
    const timeUnits = [];
    for (let i = 0; i < sortedStarts.length; i++) {
      const startTime = sortedStarts[i];
      // Estimate end time: either from next period or assume 45-minute period
      let endTime = sortedStarts[i + 1];
      if (!endTime) {
        // For the last period, find the latest end time from lessons with this start
        const lessonsWithThisStart = timetable.filter((l) => l.startTime === startTime);
        endTime = lessonsWithThisStart.length > 0 ? lessonsWithThisStart[0].endTime : null;
        if (!endTime) {
          const [hh, mm] = startTime.split(':').map(Number);
          endTime = `${String(hh).padStart(2, '0')}${String(mm + 45).padStart(2, '0')}`;
        }
      }

      timeUnits.push({
        startTime,
        endTime,
        name: `${i + 1}`, // Period number
      });
    }

    return timeUnits;
  },

  /**
   * Fetch and normalize data for a single student using the provided authenticated session.
   * This collects lessons, exams and homeworks and sends a
   * `GOT_DATA` socket notification back to the frontend.
   *
   * @param {Object} authSession - Authenticated session with server, school, cookies, token
   * @param {Object} student - Student config object
   * @param {string} identifier - Module instance identifier
   * @param {string} credKey - Credential grouping key
   * @param {Array} compactHolidays - Pre-extracted and compacted holidays (shared across students in group)
   */
  async fetchData(authSession, student, identifier, credKey, compactHolidays = []) {
    const logger = (msg) => {
      this._mmLog('debug', student, msg);
    };
    // Backend fetches raw data from Untis API. No transformation here.

    const restOptions = { cacheKey: credKey, authSession };
    // Pass QR code URL if available (needed for re-authentication when token expires)
    if (authSession.qrCodeUrl) {
      restOptions.qrCodeUrl = authSession.qrCodeUrl;
    }
    const { school, server } = authSession;
    const ownPersonId = authSession.personId;
    const bearerToken = authSession.token;
    const appData = authSession.appData; // Contains user.students[] for parent account mapping
    const restTargets = this.authService.buildRestTargets(student, this.config, school, server, ownPersonId, bearerToken, appData);
    const describeTarget = (t) =>
      t.mode === 'qr' ? `QR login${t.studentId ? ` (id=${t.studentId})` : ''}` : `parent (studentId=${t.studentId})`;
    const className = student.class || student.className || this.config?.class || null;

    // Use student-specific displayMode if available, otherwise fall back to module-level
    const effectiveDisplayMode = student.displayMode ?? this.config?.displayMode;

    const wantsGridWidget = this._wantsWidget('grid', effectiveDisplayMode);
    const wantsLessonsWidget = this._wantsWidget('lessons', effectiveDisplayMode);
    const wantsExamsWidget = this._wantsWidget('exams', effectiveDisplayMode);
    const wantsHomeworkWidget = this._wantsWidget('homework', effectiveDisplayMode);
    const wantsAbsencesWidget = this._wantsWidget('absences', effectiveDisplayMode);
    const wantsMessagesOfDayWidget = this._wantsWidget('messagesofday', effectiveDisplayMode);

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
    const absFuture = Number.isFinite(Number(student.absences?.nextDays ?? student.absencesFutureDays))
      ? Number(student.absences?.nextDays ?? student.absencesFutureDays)
      : Number.isFinite(Number(this.config?.absences?.nextDays ?? this.config?.absencesFutureDays))
        ? Number(this.config?.absences?.nextDays ?? this.config?.absencesFutureDays)
        : 0;

    const absencesRangeStart = new Date(baseNow);
    absencesRangeStart.setDate(absencesRangeStart.getDate() - absPast);
    const absencesRangeEnd = new Date(baseNow);
    absencesRangeEnd.setDate(absencesRangeEnd.getDate() + absFuture);

    // Get Timegrid - prefer appData.currentSchoolYear.timeGrid.units, fallback to extraction from timetable
    // This ensures we have timeUnits even during holidays when no lessons are scheduled
    let grid = [];

    // Try to extract timeGrid from appData first
    if (authSession?.appData?.currentSchoolYear?.timeGrid?.units) {
      const units = authSession.appData.currentSchoolYear.timeGrid.units;
      if (Array.isArray(units) && units.length > 0) {
        grid = units.map((u) => ({
          name: String(u.unitOfDay || u.period || ''),
          startTime: u.startTime || 0,
          endTime: u.endTime || 0,
        }));
        logger(`✓ Timegrid: extracted ${grid.length} time slots from appData.currentSchoolYear.timeGrid\n`);
      }
    }

    // Prepare raw timetable containers
    let timetable = [];

    if (fetchTimetable && gridNextDays > 0) {
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

    // Extract timegrid from timetable data only if not already available from appData
    if (fetchTimegrid && grid.length === 0 && timetable.length > 0) {
      grid = this._extractTimegridFromTimetable(timetable);
      logger(`✓ Timegrid: extracted ${grid.length} time slots from timetable (fallback)\n`);
    }
    const examsNextDays =
      student.exams?.nextDays ??
      student.examsDaysAhead ??
      student.exams?.daysAhead ??
      this.config?.exams?.nextDays ??
      this.config?.examsDaysAhead ??
      this.config?.exams?.daysAhead ??
      0;
    if (fetchExams && examsNextDays > 0) {
      // Validate the number of days
      let validatedDays = examsNextDays;
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
      } catch (error) {
        this._mmLog('error', student, `Exams failed: ${error && error.message ? error.message : error}\n`);
      }
    } else {
      logger(`Exams: skipped (exams.nextDays=${examsNextDays})`);
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
        if (fetchExams && examsNextDays > 0) {
          const examsPastDays =
            student.exams?.pastDays ??
            student.pastDaysToShow ??
            student.pastDays ??
            this.config?.exams?.pastDays ??
            this.config?.pastDays ??
            0;
          allRanges.push({ pastDays: examsPastDays, futureDays: examsNextDays });
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
            rawMessagesOfDay = await this._callRest(this._getMessagesOfDayViaRest, target, baseNow, restOptions);
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

    // Holidays are now pre-extracted in processGroup() and passed as parameter.
    // This avoids redundant extraction for each student in the same group.
    if (fetchHolidays && compactHolidays.length > 0) {
      logger(`Holidays: using ${compactHolidays.length} pre-extracted periods`);
    } else if (fetchHolidays) {
      logger(`Holidays: no data available`);
    } else {
      logger(`Holidays: skipped`);
    }

    // Compact payload to reduce memory before caching and sending to the frontend.
    const compactGrid = this._compactTimegrid(grid);
    const compactTimetable = compactArray(timetable, schemas.lesson);
    const compactExams = compactArray(rawExams, schemas.exam);
    const compactHomeworks = fetchHomeworks ? compactArray(hwResult, schemas.homework) : [];
    const compactAbsences = fetchAbsences ? compactArray(rawAbsences, schemas.absence) : [];
    const compactMessagesOfDay = fetchMessagesOfDay ? compactArray(rawMessagesOfDay, schemas.message) : [];

    const toYmd = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rangeStartYmd = toYmd(rangeStart);
    const rangeEndYmd = toYmd(rangeEnd);
    const holidayByDate = (() => {
      if (!Array.isArray(compactHolidays) || compactHolidays.length === 0) return {};
      const map = {};
      for (let ymd = rangeStartYmd; ymd <= rangeEndYmd;) {
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
      studentId: student.studentId, // Include studentId for filtering in multi-instance broadcasting
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
          `Skipping empty lessons warning: "${activeHoliday.longName || activeHoliday.name}" (today=${todayYmd})`
        );
      }

      // Attach warnings to payload for caller to merge
      payload._warnings = Array.from(new Set(warnings));

      // Optional: write debug dumps of the payload delivered to the frontend.
      // Enable by setting `dumpBackendPayloads: true` in the module config.
      try {
        if (this.config && this.config.dumpBackendPayloads) {
          const dumpDir = path.join(__dirname, 'debug_dumps');
          if (!fs.existsSync(dumpDir)) fs.mkdirSync(dumpDir, { recursive: true });
          const safeTitle = (student && student.title ? student.title : 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
          const fname = `${Date.now()}_${safeTitle}_api.json`;
          const target = path.join(dumpDir, fname);
          fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8');
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
    } catch (err) {
      this._mmLog('error', student, `Failed to prepare payload for ${identifier}: ${this._formatErr(err)}`);
      return null;
    }
    return payload;
  },
});
