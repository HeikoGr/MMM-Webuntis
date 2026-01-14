/* eslint-disable n/no-missing-require */
const NodeHelper = require('node_helper');
const Log = require('logger');
/* eslint-enable n/no-missing-require */
const fs = require('fs');
const path = require('path');
const fetchClient = require('./lib/fetchClient');

// New utility modules for refactoring
const { compactArray } = require('./lib/payloadCompactor');
const { validateConfig, applyLegacyMappings, generateDeprecationWarnings } = require('./lib/configValidator');
const { createBackendLogger } = require('./lib/logger');
const webuntisApiService = require('./lib/webuntisApiService');
const AuthService = require('./lib/authService');
const {
  calculateFetchRanges,
  mapRestStatusToLegacyCode,
  sanitizeHtmlText,
  normalizeDateToInteger,
  normalizeTimeToMinutes,
} = require('./lib/dataOrchestration');
const CacheManager = require('./lib/cacheManager');
const errorHandler = require('./lib/errorHandler');
const widgetConfigValidator = require('./lib/widgetConfigValidator');

// Refactored modules for fetchData simplification (CRIT-1 from ISSUES.md)
const { orchestrateFetch } = require('./lib/dataFetchOrchestrator');
const { buildGotDataPayload } = require('./lib/payloadBuilder');

