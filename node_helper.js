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

    // API Status tracking - maps endpoint to last HTTP status code
    this._apiStatusBySession = new Map(); // sessionKey -> { timetable: 200, exams: 403, ... }
    // Initialize CacheManager for class ID and other caching
    this.cacheManager = new CacheManager(this._mmLog.bind(this));
    // expose payload compactor so linters don't flag unused imports until full refactor
    this.payloadCompactor = { compactArray };
    // Track whether config warnings have been emitted to frontend to avoid repeat spam
    this._configWarningsSent = false;
    // Multi-instance support: store config per identifier
    this._configsByIdentifier = new Map();
    // Session-based config isolation: each browser window keeps its own config
    // debugDate is now stored session-specifically in _configsBySession, not globally
    this._configsBySession = new Map();
    this._pendingFetchByCredKey = new Map(); // Track pending fetches to avoid duplicates
    // Track which identifiers have completed student auto-discovery
    this._studentsDiscovered = {};
  },

  /**
   * Check if an API endpoint should be skipped based on previous HTTP status
   * Skips only on permanent errors (403, 404, 410), not on temporary errors (5xx)
   * @param {string} sessionKey - Session key
   * @param {string} endpoint - API endpoint name (timetable, exams, homework, absences, messagesOfDay)
   * @returns {boolean} True if API should be skipped
   */
  _shouldSkipApi(sessionKey, endpoint) {
    if (!this._apiStatusBySession.has(sessionKey)) return false;
    const status = this._apiStatusBySession.get(sessionKey)[endpoint];
    if (!status) return false;

    // Permanent errors - skip API calls for these
    // 403 Forbidden - user has no permission for this endpoint
    // 404 Not Found - endpoint doesn't exist
    // 410 Gone - resource permanently removed
    const permanentErrors = [403, 404, 410];

    // Do NOT skip on temporary errors:
    // - 5xx errors (500, 502, 503, 504) are temporary server errors
    // - 401 is handled by auth refresh mechanism
    // - 429 rate limiting is temporary
    return permanentErrors.includes(status);
  },

  /**
   * Record API status from an error response so frontend can detect failures.
   * @param {string} sessionKey - Session key
   * @param {string} endpoint - API endpoint name
   * @param {Error} err - Error object
   */
  _recordApiStatusFromError(sessionKey, endpoint, err) {
    if (!sessionKey) return;
    const rawStatus = err?.status || err?.response?.status;
    const msg = typeof err?.message === 'string' ? err.message : '';
    const match = msg.match(/\b(4\d\d|5\d\d)\b/);
    const parsed = rawStatus || (match ? Number(match[1]) : null);
    const status = Number.isFinite(Number(parsed)) ? Number(parsed) : 0;

    if (!this._apiStatusBySession.has(sessionKey)) {
      this._apiStatusBySession.set(sessionKey, {});
    }
    this._apiStatusBySession.get(sessionKey)[endpoint] = status;
  },

  /**
   * Get or create AuthService instance for a specific module identifier
   * Each module instance gets its own AuthService to prevent cache cross-contamination
   * @param {string} identifier - Module instance identifier
   * @returns {AuthService} AuthService instance for this identifier
   */
  _getAuthServiceForIdentifier(identifier) {
    if (!this._authServicesByIdentifier.has(identifier)) {
      // Creating AuthService silently
      this._authServicesByIdentifier.set(identifier, new AuthService({ logger: this._libLogger }));
    }
    return this._authServicesByIdentifier.get(identifier);
  },

  /**
   * Normalize legacy configuration keys to modern format
   * Applies 25+ legacy config key mappings from configValidator module
   * Also generates deprecation warnings for outdated keys
   *
   * @param {Object} cfg - Raw configuration object (may contain legacy keys)
   * @returns {Object} Normalized config with modern keys
   */
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
   * Keeps call sites concise and consistent by wrapping context objects.
   *
   * @param {Function} fn - REST API function to call (e.g., _getTimetableViaRest)
   * @param {Object} authCtx - Authentication context (authService, credentials, cacheKey)
   * @param {Object} sessionCtx - Session context (sessionKey, authRefreshTracker)
   * @param {Object} logCtx - Logging context (logger, mmLog, formatErr)
   * @param {Object} flagsCtx - Debug flags (debugApi, dumpRawApiResponses)
   * @param {...any} args - Additional arguments to pass to the function
   * @returns {Promise<any>} Result from the REST API function
   */
  async _callRest(fn, authCtx, sessionCtx, logCtx, flagsCtx, ...args) {
    return fn.call(this, authCtx, sessionCtx, logCtx, flagsCtx, ...args);
  },

  // ---------------------------------------------------------------------------
  // Logging and error helpers
  // ---------------------------------------------------------------------------

  /**
   * Internal logging function that forwards messages to MagicMirror's Log system
   * Automatically adds student name tag if provided
   *
   * @param {string} level - Log level: 'debug', 'info', 'warn', 'error'
   * @param {Object|null} student - Student context object (adds [studentName] tag if present)
   * @param {string} message - Log message to output
   */
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

  /**
   * Format error objects into human-readable strings
   * Delegates to errorHandler module for consistent error formatting
   *
   * @param {Error|any} err - Error object or value to format
   * @returns {string} Formatted error message
   */
  _formatErr(err) {
    return errorHandler.formatError(err);
  },

  /**
   * Map REST API HTTP status codes to legacy JSON-RPC code format
   * This maintains compatibility with legacy error handling code
   *
   * @param {number} status - HTTP status code (e.g., 200, 401, 403, 404, 500)
   * @param {string} substitutionText - Optional text to include in error message
   * @returns {number} Legacy code format for frontend consumption
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
   * Create standard options object for authService calls
   * Provides bound logging and error formatting functions to authService
   * This ensures consistent logging behavior across all auth operations
   *
   * @param {Object} additionalOptions - Additional options to merge (e.g., cacheKey)
   * @returns {Object} Options object with mmLog and formatErr bound to this instance
   */
  _getStandardAuthOptions(additionalOptions = {}) {
    return {
      ...additionalOptions,
      mmLog: this._mmLog.bind(this),
      formatErr: this._formatErr.bind(this),
    };
  },

  /**
   * Collect class candidates from WebUntis API response data
   * Recursively walks through the data structure to find class entries
   * Filters by resourceType='CLASS' to avoid teachers/rooms
   *
   * @param {any} data - API response data (object or array)
   * @returns {Array} Array of class candidates with {id, name, shortName, longName}
   */
  _collectClassCandidates(data) {
    const candidates = new Map(); // id -> candidate

    // Internal function to add a single candidate if it's a valid class entry
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

  /**
   * Resolve class ID from class name using REST API endpoints
   * Tries two strategies:
   *   1. classservices endpoint (when studentId available) - most accurate
   *   2. timetable/filter endpoint - broader search
   * Caches results for 24 hours to avoid repeated API calls
   *
   * @param {Object} authCtx - Authentication context (server, credentials, authService)
   * @param {Object} sessionCtx - Session context (for tracking)
   * @param {Date} rangeStart - Start date for the query range
   * @param {Date} rangeEnd - End date for the query range
   * @param {string} className - Name of the class to search for (e.g., "5a", "10B")
   * @param {Object} options - Additional options (studentId for improved accuracy)
   * @returns {Promise<number>} Resolved class ID
   */
  async _resolveClassIdViaRest(authCtx, sessionCtx, rangeStart, rangeEnd, className, options = {}) {
    const { school, username, password, server, qrCodeUrl, cacheKey, authService } = authCtx || {};
    const desiredName = className && String(className).trim();
    const cacheKeyBase = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;
    // Include studentId in cache key so each student has their own class cache entry
    const studentIdPart = options.studentId ? `::student::${options.studentId}` : '';
    const classCacheKey = `${cacheKeyBase}${studentIdPart}::class::${(desiredName || '').toLowerCase()}`;
    if (this.cacheManager.has('classId', classCacheKey)) {
      return this.cacheManager.get('classId', classCacheKey);
    }

    // Date formatting helpers for API requests
    // ISO format (YYYY-MM-DD) for timetable/filter endpoint
    const formatDateISO = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    // YYYYMMDD format for classservices endpoint
    const formatDateYYYYMMDD = (date) => {
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${year}${month}${day}`;
    };

    // Authenticate using authService (handles caching internally)
    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }
    const authOptions = this._getStandardAuthOptions({ cacheKey: cacheKeyBase });
    const authResult = qrCodeUrl
      ? await authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: cacheKeyBase })
      : await authService.getAuth(
          {
            school,
            username,
            password,
            server,
          },
          authOptions
        );
    const { token, cookieString, tenantId, schoolYearId } = authResult || {};

    if (!cookieString) {
      throw new Error('Missing REST auth cookies for class resolution');
    }

    // Build REST API headers with authentication tokens
    const headers = {
      Cookie: cookieString,
      Accept: 'application/json',
    };
    if (tenantId) headers['Tenant-Id'] = String(tenantId);
    if (schoolYearId) headers['X-Webuntis-Api-School-Year-Id'] = String(schoolYearId);
    if (token) headers.Authorization = `Bearer ${token}`;

    let candidates = [];

    let mappedClassId = null;

    // STRATEGY 1: Try classservices endpoint first (most accurate when studentId is known)
    // This endpoint returns the actual class assignments for the specific student
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
          // This is the authoritative source for student -> class assignment
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

    // STRATEGY 2: Try timetable/filter endpoint if classservices didn't work
    // This is a broader search that returns all classes visible to the authenticated user
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
    // PRIORITY 1: If classservices provided a personKlasseMap, use that mapping first
    if (mappedClassId && candidates.some((c) => Number(c.id) === Number(mappedClassId))) {
      chosen = candidates.find((c) => Number(c.id) === Number(mappedClassId));
      this._mmLog('debug', null, `[REST] personKlasseMap selected classId=${mappedClassId}`);
    }

    // PRIORITY 2: Match by configured class name (case-insensitive)
    if (desiredName) {
      const desiredLower = desiredName.toLowerCase();
      chosen = candidates.find((c) =>
        [c.name, c.shortName, c.longName].filter(Boolean).some((n) => String(n).toLowerCase() === desiredLower)
      );
    }

    // PRIORITY 3: If no class name configured and only one class exists, auto-select it
    if (!chosen && !desiredName && candidates.length === 1) {
      chosen = candidates[0];
      this._mmLog('debug', null, `[REST] No class name configured; using sole available class ${chosen.name} (${chosen.id})`);
    }

    // No match found - provide helpful error message with available classes
    if (!chosen) {
      const available = candidates
        .map((c) => `${c.name || c.shortName || c.longName || c.id}`)
        .filter(Boolean)
        .join(', ');
      const hint = desiredName ? `Class "${desiredName}" not found. Available: ${available}` : `Multiple classes available: ${available}`;
      throw new Error(hint);
    }

    // Cache the resolved class ID for 24 hours to avoid repeated API calls
    this.cacheManager.set('classId', classCacheKey, chosen.id, 24 * 60 * 60 * 1000); // TTL: 24 hours
    return chosen.id;
  },

  /**
   * Get timetable data via REST API using unified restClient
   *
   * Supports both:
   *   - Person timetable (student's personal schedule)
   *   - Class timetable (entire class schedule, requires class ID resolution)
   *
   * Uses API status tracking to skip permanent errors (403, 404, 410).
   *
   * @param {Object} authCtx - Authentication context (authService, credentials, cacheKey)
   * @param {Object} sessionCtx - Session context (sessionKey, authRefreshTracker)
   * @param {Object} logCtx - Logging context (logger, mmLog, formatErr)
   * @param {Object} flagsCtx - Debug flags (debugApi, dumpRawApiResponses)
   * @param {Date} rangeStart - Start date for timetable query
   * @param {Date} rangeEnd - End date for timetable query
   * @param {number} personId - Person ID (student or parent)
   * @param {Object} options - Additional options (classId, className, studentId)
   * @param {boolean} useClassTimetable - Whether to fetch class timetable instead of personal
   * @param {string} className - Class name for resolution (e.g., "5a")
   * @param {string} resourceType - Resource type filter (CLASS, TEACHER, SUBJECT, ROOM)
   * @returns {Promise<Array>} Timetable array with lesson entries
   */
  async _getTimetableViaRest(
    authCtx,
    sessionCtx,
    logCtx,
    flagsCtx,
    rangeStart,
    rangeEnd,
    personId,
    options = {},
    useClassTimetable = false,
    className = null,
    resourceType = null
  ) {
    const { sessionKey, authRefreshTracker } = sessionCtx || {};
    const { debugApi, dumpRawApiResponses } = flagsCtx || {};
    const { authService, qrCodeUrl, cacheKey, school, server, username, password } = authCtx || {};
    const effectiveCacheKey = cacheKey || `user:${username}@${server}/${school}`;
    const mmLog = logCtx?.mmLog || this._mmLog.bind(this);

    // Check if API should be skipped based on previous status
    if (sessionKey && this._shouldSkipApi(sessionKey, 'timetable')) {
      const prevStatus = this._apiStatusBySession.get(sessionKey).timetable;
      mmLog('debug', null, `[timetable] Skipping API call due to previous status ${prevStatus} (permanent error)`);
      return [];
    }

    const wantsClass = Boolean(useClassTimetable || options.useClassTimetable);
    let classId = options.classId;
    // Resolve class ID if needed
    if (wantsClass && !classId) {
      classId = await this._resolveClassIdViaRest(authCtx, sessionCtx, rangeStart, rangeEnd, className || options.className || null, {
        ...options,
        personId,
        studentId: options.studentId || personId,
      });
    }

    const authOptions = this._getStandardAuthOptions({ cacheKey: effectiveCacheKey });

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }

    let response;
    try {
      response = await webuntisApiService.getTimetable({
        getAuth: () =>
          qrCodeUrl
            ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey })
            : authService.getAuth(
                {
                  school,
                  username,
                  password,
                  server,
                },
                authOptions
              ),
        onAuthError: () => {
          if (authRefreshTracker) authRefreshTracker.refreshed = true;
          return authService.invalidateCache(effectiveCacheKey);
        },
        server,
        rangeStart,
        rangeEnd,
        personId,
        useClassTimetable: wantsClass,
        classId,
        resourceType: resourceType || null,
        logger: this._mmLog.bind(this),
        mapStatusToCode: this._mapRestStatusToLegacyCode.bind(this),
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      });
    } catch (err) {
      if (sessionKey) this._recordApiStatusFromError(sessionKey, 'timetable', err);
      throw err;
    }

    // Track API status if sessionKey provided
    if (sessionKey && response.status) {
      if (!this._apiStatusBySession.has(sessionKey)) {
        this._apiStatusBySession.set(sessionKey, {});
      }
      this._apiStatusBySession.get(sessionKey).timetable = response.status;
    }

    return response.data;
  },

  /**
   * Get exams data via REST API
   * Fetches upcoming exams/tests for the specified person and date range
   *
   * Uses API status tracking to skip permanent errors (403, 404, 410).
   *
   * @param {Object} authCtx - Authentication context (authService, credentials, cacheKey)
   * @param {Object} sessionCtx - Session context (sessionKey, authRefreshTracker)
   * @param {Object} logCtx - Logging context (logger, mmLog, formatErr)
   * @param {Object} flagsCtx - Debug flags (debugApi, dumpRawApiResponses)
   * @param {Date} rangeStart - Start date for exams query
   * @param {Date} rangeEnd - End date for exams query
   * @param {number} personId - Person ID (student)
   * @returns {Promise<Array>} Exams array with exam entries
   */
  async _getExamsViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    const { sessionKey, authRefreshTracker } = sessionCtx || {};
    const { debugApi, dumpRawApiResponses } = flagsCtx || {};
    const { authService, qrCodeUrl, cacheKey, school, server, username, password } = authCtx || {};
    const effectiveCacheKey = cacheKey || `user:${username}@${server}/${school}`;
    const mmLog = logCtx?.mmLog || this._mmLog.bind(this);

    // Check if API should be skipped based on previous status
    if (sessionKey && this._shouldSkipApi(sessionKey, 'exams')) {
      const prevStatus = this._apiStatusBySession.get(sessionKey).exams;
      mmLog('debug', null, `[exams] Skipping API call due to previous status ${prevStatus} (permanent error)`);
      return [];
    }

    const authOptions = this._getStandardAuthOptions({ cacheKey: effectiveCacheKey });

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }

    let response;
    try {
      response = await webuntisApiService.getExams({
        getAuth: () =>
          qrCodeUrl
            ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey })
            : authService.getAuth(
                {
                  school,
                  username,
                  password,
                  server,
                },
                authOptions
              ),
        onAuthError: () => {
          if (authRefreshTracker) authRefreshTracker.refreshed = true;
          return authService.invalidateCache(effectiveCacheKey);
        },
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this._mmLog.bind(this),
        normalizeDate: this._normalizeDateToInteger.bind(this),
        normalizeTime: this._normalizeTimeToMinutes.bind(this),
        sanitizeHtml: this._sanitizeHtmlText.bind(this),
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      });
    } catch (err) {
      if (sessionKey) this._recordApiStatusFromError(sessionKey, 'exams', err);
      throw err;
    }

    // Track API status
    if (sessionKey && response.status) {
      if (!this._apiStatusBySession.has(sessionKey)) {
        this._apiStatusBySession.set(sessionKey, {});
      }
      this._apiStatusBySession.get(sessionKey).exams = response.status;
    }

    return response.data;
  },

  /**
   * Get homework data via REST API
   * Fetches homework assignments for the specified person and date range
   *
   * Uses API status tracking to skip permanent errors (403, 404, 410).
   *
   * @param {Object} authCtx - Authentication context (authService, credentials, cacheKey)
   * @param {Object} sessionCtx - Session context (sessionKey, authRefreshTracker)
   * @param {Object} logCtx - Logging context (logger, mmLog, formatErr)
   * @param {Object} flagsCtx - Debug flags (debugApi, dumpRawApiResponses)
   * @param {Date} rangeStart - Start date for homework query
   * @param {Date} rangeEnd - End date for homework query
   * @param {number} personId - Person ID (student)
   * @returns {Promise<Array>} Homework array with homework entries
   */
  async _getHomeworkViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    const { sessionKey, authRefreshTracker } = sessionCtx || {};
    const { debugApi, dumpRawApiResponses } = flagsCtx || {};
    const { authService, qrCodeUrl, cacheKey, school, server, username, password } = authCtx || {};
    const effectiveCacheKey = cacheKey || `user:${username}@${server}/${school}`;
    const mmLog = logCtx?.mmLog || this._mmLog.bind(this);

    // Check if API should be skipped based on previous status
    if (sessionKey && this._shouldSkipApi(sessionKey, 'homework')) {
      const prevStatus = this._apiStatusBySession.get(sessionKey).homework;
      mmLog('debug', null, `[homework] Skipping API call due to previous status ${prevStatus} (permanent error)`);
      return [];
    }

    const authOptions = this._getStandardAuthOptions({ cacheKey: effectiveCacheKey });

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }

    let response;
    try {
      response = await webuntisApiService.getHomework({
        getAuth: () =>
          qrCodeUrl
            ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey })
            : authService.getAuth(
                {
                  school,
                  username,
                  password,
                  server,
                },
                authOptions
              ),
        onAuthError: () => {
          if (authRefreshTracker) authRefreshTracker.refreshed = true;
          return authService.invalidateCache(effectiveCacheKey);
        },
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this._mmLog.bind(this),
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      });
    } catch (err) {
      if (sessionKey) this._recordApiStatusFromError(sessionKey, 'homework', err);
      throw err;
    }

    // Track API status
    if (sessionKey && response.status) {
      if (!this._apiStatusBySession.has(sessionKey)) {
        this._apiStatusBySession.set(sessionKey, {});
      }
      this._apiStatusBySession.get(sessionKey).homework = response.status;
    }

    return response.data;
  },

  /**
   * Get absences data via REST API
   * Fetches absence records for the specified person and date range
   *
   * Uses API status tracking to skip permanent errors (403, 404, 410).
   *
   * @param {Object} authCtx - Authentication context (authService, credentials, cacheKey)
   * @param {Object} sessionCtx - Session context (sessionKey, authRefreshTracker)
   * @param {Object} logCtx - Logging context (logger, mmLog, formatErr)
   * @param {Object} flagsCtx - Debug flags (debugApi, dumpRawApiResponses)
   * @param {Date} rangeStart - Start date for absences query
   * @param {Date} rangeEnd - End date for absences query
   * @param {number} personId - Person ID (student)
   * @returns {Promise<Array>} Absences array with absence entries
   */
  async _getAbsencesViaRest(authCtx, sessionCtx, logCtx, flagsCtx, rangeStart, rangeEnd, personId) {
    const { sessionKey, authRefreshTracker } = sessionCtx || {};
    const { debugApi, dumpRawApiResponses } = flagsCtx || {};
    const { authService, qrCodeUrl, cacheKey, school, server, username, password } = authCtx || {};
    const effectiveCacheKey = cacheKey || `user:${username}@${server}/${school}`;
    const mmLog = logCtx?.mmLog || this._mmLog.bind(this);

    // Check if API should be skipped based on previous status
    if (sessionKey && this._shouldSkipApi(sessionKey, 'absences')) {
      const prevStatus = this._apiStatusBySession.get(sessionKey).absences;
      mmLog('debug', null, `[absences] Skipping API call due to previous status ${prevStatus} (permanent error)`);
      return [];
    }

    const authOptions = this._getStandardAuthOptions({ cacheKey: effectiveCacheKey });

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }

    let response;
    try {
      response = await webuntisApiService.getAbsences({
        getAuth: () =>
          qrCodeUrl
            ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey })
            : authService.getAuth(
                {
                  school,
                  username,
                  password,
                  server,
                },
                authOptions
              ),
        onAuthError: () => {
          if (authRefreshTracker) authRefreshTracker.refreshed = true;
          return authService.invalidateCache(effectiveCacheKey);
        },
        server,
        rangeStart,
        rangeEnd,
        personId,
        logger: this._mmLog.bind(this),
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      });
    } catch (err) {
      if (sessionKey) this._recordApiStatusFromError(sessionKey, 'absences', err);
      throw err;
    }

    // Track API status
    if (sessionKey && response.status) {
      if (!this._apiStatusBySession.has(sessionKey)) {
        this._apiStatusBySession.set(sessionKey, {});
      }
      this._apiStatusBySession.get(sessionKey).absences = response.status;
    }

    return response.data;
  },

  /**
   * Get messages of day via REST API
   * Fetches school announcements/messages for a specific date
   *
   * Uses API status tracking to skip permanent errors (403, 404, 410).
   *
   * @param {Object} authCtx - Authentication context (authService, credentials, cacheKey)
   * @param {Object} sessionCtx - Session context (sessionKey, authRefreshTracker)
   * @param {Object} logCtx - Logging context (logger, mmLog, formatErr)
   * @param {Object} flagsCtx - Debug flags (debugApi, dumpRawApiResponses)
   * @param {Date} date - Date for messages query (typically today)
   * @returns {Promise<Array>} Messages array with message entries
   */
  async _getMessagesOfDayViaRest(authCtx, sessionCtx, logCtx, flagsCtx, date) {
    const { sessionKey, authRefreshTracker } = sessionCtx || {};
    const { debugApi, dumpRawApiResponses } = flagsCtx || {};
    const { authService, qrCodeUrl, cacheKey, school, server, username, password } = authCtx || {};
    const effectiveCacheKey = cacheKey || `user:${username}@${server}/${school}`;
    const mmLog = logCtx?.mmLog || this._mmLog.bind(this);

    // Check if API should be skipped based on previous status
    if (sessionKey && this._shouldSkipApi(sessionKey, 'messagesOfDay')) {
      const prevStatus = this._apiStatusBySession.get(sessionKey).messagesOfDay;
      mmLog('debug', null, `[messagesOfDay] Skipping API call due to previous status ${prevStatus} (permanent error)`);
      return [];
    }

    const authOptions = this._getStandardAuthOptions({ cacheKey: effectiveCacheKey });

    if (!authService) {
      throw new Error('AuthService not available in authCtx');
    }

    let response;
    try {
      response = await webuntisApiService.getMessagesOfDay({
        getAuth: () =>
          qrCodeUrl
            ? authService.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey })
            : authService.getAuth(
                {
                  school,
                  username,
                  password,
                  server,
                },
                authOptions
              ),
        onAuthError: () => {
          if (authRefreshTracker) authRefreshTracker.refreshed = true;
          return authService.invalidateCache(effectiveCacheKey);
        },
        server,
        date,
        logger: this._mmLog.bind(this),
        debugApi: Boolean(debugApi),
        dumpRaw: Boolean(dumpRawApiResponses),
      });
    } catch (err) {
      if (sessionKey) this._recordApiStatusFromError(sessionKey, 'messagesOfDay', err);
      throw err;
    }

    // Track API status
    if (sessionKey && response.status) {
      if (!this._apiStatusBySession.has(sessionKey)) {
        this._apiStatusBySession.set(sessionKey, {});
      }
      this._apiStatusBySession.get(sessionKey).messagesOfDay = response.status;
    }

    return response.data;
  },

  /**
   * Auto-discover students from parent account (app/data endpoint)
   * This function handles three scenarios:
   *   1. No students configured -> auto-discover all students from parent account
   *   2. Students with IDs but no titles -> fill in missing titles from auto-discovery
   *   3. Students with titles but no IDs -> suggest/assign student IDs
   *
   * Also merges module-level defaults into each student config for consistent behavior
   *
   * @param {Object} moduleConfig - Module configuration object
   * @returns {Promise<void>} No return value, modifies moduleConfig.students in place
   */
  async _ensureStudentsFromAppData(moduleConfig) {
    try {
      if (!moduleConfig || typeof moduleConfig !== 'object') return;

      const configuredStudentsRaw = Array.isArray(moduleConfig.students) ? moduleConfig.students : [];
      // Treat students array as "not configured" when it contains no real credentials OR title
      // Students with only title (and no credentials) are considered "partially configured"
      // and will benefit from auto-discovery to fill in missing studentId
      const configuredStudents = configuredStudentsRaw.filter((s) => {
        if (!s || typeof s !== 'object') return false;
        const hasStudentId = s.studentId !== undefined && s.studentId !== null && String(s.studentId).trim() !== '';
        const hasQr = Boolean(s.qrcode);
        const hasCreds = Boolean(s.username && s.password);
        const hasTitle = Boolean(s.title && String(s.title).trim() !== '');
        // Include student if they have ANY of: studentId, qrcode, credentials, or title
        // Title-only students will get auto-assigned studentId later
        return hasStudentId || hasQr || hasCreds || hasTitle;
      });
      let autoStudents = null;

      // Check if parent credentials are configured (username/password/school OR qrcode)
      // Parent credentials enable auto-discovery and parent-mode authentication
      const hasParentCreds = Boolean((moduleConfig.username && moduleConfig.password && moduleConfig.school) || moduleConfig.qrcode);
      if (!hasParentCreds) return;

      // SCENARIO 1: Students are already configured (have credentials or IDs)
      // Try to improve configured data by filling missing titles or suggesting IDs
      if (configuredStudents.length > 0) {
        // However, if any student is missing a title but has a studentId,
        // try to fetch auto-discovered data to fill in the missing titles
        const server = moduleConfig.server || 'webuntis.com';
        try {
          let authResult;

          // Authenticate using parent credentials (QR code or username/password)
          if (moduleConfig.qrcode) {
            authResult = await moduleConfig._authService.getAuthFromQRCode(moduleConfig.qrcode, {
              cacheKey: `parent-qr:${moduleConfig.qrcode}`,
            });
          } else {
            authResult = await moduleConfig._authService.getAuth({
              school: moduleConfig.school,
              username: moduleConfig.username,
              password: moduleConfig.password,
              server,
              options: this._getStandardAuthOptions(),
            });
          }

          autoStudents = moduleConfig._authService.deriveStudentsFromAppData(authResult.appData);

          if (autoStudents && autoStudents.length > 0) {
            // For each configured student try to improve the configured data:
            // - If studentId exists but title is missing, fill title from auto-discovered list
            // - If title exists but no studentId, compute candidate ids (prefer title matches)
            configuredStudents.forEach((configStudent) => {
              if (!configStudent || typeof configStudent !== 'object') return;

              // IMPROVEMENT 1: Fill missing title when we have a student ID
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

              // IMPROVEMENT 2: If title is present but no studentId, suggest candidate IDs based on title match
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
          this._mmLog(
            'warn',
            null,
            `Could not fetch auto-discovered names for title fallback (server=${server || 'unknown'}). Is the WebUntis server reachable? ${this._formatErr(err)}`
          );
        }
        // VALIDATION: Check if configured studentIds actually exist in discovered students
        // Warn user if they configured an invalid studentId
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

      // SCENARIO 2: No students configured -> auto-discover from parent account
      // This is the default behavior when students[] is empty or not provided
      const server = moduleConfig.server || 'webuntis.com';
      let authResult;

      // Use QR code auth if available (LEGAL_GUARDIAN), otherwise username/password
      if (moduleConfig.qrcode) {
        authResult = await moduleConfig._authService.getAuthFromQRCode(moduleConfig.qrcode, {
          cacheKey: `parent-qr:${moduleConfig.qrcode}`,
        });
      } else {
        authResult = await moduleConfig._authService.getAuth({
          school: moduleConfig.school,
          username: moduleConfig.username,
          password: moduleConfig.password,
          server,
          options: this._getStandardAuthOptions({ cacheKey: `parent:${moduleConfig.username}@${server}` }),
        });
      }

      autoStudents = moduleConfig._authService.deriveStudentsFromAppData(authResult.appData);

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
    const useQrLogin = Boolean(sample.qrcode);
    const hasOwnCredentials = sample.username && sample.password && sample.school && sample.server;
    const hasParentCredentials = moduleConfig && moduleConfig.username && moduleConfig.password && moduleConfig.school;
    const hasParentQr = moduleConfig && moduleConfig.qrcode;

    // Get identifier-specific AuthService to prevent cache cross-contamination
    const authService = this._getAuthServiceForIdentifier(identifier);

    // Determine which credentials to use: student's own or parent's
    const useStudentQr = useQrLogin && sample.qrcode;
    const useParentQr = !useQrLogin && hasParentQr && moduleConfig.qrcode;
    const useParentCreds = !useQrLogin && !useParentQr && hasParentCredentials;

    // QR Code Authentication (student or parent)
    if (useStudentQr || useParentQr) {
      const qrCode = useStudentQr ? sample.qrcode : moduleConfig.qrcode;
      const cacheKey = cacheKeyOverride || `qrcode:${qrCode}`;
      const authResult = await authService.getAuthFromQRCode(qrCode, {
        cacheKey,
      });
      return {
        school: authResult.school,
        server: authResult.server,
        personId: authResult.personId,
        role: authResult.role || null, // STUDENT, LEGAL_GUARDIAN, TEACHER, etc.
        cookieString: authResult.cookieString,
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData || null,
        qrCodeUrl: qrCode, // Store for re-authentication
      };
    }

    // Username/Password Authentication (student or parent)
    if (useParentCreds || hasOwnCredentials) {
      // Determine which credentials to use
      const useStudentCreds = hasOwnCredentials;
      const school = useStudentCreds ? sample.school : sample.school || moduleConfig.school;
      const server = useStudentCreds ? sample.server : sample.server || moduleConfig.server || 'webuntis.com';
      const username = useStudentCreds ? sample.username : moduleConfig.username;
      const password = useStudentCreds ? sample.password : moduleConfig.password;

      const cacheKey = cacheKeyOverride || `${useStudentCreds ? 'student' : 'parent'}:${username}@${server}/${school}`;

      const authResult = await authService.getAuth({
        school,
        username,
        password,
        server,
        options: { cacheKey },
      });

      return {
        school,
        server,
        personId: authResult.personId,
        role: authResult.role || null, // STUDENT, LEGAL_GUARDIAN, TEACHER, etc.
        cookieString: authResult.cookieString,
        token: authResult.token,
        tenantId: authResult.tenantId,
        schoolYearId: authResult.schoolYearId,
        appData: authResult.appData || null,
        username, // Store for re-authentication
      };
    }

    // No valid credentials found
    let errorMsg = '\nCredentials missing! need either:';
    errorMsg += '\n  (1) studentId + username/password in module config, or';
    errorMsg += '\n  (2) username/password/school/server in student config, or';
    errorMsg += '\n  (3) qrcode in student config for QR code login, or';
    errorMsg += '\n  (4) qrcode in module config for parent (LEGAL_GUARDIAN) authentication\n';

    this._mmLog('error', sample, errorMsg);
    throw new Error(errorMsg);
  },

  /**
   * Compact timegrid data from WebUntis API to reduce payload size
   * Handles both old format (array of rows with timeUnits) and new format (direct array of time slots)
   * Keeps only essential fields: startTime, endTime, name
   *
   * @param {Array} rawGrid - Raw timegrid data from API
   * @returns {Array} Compacted timeUnits array with minimal fields
   */
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

  /**
   * Compact holidays data from WebUntis API
   * Handles both appData format (start/end ISO timestamps) and legacy format (startDate/endDate YYYYMMDD)
   * Normalizes all dates to YYYYMMDD integer format
   *
   * @param {Array} rawHolidays - Raw holidays data from API
   * @returns {Array} Compacted holidays array with {id, name, longName, startDate, endDate}
   */
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
          this._mmLog('debug', null, `Holidays: ${rawHolidays.length} periods from appData (no API call needed)`);
        } else if (authSession.appData.data && Array.isArray(authSession.appData.data.holidays)) {
          rawHolidays = authSession.appData.data.holidays;
          this._mmLog('debug', null, `Holidays: ${rawHolidays.length} periods from appData.data (no API call needed)`);
        } else {
          this._mmLog('debug', null, 'Holidays: not found in appData (no API call - holidays unavailable)');
        }
      } else {
        this._mmLog('debug', null, 'Holidays: no appData available');
      }
    } catch (error) {
      this._mmLog('error', null, `Holidays extraction failed: ${error && error.message ? error.message : error}`);
    }

    return this._compactHolidays(rawHolidays);
  },

  /**
   * Check if a specific widget should be displayed based on displayMode configuration
   * Supports both exact matches and comma-separated lists
   * Handles backwards-compatible values (e.g., "list" = "lessons,exams")
   *
   * @param {string} widgetName - Widget name to check (e.g., 'grid', 'lessons', 'exams')
   * @param {string} displayMode - Display mode from config (e.g., 'grid', 'lessons,exams,homework')
   * @returns {boolean} True if widget should be displayed
   */
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
   * Process a credential group: authenticate, fetch data for all students, send to frontend
   * This is the main orchestration function that:
   *   1. Creates authentication session (cached by authService)
   *   2. Fetches data for each student in the group (using shared credentials)
   *   3. Sends all payloads to frontend at once (minimizes DOM redraws)
   *
   * Authentication is cached by authService, so multiple sessions with same credentials
   * will only authenticate once. Token caching prevents unnecessary re-authentication.
   *
   * @param {string} credKey - Credential grouping key (identifies shared auth session)
   * @param {Array} students - Array of student configs sharing these credentials
   * @param {string} identifier - Module instance identifier
   * @param {string} sessionKey - Session key for API status tracking
   * @param {Object} config - Module configuration
   * @returns {Promise<void>}
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
        const errorMsg = this._formatErr(err);
        // Differentiate between credential/config errors and network errors
        const isNetworkError = errorMsg.includes('connect') || errorMsg.includes('timeout') || errorMsg.includes('network');
        const msg = isNetworkError
          ? `Cannot reach WebUntis server for ${credKey}: ${errorMsg}`
          : `Authentication failed for ${credKey}: ${errorMsg}`;
        this._mmLog('error', null, msg);

        // AGGRESSIVE REAUTH: On any auth error, invalidate ALL caches for this session
        // This forces complete re-authentication (new cookies, OTP, etc.) for all future requests
        // Prevents cascading failures from expired/corrupted auth state
        const authService = this._getAuthServiceForIdentifier(identifier);
        if (authService && typeof authService.invalidateAllCachesForSession === 'function') {
          authService.invalidateAllCachesForSession(sessionKey);
          this._mmLog('warn', null, `[REAUTH] Triggered complete re-authentication for session ${sessionKey} due to auth failure`);
        }

        // Record and mark this warning for the current fetch cycle
        if (!this._currentFetchWarnings.has(msg)) {
          groupWarnings.push(msg);
          this._currentFetchWarnings.add(msg);
        }
        // Send error payload to frontend with warnings
        for (const student of students) {
          const effectiveDisplayMode = student.displayMode || config.displayMode;
          const wantsGridWidget = this._wantsWidget('grid', effectiveDisplayMode);
          const wantsLessonsWidget = this._wantsWidget('lessons', effectiveDisplayMode);
          const wantsExamsWidget = this._wantsWidget('exams', effectiveDisplayMode);
          const wantsHomeworkWidget = this._wantsWidget('homework', effectiveDisplayMode);
          const wantsAbsencesWidget = this._wantsWidget('absences', effectiveDisplayMode);
          const wantsMessagesOfDayWidget = this._wantsWidget('messagesofday', effectiveDisplayMode);
          const fetchFlags = {
            fetchTimegrid: Boolean(wantsGridWidget || wantsLessonsWidget),
            fetchTimetable: Boolean(wantsGridWidget || wantsLessonsWidget),
            fetchExams: Boolean(wantsGridWidget || wantsExamsWidget),
            fetchHomeworks: Boolean(wantsGridWidget || wantsHomeworkWidget),
            fetchAbsences: Boolean(wantsGridWidget || wantsAbsencesWidget),
            fetchMessagesOfDay: Boolean(wantsMessagesOfDayWidget),
          };
          // Sending error to frontend silently
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
            messagesOfDay: [],
            apiStatus: {},
            fetchFlags,
          });
        }
        return;
      }

      // ===== EXTRACT HOLIDAYS ONCE FOR ALL STUDENTS =====
      // Holidays are shared across all students in the same school/group.
      // Extract and compact them once before processing students to avoid redundant work.
      // Holidays come from appData (no separate API call needed)
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

      // Authentication complete via authService (no explicit login() needed)
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
          const payload = await this.fetchData(authSession, student, identifier, credKey, sharedCompactHolidays, config, sessionKey);
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
      for (const payload of studentPayloads) {
        // Send to ALL module instances, but include both id and sessionId for filtering
        // Frontend filters by sessionId (preferred) or id (fallback) to ensure correct routing
        // This allows multiple browser windows with same module identifier to get separate data
        payload.id = identifier;
        payload.sessionId = sessionKey.split(':')[1]; // Extract sessionId from "identifier:sessionId"
        // Sending data to frontend silently
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
   * Handle socket notifications sent by the frontend module
   * Main entry point for all frontend-to-backend communication
   *
   * Listens for:
   *   - INIT_MODULE: First-time module initialization (config validation, student discovery)
   *   - FETCH_DATA: Data refresh request (periodic updates, manual refresh)
   *
   * @param {string} notification - Notification name (INIT_MODULE, FETCH_DATA)
   * @param {any} payload - Notification payload (config object, refresh request)
   * @returns {Promise<void>}
   */
  async socketNotificationReceived(notification, payload) {
    // Processing socket notifications silently (no logging for cleaner output)

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
   *
   * Flow:
   *   1. Apply legacy config mappings (25+ deprecated keys)
   *   2. Validate configuration (validateConfig from configValidator)
   *   3. Set up AuthService for this identifier (prevents cache cross-contamination)
   *   4. Auto-discover students if parent credentials provided
   *   5. Send MODULE_INITIALIZED to frontend
   *   6. Automatically trigger initial data fetch (no separate FETCH_DATA needed)
   *
   * @param {Object} payload - Module configuration from frontend (includes id, sessionId, config)
   * @returns {Promise<void>}
   */
  async _handleInitModule(payload) {
    let normalizedConfig;
    let identifier;
    let sessionKey;

    try {
      // Create a deep copy of payload to prevent modifying the original config
      const payloadCopy = JSON.parse(JSON.stringify(payload));

      // Apply legacy mappings to convert old keys to new structure
      // This ensures backwards compatibility with 25+ deprecated config keys
      const result = applyLegacyMappings(payloadCopy, {
        warnCallback: (msg) => this._mmLog('warn', null, msg),
      });
      normalizedConfig = result.normalizedConfig;
      const legacyUsed = result.legacyUsed;

      identifier = normalizedConfig.id || 'default';
      const sessionId = payload.sessionId || 'unknown';
      // Session key format: "identifier:sessionId" for complete browser-window isolation
      sessionKey = `${identifier}:${sessionId}`;

      // Store config per session for isolation
      this._configsBySession.set(sessionKey, normalizedConfig);
      // Config stored silently

      // Log debugDate if present (for debugging time-sensitive scenarios)
      if (normalizedConfig.debugDate) {
        this._mmLog('debug', null, `[INIT_MODULE] Session debugDate="${normalizedConfig.debugDate}" (session-specific, not global)`);
      }

      // Ensure displayMode is lowercase
      if (typeof normalizedConfig.displayMode === 'string') {
        normalizedConfig.displayMode = normalizedConfig.displayMode.toLowerCase();
      }

      // Validate configuration
      const validatorLogger = { log: () => {} }; // Silent logger - only errors are sent to frontend
      const { valid, errors, warnings } = validateConfig(normalizedConfig, validatorLogger);

      // Generate detailed deprecation warnings
      const detailedWarnings = legacyUsed && legacyUsed.length > 0 ? generateDeprecationWarnings(legacyUsed) : [];
      const combinedWarnings = [...(warnings || []), ...detailedWarnings];

      if (!valid) {
        this._mmLog('error', null, `[INIT_MODULE] Config validation failed for ${identifier}`);
        this.sendSocketNotification('INIT_ERROR', {
          id: identifier,
          sessionId: payload.sessionId,
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
      // This fetches student list from parent account if students[] is empty/incomplete
      await this._ensureStudentsFromAppData(normalizedConfig);

      // Mark students as discovered for this identifier
      this._studentsDiscovered = this._studentsDiscovered || {};
      this._studentsDiscovered[identifier] = true;

      // Module initialized successfully (no log needed)

      // Send success notification to frontend
      this.sendSocketNotification('MODULE_INITIALIZED', {
        id: identifier,
        sessionId: payload.sessionId,
        config: normalizedConfig,
        warnings: combinedWarnings,
        students: normalizedConfig.students || [],
      });

      // Automatically trigger initial data fetch after successful initialization
      // This eliminates the need for frontend (and CLI) to send FETCH_DATA immediately after MODULE_INITIALIZED
      // Simplifies the initialization flow: INIT_MODULE -> MODULE_INITIALIZED + GOT_DATA
      await this._handleFetchData({
        id: identifier,
        sessionId: payload.sessionId,
        ...normalizedConfig,
      });
    } catch (error) {
      this._mmLog('error', null, `[INIT_MODULE] Initialization failed: ${this._formatErr(error)}`);
      this.sendSocketNotification('INIT_ERROR', {
        id: identifier || 'unknown',
        sessionId: payload?.sessionId,
        errors: [error.message || 'Unknown initialization error'],
        warnings: [],
        severity: 'ERROR',
        message: 'Module initialization failed',
      });
    }
  },

  /**
   * Handle FETCH_DATA notification - performs data refresh for already initialized module
   *
   * Flow:
   *   1. Verify module is initialized (per session or per identifier)
   *   2. Update session-specific config if provided (e.g., debugDate changes)
   *   3. Delegate to _executeFetchForSession for actual data fetching
   *
   * Uses cached config and authentication, only fetches fresh data from WebUntis.
   * Supports self-healing: if module not initialized but FETCH_DATA received, re-runs INIT_MODULE.
   *
   * @param {Object} payload - Fetch request from frontend (includes id, sessionId, optional debugDate)
   * @returns {Promise<void>}
   */
  async _handleFetchData(payload) {
    const identifier = payload.id || 'default';
    const sessionId = payload.sessionId || 'unknown';
    const sessionKey = `${identifier}:${sessionId}`;

    // Track FETCH_DATA requests to debug duplicate calls (silently)
    const fetchTimestamp = Date.now();
    this._lastFetchTimestamp = fetchTimestamp;

    // Verify module is initialized (per session preferred, fall back to identifier)
    // Session-specific config takes precedence over identifier-level config
    const hasSessionConfig = this._configsBySession.has(sessionKey);
    const baseConfig = this._configsByIdentifier.get(identifier);
    if (!hasSessionConfig && !baseConfig) {
      // Self-healing: if module not initialized but FETCH_DATA received, re-run initialization
      // This handles cases where backend restarted but frontend still thinks it's initialized
      this._mmLog(
        'warn',
        null,
        `[FETCH_DATA] Module ${identifier} not initialized for session ${sessionId} - attempting re-init from incoming payload`
      );
      // Attempt a self-heal by re-running initialization using the provided payload.
      // This covers cases where the backend restarted but the frontend still thinks it is initialized.
      await this._handleInitModule(payload);
      return;
    }

    // Start from session-specific config; if missing, clone identifier config for this session
    let normalizedConfig = hasSessionConfig ? this._configsBySession.get(sessionKey) : { ...baseConfig };
    if (!this._configsBySession.has(sessionKey) && normalizedConfig) {
      this._configsBySession.set(sessionKey, normalizedConfig);
    }

    // Update session-specific config if provided (e.g., debugDate changes for testing)
    if (payload.debugDate !== undefined) {
      normalizedConfig = { ...normalizedConfig, debugDate: payload.debugDate };
      this._configsBySession.set(sessionKey, normalizedConfig);
      if (payload.debugDate) {
        this._mmLog('debug', null, `[FETCH_DATA] Updated debugDate="${payload.debugDate}" (session=${sessionKey})`);
      }
    }

    // Execute fetch immediately
    await this._executeFetchForSession(sessionKey);
  },

  /**
   * Execute fetch for a specific session
   *
   * Flow:
   *   1. Verify session exists in _configsBySession
   *   2. Wait for any pending session-wide re-authentication (AGGRESSIVE REAUTH)
   *   3. Group students by credential key (share auth sessions)
   *   4. Process each credential group (authenticate, fetch, send to frontend)
   *
   * This processes only the config for the given session (no cross-session contamination).
   *
   * @param {string} sessionKey - Session key (format: "identifier:sessionId")
   * @returns {Promise<void>}
   */
  async _executeFetchForSession(sessionKey) {
    if (!this._configsBySession.has(sessionKey)) {
      this._mmLog('warn', null, `Session ${sessionKey} not found, skipping fetch`);
      return;
    }

    const config = this._configsBySession.get(sessionKey);

    // Extract identifier from sessionKey (format: identifier:sessionId)
    const sessionIdentifier = sessionKey.split(':')[0];

    // Get AuthService reference (already initialized during INIT_MODULE)
    config._authService = this._getAuthServiceForIdentifier(sessionIdentifier);

    try {
      // Note: Auto-discovery and config validation already done during INIT_MODULE
      // This is pure data fetch - config is already normalized and students are discovered

      // AGGRESSIVE REAUTH: Wait for any session-wide authentication to complete
      // This ensures all API requests are blocked until complete re-authentication finishes
      // Prevents cascading failures from expired/corrupted tokens
      const authService = config._authService;
      if (authService && typeof authService.waitForSessionAuth === 'function') {
        await authService.waitForSessionAuth(sessionKey);
      }

      // Group students by credential so we can reuse the same untis session
      // Students with the same credentials share a single auth session (reduces API calls)
      const groups = new Map();

      // Group students by credential. Normalize each student config for legacy key compatibility.
      const studentsList = Array.isArray(config.students) ? config.students : [];
      for (const student of studentsList) {
        // Apply legacy config mapping to student-level config
        const { normalizedConfig: normalizedStudent } = applyLegacyMappings(student);
        const credKey = this._getCredentialKey(normalizedStudent, config, sessionKey);
        if (!groups.has(credKey)) groups.set(credKey, []);
        groups.get(credKey).push(normalizedStudent);
      }

      // Process each credential group for this session
      // authService handles caching of authentication, so we don't need to cache authSession here
      for (const [credKey, students] of groups.entries()) {
        // Check if another session is already fetching this credKey
        // This prevents duplicate API calls when multiple sessions use the same credentials
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
    } catch (error) {
      this._mmLog('error', null, `Error loading Untis data for session ${sessionKey}: ${error}`);
    }
  },

  /**
   * Build a stable credential key for session caching and grouping
   * Students with the same credentials share a single WebUntis session to minimize API calls
   *
   * Uses sessionKey (identifier:sessionId) for full browser-session isolation.
   * For parent accounts (studentId + module-level username), group by parent credentials.
   * For direct student logins, group by student credentials.
   *
   * @param {Object} student - Student credential object
   * @param {Object} moduleConfig - Module configuration
   * @param {string} sessionKey - Session key (format: "identifier:sessionId")
   * @returns {string} credential key for caching/grouping (e.g., "scope::parent:user@server/school")
   */
  _getCredentialKey(student, moduleConfig, sessionKey = 'default') {
    // Use full sessionKey (identifier:sessionId) for complete browser-session isolation
    // This prevents cross-contamination between different browser windows with same identifier
    const scope = moduleConfig?.carouselId || sessionKey || 'default';
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
   * Extract timegrid (time slots) from timetable data
   * The REST API doesn't have a separate timegrid endpoint, but timetable includes time information
   * This function derives the school's time schedule from lesson start/end times
   *
   * @param {Array} timetable - Timetable array from REST API
   * @returns {Array} timegrid array with timeUnits {startTime, endTime, name}
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

    // Sort unique start times chronologically (convert HH:MM to integer for comparison)
    const sortedStarts = Array.from(startTimes).sort((a, b) => {
      const timeA = parseInt(a.replace(':', ''));
      const timeB = parseInt(b.replace(':', ''));
      return timeA - timeB;
    });

    // Create timeUnits (periods) from sorted start times
    // Each period runs from one start time to the next, or to its lesson's end time for the last period
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
   * Main data fetch orchestrator for a single student
   * This simplified version delegates to specialized modules:
   *   - lib/dateRangeCalculator.js: calculates date ranges for all data types
   *   - lib/dataFetchOrchestrator.js: fetches all data in parallel (2.7x speedup vs sequential)
   *   - lib/payloadBuilder.js: builds GOT_DATA payload with compacting and warnings
   *
   * Flow:
   *   1. Calculate date ranges (nextDays, previousDays, examsDays, etc.)
   *   2. Fetch all data types in parallel (timetable-first strategy prevents silent token failures)
   *   3. Build and return compacted payload for frontend
   *
   * @param {Object} authSession - Authenticated session with server, school, cookies, token
   * @param {Object} student - Student config object
   * @param {string} identifier - Module instance identifier
   * @param {string} credKey - Credential grouping key
   * @param {Array} compactHolidays - Pre-extracted and compacted holidays (shared across students in group)
   * @param {Object} config - Module configuration
   * @param {string} sessionKey - Session key for API status tracking
   * @returns {Promise<Object|null>} GOT_DATA payload object or null on error
   */
  async fetchData(authSession, student, identifier, credKey, compactHolidays = [], config, sessionKey) {
    // Accept both logger(message) and logger(level, student, message) signatures
    // This provides flexibility for calling code while maintaining consistent logging
    const logger = (...args) => {
      // Standard signature: logger(level, student, message)
      if (args.length >= 3 && typeof args[0] === 'string' && typeof args[2] === 'string') {
        const [level, studentCtx, message] = args;
        this._mmLog(level || 'debug', studentCtx || student, message);
        return;
      }

      // logger(level, message)
      if (args.length === 2 && typeof args[0] === 'string' && typeof args[1] === 'string') {
        const [level, message] = args;
        this._mmLog(level || 'debug', student, message);
        return;
      }

      // Fallback: treat first argument as message
      const [msg] = args;
      this._mmLog('debug', student, typeof msg === 'string' ? msg : JSON.stringify(msg));
    };

    // Build context objects for passing to API functions
    // These group related parameters to keep function signatures clean
    const logCtx = {
      logger,
      mmLog: this._mmLog.bind(this),
      formatErr: this._formatErr.bind(this),
    };

    const authRefreshTracker = { refreshed: false };
    const authCtx = {
      authService: config._authService,
      cacheKey: credKey,
      qrCodeUrl: authSession.qrCodeUrl || null,
      school: authSession.school,
      server: authSession.server,
      username: authSession.username || null,
      password: authSession.password || null,
    };
    const sessionCtx = {
      sessionKey,
      authRefreshTracker,
      authSession,
    };
    const flagsCtx = {
      debugApi: Boolean(config.debugApi),
      dumpRawApiResponses: Boolean(config.dumpRawApiResponses),
    };

    const { school, server } = authSession;
    const ownPersonId = authSession.personId;
    const bearerToken = authSession.token;
    const appData = authSession.appData;
    const role = authSession.role || null;
    const authService = config._authService;
    const restTargets = authService.buildRestTargets(student, config, school, server, ownPersonId, bearerToken, appData, role);

    // Verify REST targets were successfully built
    // If empty, authentication likely failed or credentials are invalid
    if (!restTargets || restTargets.length === 0) {
      this._mmLog('warn', student, `No REST targets built - cannot fetch data! Check authentication and credentials.`);
    }

    const describeTarget = (t) => {
      const roleLabel = t.role || 'unknown';
      if (t.role === 'LEGAL_GUARDIAN') {
        return `${roleLabel} (parentId=${ownPersonId}, childId=${t.personId})`;
      }
      return `${roleLabel}${t.personId ? ` (id=${t.personId})` : ''}`;
    };

    const className = student.class || student.className || null;
    const effectiveDisplayMode = student.displayMode || config.displayMode;

    // Determine which widgets are requested based on displayMode configuration
    // This controls which API endpoints we need to call
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
    const fetchFlags = {
      fetchTimegrid,
      fetchTimetable,
      fetchExams,
      fetchHomeworks,
      fetchAbsences,
      fetchMessagesOfDay,
    };

    // Calculate base date (with optional debugDate support for testing)
    // debugDate allows simulating "today" for testing future/past scenarios
    const baseNow = function () {
      try {
        const dbg = (typeof config?.debugDate === 'string' && config.debugDate) || null;
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
    // This determines start/end dates for timetable, exams, homework, absences based on config
    const dateRanges = calculateFetchRanges(student, config, baseNow, wantsGridWidget, fetchExams, fetchAbsences);

    // Get Timegrid from appData if available (avoids extra API call)
    // appData is fetched during authentication and includes the school's time schedule
    let grid = [];
    if (authSession?.appData?.currentSchoolYear?.timeGrid?.units) {
      const units = authSession.appData.currentSchoolYear.timeGrid.units;
      if (Array.isArray(units) && units.length > 0) {
        grid = units.map((u) => ({
          name: String(u.unitOfDay || u.period || ''),
          startTime: u.startTime || 0,
          endTime: u.endTime || 0,
        }));
      }
    }

    // ===== STEP 2: Fetch all data in parallel using dataFetchOrchestrator module =====
    const fetchResults = await orchestrateFetch({
      student,
      dateRanges,
      baseNow,
      restTargets,
      authCtx,
      sessionCtx,
      logCtx,
      flagsCtx,
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
      logger: logCtx.logger,
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
    // This is a fallback for schools that don't include timegrid in appData
    if (fetchTimegrid && grid.length === 0 && timetable.length > 0) {
      grid = this._extractTimegridFromTimetable(timetable);
    }

    // Find active holiday for today (to show in widget if currently on holiday)
    const findHolidayForDate = (ymd, holidays) => {
      if (!Array.isArray(holidays) || holidays.length === 0) return null;
      const dateNum = Number(ymd);
      return holidays.find((h) => Number(h.startDate) <= dateNum && dateNum <= Number(h.endDate)) || null;
    };
    const activeHoliday = findHolidayForDate(todayYmd, compactHolidays);

    // ===== STEP 3: Build payload using payloadBuilder module =====
    // This compacts all data, applies transformations, and adds warnings
    try {
      // Get API status for this session (includes HTTP status codes for each endpoint)
      const apiStatus = this._apiStatusBySession.get(sessionKey) || {};

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
        fetchFlags,
        activeHoliday,
        moduleConfig: config,
        currentFetchWarnings: this._currentFetchWarnings,
        compactTimegrid: this._compactTimegrid.bind(this),
        checkEmptyDataWarning: this._checkEmptyDataWarning.bind(this),
        mmLog: this._mmLog.bind(this),
        cleanupOldDebugDumps: this._cleanupOldDebugDumps.bind(this),
        apiStatus, // Include API status codes
      });
      return payload;
    } catch (err) {
      this._mmLog('error', student, `Failed to prepare payload for ${identifier}: ${this._formatErr(err)}`);
      return null;
    }
  },
});