/**
 * ERROR HANDLING STRATEGY:
 *
 * node_helper.js uses try/catch blocks selectively for specific patterns:
 *
 * 1. CLEANUP PATTERNS (try/finally):
 *    - Lines ~1490-1506: Pending fetch cleanup via _pendingFetchByCredKey
 *    - Ensures proper state management even if errors occur
 *    - Correctly uses try/finally (not try/catch) for guaranteed cleanup
 *
 * 2. GRACEFUL DEGRADATION (try/catch with logging):
 *    - Lines ~99-130: Config processing & JSON.stringify (non-critical)
 *    - Lines ~193-220: Debug dump cleanup (low-priority file ops)
 *    - Lines ~1030-1050: Data extraction with optional fallback
 *    - Errors logged but don't block main flow
 *    - Appropriate because these are non-blocking operations
 *
 * 3. API ERROR HANDLING (already wrapped via dataFetchOrchestrator):
 *    - Lines ~345-376: REST API calls
 *    - Lines ~603-839: Auto-discovery logic
 *    - Lines ~1262-1275: processGroup() orchestration
 *    - These are called from orchestrateFetch() which uses wrapAsync()
 *    - Error collection/warnings handled at higher level via errorUtils
 *    - No need to refactor inner try/catch (already wrapped)
 *
 * Decision: Keep existing try/catch patterns as-is because:
 * - Cleanup code requires try/finally (not errorUtils pattern)
 * - Non-critical ops appropriately use silent error handling
 * - API calls already wrapped by higher-level orchestrator (wrapAsync)
 * - Massive refactoring would increase risk for minimal gain
 */

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

    // Store libLogger for later use when creating per-instance AuthService
    this._libLogger = libLogger;
    // AuthService instances per module identifier to prevent cache cross-contamination
    this._authServicesByIdentifier = new Map();
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
    this._pendingFetchByCredKey = new Map(); // Track pending fetches to avoid duplicates
    // Track which identifiers have completed student auto-discovery
    this._studentsDiscovered = {};
  },

  /**
   * Get or create AuthService instance for a specific module identifier
   * Each module instance gets its own AuthService to prevent cache cross-contamination
   * @param {string} identifier - Module instance identifier
   * @returns {AuthService} AuthService instance for this identifier
   */
  _getAuthServiceForIdentifier(identifier) {
    if (!this._authServicesByIdentifier.has(identifier)) {
      this._mmLog('debug', null, `Creating new AuthService instance for identifier=${identifier}`);
      this._authServicesByIdentifier.set(identifier, new AuthService({ logger: this._libLogger }));
    }
    return this._authServicesByIdentifier.get(identifier);
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
   * Map REST API status to legacy JSON-RPC code format
   */
  _mapRestStatusToLegacyCode(status, substitutionText) {
    return mapRestStatusToLegacyCode(status, substitutionText);
  },

  /**
   * Cleanup old debug dumps, keeping only the N most recent files
   * @param {string} dumpDir - Directory containing debug dump files
   * @param {number} keepCount - Number of most recent files to keep
   */
  _cleanupOldDebugDumps(dumpDir, keepCount = 10) {
    try {
      const files = fs
        .readdirSync(dumpDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({
          name: f,
          path: path.join(dumpDir, f),
          mtime: fs.statSync(path.join(dumpDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      // Delete files beyond keepCount
      if (files.length > keepCount) {
        files.slice(keepCount).forEach((f) => {
          try {
            fs.unlinkSync(f.path);
          } catch {
            // Ignore deletion errors
          }
        });
      }
    } catch {
      // Ignore cleanup errors (directory might not exist yet)
    }
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

    // Get AuthService from options (set in fetchData)
    const authService = options.authService;
    if (!authService) {
      throw new Error('AuthService not available in restOptions');
    }

    const { token, cookieString, tenantId, schoolYearId } = await authService.getAuth({
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

    this.cacheManager.set('classId', cacheKey, chosen.id, 24 * 60 * 60 * 1000); // TTL: 24 hours
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

    // Get AuthService from options (set in fetchData)
    const authService = options.authService;
    if (!authService) {
      throw new Error('AuthService not available in restOptions');
    }

    return webuntisApiService.getTimetable({
      getAuth: () =>
        authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      useClassTimetable: wantsClass,
      classId,
      logger: this._mmLog.bind(this),
      mapStatusToCode: this._mapRestStatusToLegacyCode.bind(this),
      debugApi: options.debugApi || false,
    });
  },

  async _getExamsViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    // Get AuthService from options (set in fetchData)
    const authService = options.authService;
    if (!authService) {
      throw new Error('AuthService not available in restOptions');
    }

    return webuntisApiService.getExams({
      getAuth: () =>
        authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      normalizeDate: this._normalizeDateToInteger.bind(this),
      normalizeTime: this._normalizeTimeToMinutes.bind(this),
      sanitizeHtml: this._sanitizeHtmlText.bind(this),
      debugApi: options.debugApi || false,
    });
  },

  async _getHomeworkViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    // Get AuthService from options (set in fetchData)
    const authService = options.authService;
    if (!authService) {
      throw new Error('AuthService not available in restOptions');
    }

    return webuntisApiService.getHomework({
      getAuth: () =>
        authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      debugApi: options.debugApi || false,
    });
  },

  async _getAbsencesViaRest(school, username, password, server, rangeStart, rangeEnd, studentId, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    // Get AuthService from options (set in fetchData)
    const authService = options.authService;
    if (!authService) {
      throw new Error('AuthService not available in restOptions');
    }

    return webuntisApiService.getAbsences({
      getAuth: () =>
        authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => authService.invalidateCache(cacheKey),
      server,
      rangeStart,
      rangeEnd,
      studentId,
      logger: this._mmLog.bind(this),
      debugApi: options.debugApi || false,
    });
  },

  async _getMessagesOfDayViaRest(school, username, password, server, date, options = {}) {
    const authOptions = this._getStandardAuthOptions(options);
    const cacheKey = authOptions.cacheKey || `user:${username}@${server}/${school}`;
    authOptions.cacheKey = cacheKey; // Ensure cacheKey is explicitly set

    // Get AuthService from options (set in fetchData)
    const authService = options.authService;
    if (!authService) {
      throw new Error('AuthService not available in restOptions');
    }

    return webuntisApiService.getMessagesOfDay({
      getAuth: () =>
        authService.getAuth({
          school,
          username,
          password,
          server,
          options: authOptions,
        }),
      onAuthError: () => authService.invalidateCache(cacheKey),
      server,
      date,
      logger: this._mmLog.bind(this),
      debugApi: options.debugApi || false,
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
          const { appData } = await moduleConfig._authService.getAuth({
            school: moduleConfig.school,
            username: moduleConfig.username,
            password: moduleConfig.password,
            server,
            options: this._getStandardAuthOptions(),
          });
          autoStudents = moduleConfig._authService.deriveStudentsFromAppData(appData);

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
              // If there's exactly one match, auto-assign it for convenience
              if ((!configStudent.studentId || configStudent.studentId === '') && configStudent.title) {
                const titleLower = String(configStudent.title).toLowerCase();
                const matched = autoStudents.filter((a) => (a.title || '').toLowerCase().includes(titleLower));
                const candidateIds = (matched.length > 0 ? matched : autoStudents).map((s) => Number(s.studentId));

                if (candidateIds.length === 1) {
                  // Auto-assign the only match
                  configStudent.studentId = candidateIds[0];
                  configStudent._autoDiscovered = true;
                  // Remove own credentials that might have been inherited from module config
                  // to ensure parent-mode authentication is used
                  delete configStudent.username;
                  delete configStudent.password;
                  delete configStudent.school;
                  delete configStudent.server;
                  const msg = `Auto-assigned studentId=${candidateIds[0]} for "${configStudent.title}" (only match found)`;
                  this._mmLog('debug', configStudent, msg);
                } else {
                  // Multiple or no matches - show warning
                  const msg = `Student with title "${configStudent.title}" has no studentId configured. Possible studentIds: ${candidateIds.join(', ')}.`;
                  configStudent.__warnings = configStudent.__warnings || [];
                  configStudent.__warnings.push(msg);
                  this._mmLog('warn', configStudent, msg);
                }
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

        // Merge module-level defaults into configured students
        // This ensures every student has all config fields (displayMode, nextDays, etc.)
        // so fetchData() doesn't need to fall back to module-level config
        if (!moduleConfig._moduleDefaultsMerged) {
          const defNoStudents = { ...(moduleConfig || {}) };
          delete defNoStudents.students;
          // Don't copy parent credentials into student configs to avoid confusion in _createAuthSession
          delete defNoStudents.username;
          delete defNoStudents.password;
          delete defNoStudents.school;
          delete defNoStudents.server;

          const allStudents = Array.isArray(moduleConfig.students) ? moduleConfig.students : [];
          const mergedStudents = allStudents.map((s) => {
            // Apply legacy mappings to student config (converts old keys to new structure)
            const { normalizedConfig: normalizedStudent } = applyLegacyMappings(s || {}, {
              warnCallback: (msg) => this._mmLog('warn', null, msg),
            });
            // Merge with module defaults, preserving nested objects like grid, homework, absences
            // Start with defaults, then layer in student-specific overrides
            const merged = {
              ...defNoStudents,
              ...normalizedStudent,
              // Preserve nested grid config from defaults if not overridden
              grid: { ...defNoStudents.grid, ...normalizedStudent.grid },
              // Preserve nested homework config from defaults if not overridden
              homework: {
                ...defNoStudents.homework,
                ...normalizedStudent.homework,
              },
              // Preserve nested absences config from defaults if not overridden
              absences: {
                ...defNoStudents.absences,
                ...normalizedStudent.absences,
              },
              // Preserve nested exams config from defaults if not overridden
              exams: { ...defNoStudents.exams, ...normalizedStudent.exams },
            };
            // Ensure displayMode is lowercase
            if (typeof merged.displayMode === 'string') {
              merged.displayMode = merged.displayMode.toLowerCase();
            }
            return merged;
          });

          moduleConfig.students = mergedStudents;
          moduleConfig._moduleDefaultsMerged = true;
          this._mmLog('debug', null, `✓ Module defaults merged into ${mergedStudents.length} configured student(s)`);
        }
        return;
      }

      // Auto-discover students from app/data (when no students manually configured)
      const server = moduleConfig.server || 'webuntis.com';
      const { appData } = await moduleConfig._authService.getAuth({
        school: moduleConfig.school,
        username: moduleConfig.username,
        password: moduleConfig.password,
        server,
        options: this._getStandardAuthOptions({ cacheKey: `parent:${moduleConfig.username}@${server}` }),
      });
      autoStudents = moduleConfig._authService.deriveStudentsFromAppData(appData);

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
          // Apply legacy mappings to auto-discovered student (if any legacy keys present)
          const { normalizedConfig: normalizedStudent } = applyLegacyMappings(
            { ...s, _autoDiscovered: true },
            {
              warnCallback: (msg) => this._mmLog('warn', null, msg),
            }
          );
          // Merge with module defaults, preserving nested objects like grid, homework, absences
          // Start with defaults, then layer in student-specific overrides
          const merged = {
            ...defNoStudents,
            ...normalizedStudent,
            // Preserve nested grid config from defaults if not overridden
            grid: { ...defNoStudents.grid, ...normalizedStudent.grid },
            // Preserve nested homework config from defaults if not overridden
            homework: {
              ...defNoStudents.homework,
              ...normalizedStudent.homework,
            },
            // Preserve nested absences config from defaults if not overridden
            absences: {
              ...defNoStudents.absences,
              ...normalizedStudent.absences,
            },
            // Preserve nested exams config from defaults if not overridden
            exams: { ...defNoStudents.exams, ...normalizedStudent.exams },
          };
          // Ensure displayMode is lowercase
          if (typeof merged.displayMode === 'string') {
            merged.displayMode = merged.displayMode.toLowerCase();
          }
          return merged;
        });

        moduleConfig.students = normalizedAutoStudents;
        moduleConfig._autoStudentsAssigned = true;
        moduleConfig._moduleDefaultsMerged = true; // Also mark that defaults have been merged

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
   * @param {string} cacheKeyOverride - Optional explicit cache key (ensures alignment with credKey)
   * @returns {Promise<Object>} Session object with { school, server, personId, cookies, token, tenantId, schoolYearId }
   */
  async _createAuthSession(sample, moduleConfig, identifier, cacheKeyOverride = null) {
    const hasStudentId = sample.studentId && Number.isFinite(Number(sample.studentId));
    const useQrLogin = Boolean(sample.qrcode);
    const hasOwnCredentials = sample.username && sample.password && sample.school && sample.server;
    const hasParentCredentials = moduleConfig && moduleConfig.username && moduleConfig.password && moduleConfig.school;
    const isParentMode = hasStudentId && !hasOwnCredentials && !useQrLogin && hasParentCredentials;

    // Get identifier-specific AuthService to prevent cache cross-contamination
    const authService = this._getAuthServiceForIdentifier(identifier);

    // Mode 0: QR Code Login (student)
    if (useQrLogin) {
      this._mmLog('debug', sample, 'Getting QR code authentication (cached or new)');
      const cacheKey = cacheKeyOverride || `qrcode:${sample.qrcode}`;
      const authResult = await authService.getAuthFromQRCode(sample.qrcode, {
        cacheKey,
      });
      return {
        school: authResult.school,
        server: authResult.server,
        personId: authResult.personId,
        cookieString: authResult.cookieString, // Changed 'cookies' to 'cookieString'
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData || null, // May be undefined if from cache
        mode: 'qr',
        qrCodeUrl: sample.qrcode, // Store QR code URL for re-authentication
      };
    }

    // Mode 1: Parent Account (studentId + parent credentials from moduleConfig)
    if (isParentMode) {
      const school = sample.school || moduleConfig.school;
      const server = sample.server || moduleConfig.server || 'webuntis.com';
      const cacheKey = cacheKeyOverride || `parent:${moduleConfig.username}@${server}/${school}`;
      this._mmLog('debug', sample, `Authenticating with parent account (school=${school}, server=${server})`);
      const authResult = await authService.getAuth({
        school,
        username: moduleConfig.username,
        password: moduleConfig.password,
        server,
        options: { cacheKey },
      });
      return {
        school,
        server,
        personId: authResult.personId, // Parent's personId (used for auto-discovery)
        cookieString: authResult.cookieString, // Changed from 'cookies' to 'cookieString'
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData || null, // May be undefined if from cache
        mode: 'parent',
      };
    }

    // Mode 2: Direct Student Login (own credentials)
    if (hasOwnCredentials) {
      this._mmLog('debug', sample, `Authenticating with direct login (school=${sample.school}, server=${sample.server})`);
      const cacheKey = cacheKeyOverride || `direct:${sample.username}@${sample.server}`;
      const authResult = await authService.getAuth({
        school: sample.school,
        username: sample.username,
        password: sample.password,
        server: sample.server,
        options: { cacheKey },
      });
      return {
        school: sample.school,
        server: sample.server,
        personId: authResult.personId,
        cookieString: authResult.cookieString, // Changed from 'cookies' to 'cookieString'
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData || null, // May be undefined if from cache
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
   * Sanitize HTML text
   */
  _sanitizeHtmlText(text, preserveLineBreaks = true) {
    return sanitizeHtmlText(text, preserveLineBreaks);
  },

  /**
   * Normalize date format
   */
  _normalizeDateToInteger(date) {
    return normalizeDateToInteger(date);
  },

  /**
   * Normalize time format
   */
  _normalizeTimeToMinutes(time) {
    return normalizeTimeToMinutes(time);
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
   * Authentication is cached by authService, so multiple sessions with same credentials
   * will only authenticate once.
   */
  async processGroup(credKey, students, identifier, sessionKey, config) {
    // Single-run processing: authenticate (authService handles caching), fetch data for each student, and logout.
    let authSession = null;
    const sample = students[0];
    const groupWarnings = [];
    // Per-fetch-cycle warning deduplication set. Ensures identical warnings
    // are reported only once per processing run (prevents spam across students).
    this._currentFetchWarnings = new Set();

    try {
      try {
        // Create/get authSession - authService handles caching internally
        // If credentials were recently used, authService will return cached result
        // Use identifier-specific AuthService to prevent cache cross-contamination
        authSession = await this._createAuthSession(sample, config, identifier, credKey);
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
            sessionId: sessionKey.split(':')[1], // Extract sessionId from "identifier:sessionId"
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

      // ===== EXTRACT HOLIDAYS ONCE FOR ALL STUDENTS =====
      // Holidays are shared across all students in the same school/group.
      // Extract and compact them once before processing students to avoid redundant work.
      const wantsGridWidget = this._wantsWidget('grid', config?.displayMode);
      const wantsLessonsWidget = this._wantsWidget('lessons', config?.displayMode);
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
          const payload = await this.fetchData(authSession, student, identifier, credKey, sharedCompactHolidays, config);
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
            school: student.school || config?.school,
            server: student.server || config?.server || 'webuntis.com',
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

      for (const payload of studentPayloads) {
        // Send to ALL module instances, but include both id and sessionId for filtering
        // Frontend filters by sessionId (preferred) or id (fallback) to ensure correct routing
        payload.id = identifier;
        payload.sessionId = sessionKey.split(':')[1]; // Extract sessionId from "identifier:sessionId"
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
   * Listens for `INIT_MODULE` (initialization) and `FETCH_DATA` (data refresh).
   *
   * @param {string} notification - Notification name
   * @param {any} payload - Notification payload
   */
  async socketNotificationReceived(notification, payload) {
    this._mmLog('debug', null, `[socketNotificationReceived] Notification: ${notification}`);

    if (notification === 'INIT_MODULE') {
      await this._handleInitModule(payload);
      return;
    }

    if (notification === 'FETCH_DATA') {
      await this._handleFetchData(payload);
      return;
    }
  },

  /**
   * Handle INIT_MODULE notification - performs one-time module initialization
   * Validates config, sets up authentication, discovers students, and notifies frontend when ready
   *
   * @param {Object} payload - Module configuration from frontend
   */
  async _handleInitModule(payload) {
    this._mmLog('debug', null, '[INIT_MODULE] Initializing module');

    let normalizedConfig;
    let identifier;
    let sessionKey;

    try {
      // Create a deep copy of payload to prevent modifying the original config
      const payloadCopy = JSON.parse(JSON.stringify(payload));

      // Apply legacy mappings to convert old keys to new structure
      const result = applyLegacyMappings(payloadCopy, {
        warnCallback: (msg) => this._mmLog('warn', null, msg),
      });
      normalizedConfig = result.normalizedConfig;
      const legacyUsed = result.legacyUsed;

      identifier = normalizedConfig.id || 'default';
      const sessionId = payload.sessionId || 'unknown';
      sessionKey = `${identifier}:${sessionId}`;

      // Store config per session for isolation
      this._configsBySession.set(sessionKey, normalizedConfig);
      this._mmLog('debug', null, `[INIT_MODULE] Config stored for session=${sessionKey}`);

      // Persist debugDate for this session
      if (normalizedConfig.debugDate) {
        this._persistedDebugDate = normalizedConfig.debugDate;
        this._mmLog('debug', null, `[INIT_MODULE] Received debugDate="${normalizedConfig.debugDate}"`);
      }

      // Ensure displayMode is lowercase
      if (typeof normalizedConfig.displayMode === 'string') {
        normalizedConfig.displayMode = normalizedConfig.displayMode.toLowerCase();
      }

      // Validate configuration
      const validatorLogger = this.logger || { log: (level, msg) => this._mmLog(level, null, msg) };
      const { valid, errors, warnings } = validateConfig(normalizedConfig, validatorLogger);

      // Generate detailed deprecation warnings
      const detailedWarnings = legacyUsed && legacyUsed.length > 0 ? generateDeprecationWarnings(legacyUsed) : [];
      const combinedWarnings = [...(warnings || []), ...detailedWarnings];

      if (!valid) {
        this._mmLog('error', null, `[INIT_MODULE] Config validation failed for ${identifier}`);
        this.sendSocketNotification('INIT_ERROR', {
          id: identifier,
          errors,
          warnings: combinedWarnings,
          severity: 'ERROR',
          message: 'Configuration validation failed',
        });
        return;
      }

      // Store validated config per identifier
      this._configsByIdentifier.set(identifier, normalizedConfig);
      this.config = normalizedConfig;

      // Get or create AuthService for this identifier
      normalizedConfig._authService = this._getAuthServiceForIdentifier(identifier);

      // Auto-discover students if needed (one-time during init)
      this._mmLog('debug', null, `[INIT_MODULE] Auto-discovering students for ${identifier}`);
      await this._ensureStudentsFromAppData(normalizedConfig);

      // Mark students as discovered for this identifier
      this._studentsDiscovered = this._studentsDiscovered || {};
      this._studentsDiscovered[identifier] = true;

      this._mmLog('debug', null, `[INIT_MODULE] Module ${identifier} initialized successfully`);

      // Send success notification to frontend
      this.sendSocketNotification('MODULE_INITIALIZED', {
        id: identifier,
        config: normalizedConfig,
        warnings: combinedWarnings,
        students: normalizedConfig.students || [],
      });
    } catch (error) {
      this._mmLog('error', null, `[INIT_MODULE] Initialization failed: ${this._formatErr(error)}`);
      this.sendSocketNotification('INIT_ERROR', {
        id: identifier || 'unknown',
        errors: [error.message || 'Unknown initialization error'],
        warnings: [],
        severity: 'ERROR',
        message: 'Module initialization failed',
      });
    }
  },

  /**
   * Handle FETCH_DATA notification - performs data refresh for already initialized module
   * Uses cached config and authentication, only fetches fresh data from WebUntis
   *
   * @param {Object} payload - Fetch request from frontend
  /**
   * Handle FETCH_DATA notification - performs data refresh for already initialized module
   * Uses cached config and authentication, only fetches fresh data from WebUntis
   *
   * @param {Object} payload - Fetch request from frontend
   */
  async _handleFetchData(payload) {
    this._mmLog('debug', null, '[FETCH_DATA] Handling data fetch request');

    const identifier = payload.id || 'default';
    const sessionId = payload.sessionId || 'unknown';
    const sessionKey = `${identifier}:${sessionId}`;

    // Verify module is initialized
    if (!this._configsByIdentifier.has(identifier)) {
      this._mmLog('warn', null, `[FETCH_DATA] Module ${identifier} not initialized - ignoring fetch request`);
      return;
    }

    // Get the initialized config
    let normalizedConfig = this._configsByIdentifier.get(identifier);

    // Update session-specific config if provided (e.g., debugDate changes)
    if (payload.debugDate !== undefined) {
      normalizedConfig = { ...normalizedConfig, debugDate: payload.debugDate };
      this._configsBySession.set(sessionKey, normalizedConfig);
      this._configsByIdentifier.set(identifier, normalizedConfig);
      if (payload.debugDate) {
        this._persistedDebugDate = payload.debugDate;
        this._mmLog('debug', null, `[FETCH_DATA] Updated debugDate="${payload.debugDate}"`);
      }
    }

    // Execute fetch immediately
    await this._executeFetchForSession(sessionKey);
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

    // Extract identifier from sessionKey (format: identifier:sessionId)
    const sessionIdentifier = sessionKey.split(':')[0];

    // Get AuthService reference (already initialized during INIT_MODULE)
    config._authService = this._getAuthServiceForIdentifier(sessionIdentifier);

    try {
      // Note: Auto-discovery and config validation already done during INIT_MODULE
      // This is pure data fetch - config is already normalized and students are discovered

      // Group students by credential so we can reuse the same untis session
      const groups = new Map();

      // Group students by credential. Normalize each student config for legacy key compatibility.
      const studentsList = Array.isArray(config.students) ? config.students : [];
      for (const student of studentsList) {
        // Apply legacy config mapping to student-level config
        const { normalizedConfig: normalizedStudent } = applyLegacyMappings(student);
        const credKey = this._getCredentialKey(normalizedStudent, config, sessionIdentifier);
        if (!groups.has(credKey)) groups.set(credKey, []);
        groups.get(credKey).push(normalizedStudent);
      }

      // Process each credential group for this session
      // authService handles caching of authentication, so we don't need to cache authSession here
      for (const [credKey, students] of groups.entries()) {
        // Check if another session is already fetching this credKey
        if (this._pendingFetchByCredKey.has(credKey)) {
          this._mmLog('debug', null, `Session ${sessionKey}: Another session is fetching credKey=${credKey}, waiting...`);
          // Wait for the other session to complete (its cache will be available to us too)
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        // Mark as processing
        this._pendingFetchByCredKey.set(credKey, true);

        try {
          // Process this session's data
          // authService.getAuth() will use its internal cache for subsequent calls with same cacheKey
          const sessionIdentifier = sessionKey.split(':')[0];
          await this.processGroup(credKey, students, sessionIdentifier, sessionKey, config);
        } finally {
          // Remove from pending after completion
          this._pendingFetchByCredKey.delete(credKey);
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
  _getCredentialKey(student, moduleConfig, identifier = 'default') {
    const scope = moduleConfig?.carouselId || identifier || 'default';
    const scopePrefix = scope ? `${scope}::` : '';
    const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
    const hasOwnCredentials = student.qrcode || (student.username && student.password && student.school && student.server);
    const isParentMode = hasStudentId && !hasOwnCredentials;

    // Parent account mode: group by module-level parent credentials
    if (isParentMode && moduleConfig) {
      return `${scopePrefix}parent:${moduleConfig.username || 'undefined'}@${moduleConfig.server || 'webuntis.com'}/${moduleConfig.school || 'undefined'}`;
    }

    // Direct student login: group by student credentials
    if (student.qrcode) return `${scopePrefix}qrcode:${student.qrcode}`;
    const server = student.server || 'default';
    return `${scopePrefix}user:${student.username}@${server}/${student.school}`;
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
   * Main fetch function that orchestrates data fetching for a student.
   * This is the simplified version that delegates to specialized modules:
   * - lib/dateRangeCalculator.js: calculates date ranges for all data types
   * - lib/dataFetchOrchestrator.js: fetches all data in parallel using Promise.all (2.7x speedup)
   * - lib/payloadBuilder.js: builds the GOT_DATA payload with compacting and warnings
   *
   * @param {Object} authSession - Authenticated session with server, school, cookies, token
   * @param {Object} student - Student config object
   * @param {string} identifier - Module instance identifier
   * @param {string} credKey - Credential grouping key
   * @param {Array} compactHolidays - Pre-extracted and compacted holidays (shared across students in group)
   * @param {Object} config - Module configuration
   */
  async fetchData(authSession, student, identifier, credKey, compactHolidays = [], config) {
    const logger = (msg) => {
      this._mmLog('debug', student, msg);
    };

    const restOptions = { cacheKey: credKey, authSession };
    if (authSession.qrCodeUrl) {
      restOptions.qrCodeUrl = authSession.qrCodeUrl;
    }
    restOptions.authService = config._authService;

    const { school, server } = authSession;
    const ownPersonId = authSession.personId;
    const bearerToken = authSession.token;
    const appData = authSession.appData;
    const authService = config._authService;
    const restTargets = authService.buildRestTargets(student, config, school, server, ownPersonId, bearerToken, appData);

    const describeTarget = (t) => {
      if (t.mode === 'qr') {
        return `QR login${t.studentId ? ` (id=${t.studentId})` : ''}`;
      }
      return `parent (parentId=${ownPersonId}, childId=${t.studentId})`;
    };

    const className = student.class || student.className || null;
    const effectiveDisplayMode = student.displayMode || config.displayMode;

    const wantsGridWidget = this._wantsWidget('grid', effectiveDisplayMode);
    const wantsLessonsWidget = this._wantsWidget('lessons', effectiveDisplayMode);
    const wantsExamsWidget = this._wantsWidget('exams', effectiveDisplayMode);
    const wantsHomeworkWidget = this._wantsWidget('homework', effectiveDisplayMode);
    const wantsAbsencesWidget = this._wantsWidget('absences', effectiveDisplayMode);
    const wantsMessagesOfDayWidget = this._wantsWidget('messagesofday', effectiveDisplayMode);

    const fetchTimegrid = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchTimetable = Boolean(wantsGridWidget || wantsLessonsWidget);
    const fetchExams = Boolean(wantsGridWidget || wantsExamsWidget);
    const fetchHomeworks = Boolean(wantsGridWidget || wantsHomeworkWidget);
    const fetchAbsences = Boolean(wantsGridWidget || wantsAbsencesWidget);
    const fetchMessagesOfDay = Boolean(wantsMessagesOfDayWidget);
    const fetchHolidays = Boolean(wantsGridWidget || wantsLessonsWidget);

    // Calculate base date (with optional debugDate support)
    const baseNow = function () {
      try {
        const dbg = (typeof config?.debugDate === 'string' && this.config.debugDate) || null;
        if (dbg) {
          const s = String(dbg).trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T00:00:00');
          if (/^\d{8}$/.test(s)) return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00`);
        }
      } catch {
        // fall through to real now
      }
      // Use local timezone date (important for schools in non-UTC timezones)
      // This ensures date calculations match the school's local day
      const now = new Date(Date.now());
      const localDate = new Date(now.toLocaleString('en-US', { timeZone: config.timezone || 'Europe/Berlin' }));
      return localDate;
    }.call(this);

    const todayYmd = baseNow.getFullYear() * 10000 + (baseNow.getMonth() + 1) * 100 + baseNow.getDate();

    // ===== STEP 1: Calculate date ranges using dateRangeCalculator module =====
    const dateRanges = calculateFetchRanges(student, config, baseNow, wantsGridWidget, fetchExams, fetchAbsences, logger);
    logger(
      `Computed timetable range params: base=${baseNow.toISOString().split('T')[0]}, pastDays=${dateRanges.timetable.pastDays}, nextDays=${dateRanges.timetable.nextDays}`
    );

    // Get Timegrid from appData if available
    let grid = [];
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

    // ===== STEP 2: Fetch all data in parallel using dataFetchOrchestrator module =====
    const fetchResults = await orchestrateFetch({
      student,
      dateRanges,
      baseNow,
      restTargets,
      restOptions,
      fetchFlags: {
        fetchTimetable,
        fetchExams,
        fetchHomeworks,
        fetchAbsences,
        fetchMessagesOfDay,
      },
      callRest: this._callRest.bind(this),
      getTimetableViaRest: this._getTimetableViaRest.bind(this),
      getExamsViaRest: this._getExamsViaRest.bind(this),
      getHomeworkViaRest: this._getHomeworkViaRest.bind(this),
      getAbsencesViaRest: this._getAbsencesViaRest.bind(this),
      getMessagesOfDayViaRest: this._getMessagesOfDayViaRest.bind(this),
      logger,
      describeTarget,
      className,
      currentFetchWarnings: this._currentFetchWarnings,
    });

    const timetable = fetchResults.timetable;
    const rawExams = fetchResults.exams;
    const hwResult = fetchResults.homeworks;
    const rawAbsences = fetchResults.absences;
    const rawMessagesOfDay = fetchResults.messagesOfDay;

    // Extract timegrid from timetable data if not available from appData
    if (fetchTimegrid && grid.length === 0 && timetable.length > 0) {
      grid = this._extractTimegridFromTimetable(timetable);
      logger(`✓ Timegrid: extracted ${grid.length} time slots from timetable (fallback)\n`);
    }

    // Log holiday status
    if (fetchHolidays && compactHolidays.length > 0) {
      logger(`Holidays: using ${compactHolidays.length} pre-extracted periods`);
    } else if (fetchHolidays) {
      logger(`Holidays: no data available`);
    } else {
      logger(`Holidays: skipped`);
    }

    // Find active holiday for today
    const findHolidayForDate = (ymd, holidays) => {
      if (!Array.isArray(holidays) || holidays.length === 0) return null;
      const dateNum = Number(ymd);
      return holidays.find((h) => Number(h.startDate) <= dateNum && dateNum <= Number(h.endDate)) || null;
    };
    const activeHoliday = findHolidayForDate(todayYmd, compactHolidays);

    // ===== STEP 3: Build payload using payloadBuilder module =====
    try {
      const payload = buildGotDataPayload({
        student,
        grid,
        timetable,
        rawExams,
        hwResult,
        rawAbsences,
        rawMessagesOfDay,
        compactHolidays,
        fetchHomeworks,
        fetchAbsences,
        fetchMessagesOfDay,
        dateRanges,
        todayYmd,
        fetchTimetable,
        activeHoliday,
        moduleConfig: config,
        currentFetchWarnings: this._currentFetchWarnings,
        compactTimegrid: this._compactTimegrid.bind(this),
        checkEmptyDataWarning: this._checkEmptyDataWarning.bind(this),
        mmLog: this._mmLog.bind(this),
        cleanupOldDebugDumps: this._cleanupOldDebugDumps.bind(this),
      });
      return payload;
    } catch (err) {
      this._mmLog('error', student, `Failed to prepare payload for ${identifier}: ${this._formatErr(err)}`);
      return null;
    }
  },
});
