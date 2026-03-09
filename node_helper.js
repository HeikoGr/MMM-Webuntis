/* eslint-disable n/no-missing-require */
const NodeHelper = require('node_helper');
const Log = require('logger');
/* eslint-enable n/no-missing-require */
const fs = require('fs');
const path = require('path');

const { validateConfig, applyLegacyMappings, generateDeprecationWarnings } = require('./lib/configValidator');
const { createBackendLogger } = require('./lib/logger');
const { WebUntisClient } = require('./lib/webuntis/webuntisClient');
const { calculateFetchRanges } = require('./lib/webuntis/dataOrchestration');
const widgetConfigValidator = require('./lib/widgetConfigValidator');
module.exports = NodeHelper.create({
  /**
   * Called when the helper is initialized by the MagicMirror backend.
   * Use this hook to perform startup initialization.
   */
  start() {
    this._mmLog('debug', null, 'Node helper started');
    this.logger = createBackendLogger(this._mmLog.bind(this), 'MMM-Webuntis');

    const libLogger = (level, message) => {
      this._mmLog(level, null, `[lib] ${message}`);
    };

    this._libLogger = libLogger;
    this._authServicesByIdentifier = new Map();

    this._apiStatusBySession = new Map(); // sessionKey -> { timetable: 200, exams: 403, ... }
    this._configWarningsSent = false;
    this._configsByIdentifier = new Map();
    this._configsBySession = new Map();
    this._pausedSessions = new Set(); // sessionKey values currently suspended/hidden
    this._pendingFetchByCredKey = new Map(); // Track pending fetches to avoid duplicates
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
    const record = this._apiStatusBySession.get(sessionKey)[endpoint];
    if (!record) return false;

    // Support both old format (plain number) and new format ({ status, recordedAt })
    const status = typeof record === 'object' ? record.status : record;
    const recordedAt = typeof record === 'object' ? record.recordedAt : 0;

    // Permanent errors - skip API calls for these
    // 403 Forbidden - user has no permission for this endpoint (school licensing)
    // 404 Not Found - endpoint doesn't exist
    // 410 Gone - resource permanently removed
    const permanentErrors = [403, 404, 410];

    if (!permanentErrors.includes(status)) return false;

    // Retry after 24 hours in case the school adds a new module/license
    const RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
    if (recordedAt && Date.now() - recordedAt > RETRY_AFTER_MS) {
      // Expired — clear status and allow retry
      delete this._apiStatusBySession.get(sessionKey)[endpoint];
      return false;
    }

    return true;
  },

  /**
   * Record API status from an error response so frontend can detect failures.
   * @param {string} sessionKey - Session key
   * @param {string} endpoint - API endpoint name
   * @param {Error} err - Error object
   */
  _recordApiStatusFromError(sessionKey, endpoint, err) {
    if (!sessionKey) return;
    const status = this._extractHttpStatus(err);

    if (!this._apiStatusBySession.has(sessionKey)) {
      this._apiStatusBySession.set(sessionKey, {});
    }
    this._apiStatusBySession.get(sessionKey)[endpoint] = { status, recordedAt: Date.now() };
  },

  /**
   * Extract numeric HTTP status from a structured error object.
   * Returns 0 when status is unavailable.
   *
   * @param {Error|Object} err - Error object
   * @returns {number} HTTP status code or 0
   */
  _extractHttpStatus(err) {
    const rawStatus = err?.status ?? err?.httpStatus ?? err?.response?.status ?? err?.cause?.status ?? err?.cause?.httpStatus;
    const numericStatus = Number(rawStatus);
    return Number.isFinite(numericStatus) ? numericStatus : 0;
  },

  /**
   * Determine whether an error is a network connectivity failure.
   * Uses structured error codes first; falls back to message parsing only for
   * network wording variants that sometimes arrive as plain text.
   *
   * @param {Error|Object} err - Error object
   * @returns {boolean} True if network-related
   */
  _isNetworkError(err) {
    const code = String(err?.code || err?.cause?.code || '').toUpperCase();
    const name = String(err?.name || err?.cause?.name || '').toUpperCase();
    const networkCodes = new Set([
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ERR_NETWORK',
      'ERR_SOCKET_CONNECTION_TIMEOUT',
      'ERR_CONNECTION_REFUSED',
      'ABORT_ERR',
    ]);
    if (networkCodes.has(code)) return true;
    if (name === 'ABORTERROR') return true;

    // Allowed fallback: some lower-level fetch paths only surface text.
    const msg = String(err?.message || err?.cause?.message || '').toLowerCase();
    return (
      msg.includes('fetch failed') ||
      msg.includes('network error') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('ehostunreach')
    );
  },

  /**
   * Build deterministic warning metadata from an error object.
   *
   * @param {Error|Object} err - Error object
   * @param {Object} [extra={}] - Additional metadata fields
   * @returns {Object} warning meta
   */
  _classifyWarningMetaFromError(err, extra = {}) {
    const status = this._extractHttpStatus(err);
    const code = String(err?.code || err?.cause?.code || '').toUpperCase() || null;

    let kind = 'generic';
    let severity = 'warning';

    if (this._isNetworkError(err)) {
      kind = 'network';
      severity = 'critical';
    } else if (status === 401 || code === 'AUTH_FAILED' || code === 'SESSION_EXPIRED' || code === 'TOKEN_INVALID') {
      kind = 'auth';
      severity = 'critical';
    } else if (status === 429) {
      kind = 'rate_limit';
      severity = 'warning';
    } else if (status >= 500) {
      kind = 'server';
      severity = 'critical';
    } else if (status >= 400) {
      kind = 'client';
      severity = status === 403 ? 'warning' : 'critical';
    }

    return {
      kind,
      severity,
      status: status || null,
      code,
      ...extra,
    };
  },

  /**
   * Build warning metadata entries for a list of warning messages.
   *
   * @param {string[]} warnings - Warning messages
   * @param {Object} baseMeta - Metadata merged into each entry
   * @returns {Object[]} warningMeta array
   */
  _buildWarningMetaEntries(warnings = [], baseMeta = {}) {
    if (!Array.isArray(warnings)) return [];
    return warnings
      .filter((message) => Boolean(message))
      .map((message) => ({
        message: String(message),
        ...baseMeta,
      }));
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
      this._authServicesByIdentifier.set(identifier, WebUntisClient.createAuthService({ logger: this._libLogger }));
    }
    return this._authServicesByIdentifier.get(identifier);
  },

  /**
   * Normalize legacy configuration keys to modern format.
   * Applies mappings once for module-level config and once for each student entry.
   *
   * @param {Object} cfg - Raw configuration object (may contain legacy keys)
   * @returns {Object} { normalizedConfig, legacyUsed }
   */
  _normalizeLegacyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return { normalizedConfig: cfg, legacyUsed: [] };

    const { normalizedConfig } = applyLegacyMappings(cfg);
    const legacyUsed = Array.isArray(normalizedConfig.__legacyUsed) ? [...normalizedConfig.__legacyUsed] : [];

    // Normalize each student once at init, so fetch flow can treat students as canonical.
    if (Array.isArray(normalizedConfig.students)) {
      normalizedConfig.students = normalizedConfig.students.map((student) => {
        const { normalizedConfig: normalizedStudent } = applyLegacyMappings(student);
        const studentLegacy = Array.isArray(normalizedStudent.__legacyUsed) ? normalizedStudent.__legacyUsed : [];
        studentLegacy.forEach((key) => {
          if (!legacyUsed.includes(key)) legacyUsed.push(key);
        });
        return normalizedStudent;
      });
    }

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

    return { normalizedConfig, legacyUsed };
  },

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
   * Delegates to WebUntisClient static helper for consistent error formatting
   *
   * @param {Error|any} err - Error object or value to format
   * @returns {string} Formatted error message
   */
  _formatErr(err) {
    return WebUntisClient.formatError(err);
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
   * Authenticate with module-level parent credentials (QR or username/password).
   * Centralizes parent auth flow used by student auto-discovery paths.
   *
   * @param {Object} moduleConfig - Module configuration object
   * @param {string} server - Target server hostname
   * @param {string|null} cacheKey - Optional cache key for username/password auth
   * @returns {Promise<Object>} Auth result from authService
   */
  async _getParentAuthResult(moduleConfig, server, cacheKey = null) {
    if (moduleConfig.qrcode) {
      return moduleConfig._authService.getAuthFromQRCode(moduleConfig.qrcode, {
        cacheKey: `parent-qr:${moduleConfig.qrcode}`,
      });
    }

    const options = cacheKey ? this._getStandardAuthOptions({ cacheKey }) : this._getStandardAuthOptions();
    return moduleConfig._authService.getAuth({
      school: moduleConfig.school,
      username: moduleConfig.username,
      password: moduleConfig.password,
      server,
      options,
    });
  },

  /**
   * Merge module-level defaults into student configurations.
   * Applies legacy mappings and normalizes widget sub-configs consistently.
   *
   * @param {Object} moduleConfig - Module configuration object
   * @param {Array} students - Student configuration array
   * @param {Object} options - Merge options
   * @param {boolean} options.markAutoDiscovered - Mark each student as auto-discovered
   * @returns {Array} Normalized student configurations
   */
  _mergeModuleDefaultsIntoStudents(moduleConfig, students, options = {}) {
    const { markAutoDiscovered = false } = options;
    const widgetKeys = ['lessons', 'grid', 'exams', 'homework', 'absences', 'messagesofday'];

    const defNoStudents = { ...(moduleConfig || {}) };
    delete defNoStudents.students;
    // Don't copy parent credentials into student configs to avoid confusion in _createAuthSession
    delete defNoStudents.username;
    delete defNoStudents.password;
    delete defNoStudents.school;
    delete defNoStudents.server;

    const sourceStudents = Array.isArray(students) ? students : [];
    return sourceStudents.map((student) => {
      const inputStudent = markAutoDiscovered ? { ...(student || {}), _autoDiscovered: true } : student || {};

      const merged = {
        ...defNoStudents,
        ...inputStudent,
      };

      widgetKeys.forEach((widget) => {
        merged[widget] = {
          ...(defNoStudents[widget] || {}),
          ...(inputStudent[widget] || {}),
        };
      });

      if (typeof merged.displayMode === 'string') {
        merged.displayMode = merged.displayMode.toLowerCase();
      }

      return merged;
    });
  },

  _isConfiguredStudentCandidate(student) {
    if (!student || typeof student !== 'object') return false;
    const hasStudentId = student.studentId !== undefined && student.studentId !== null && String(student.studentId).trim() !== '';
    const hasQr = Boolean(student.qrcode);
    const hasCreds = Boolean(student.username && student.password);
    const hasTitle = Boolean(student.title && String(student.title).trim() !== '');
    return hasStudentId || hasQr || hasCreds || hasTitle;
  },

  _getCandidateStudentIdsForConfig(configStudent, autoStudents) {
    const candidateMatches = configStudent.title
      ? autoStudents.filter((a) => (a.title || '').toLowerCase().includes(String(configStudent.title).toLowerCase()))
      : [];
    return (candidateMatches.length > 0 ? candidateMatches : autoStudents).map((s) => Number(s.studentId));
  },

  _enhanceConfiguredStudentFromAutoData(configStudent, autoStudents) {
    if (!configStudent || typeof configStudent !== 'object') return;

    if (configStudent.studentId && !configStudent.title) {
      const autoStudent = autoStudents.find((auto) => Number(auto.studentId) === Number(configStudent.studentId));
      if (autoStudent) {
        configStudent.title = autoStudent.title;
        this._mmLog(
          'debug',
          configStudent,
          `Filled in auto-discovered name: "${autoStudent.title}" for studentId ${configStudent.studentId}`
        );
      }
      return;
    }

    if ((!configStudent.studentId || configStudent.studentId === '') && configStudent.title) {
      const titleLower = String(configStudent.title).toLowerCase();
      const matched = autoStudents.filter((a) => (a.title || '').toLowerCase().includes(titleLower));
      const candidateIds = (matched.length > 0 ? matched : autoStudents).map((s) => Number(s.studentId));

      if (candidateIds.length === 1) {
        configStudent.studentId = candidateIds[0];
        configStudent._autoDiscovered = true;
        delete configStudent.username;
        delete configStudent.password;
        delete configStudent.school;
        delete configStudent.server;
        const msg = `Auto-assigned studentId=${candidateIds[0]} for "${configStudent.title}" (only match found)`;
        this._mmLog('debug', configStudent, msg);
      } else {
        const msg = `Student with title "${configStudent.title}" has no studentId configured. Possible studentIds: ${candidateIds.join(', ')}.`;
        configStudent.__warnings = configStudent.__warnings || [];
        configStudent.__warnings.push(msg);
        this._mmLog('warn', configStudent, msg);
      }
    }
  },

  _validateConfiguredStudentIds(configuredStudents, autoStudents) {
    try {
      if (!autoStudents || autoStudents.length === 0) return;

      configuredStudents.forEach((configStudent) => {
        if (!configStudent || !configStudent.studentId) return;
        const match = autoStudents.find((a) => Number(a.studentId) === Number(configStudent.studentId));
        if (!match) {
          const candidateIds = this._getCandidateStudentIdsForConfig(configStudent, autoStudents);
          const msg = `Configured studentId ${configStudent.studentId} for title "${configStudent.title || ''}" was not found in auto-discovered students. Possible studentIds: ${candidateIds.join(', ')}.`;
          configStudent.__warnings = configStudent.__warnings || [];
          configStudent.__warnings.push(msg);
          this._mmLog('warn', configStudent, msg);
        }
      });
    } catch {
      // ignore validation errors
    }
  },

  async _loadAutoStudentsForConfiguredEntries(moduleConfig, configuredStudents) {
    const server = moduleConfig.server || 'webuntis.com';
    try {
      const authResult = await this._getParentAuthResult(moduleConfig, server);
      const autoStudents = moduleConfig._authService.deriveStudentsFromAppData(authResult.appData);

      if (autoStudents && autoStudents.length > 0) {
        configuredStudents.forEach((configStudent) => this._enhanceConfiguredStudentFromAutoData(configStudent, autoStudents));
      }

      return autoStudents;
    } catch (err) {
      this._mmLog(
        'warn',
        null,
        `Could not fetch auto-discovered names for title fallback (server=${server || 'unknown'}). Is the WebUntis server reachable? ${this._formatErr(err)}`
      );
      return null;
    }
  },

  _mergeDefaultsIntoConfiguredStudentsOnce(moduleConfig) {
    if (moduleConfig._moduleDefaultsMerged) return;

    const allStudents = Array.isArray(moduleConfig.students) ? moduleConfig.students : [];
    const mergedStudents = this._mergeModuleDefaultsIntoStudents(moduleConfig, allStudents);

    moduleConfig.students = mergedStudents;
    moduleConfig._moduleDefaultsMerged = true;
    this._mmLog('debug', null, `✓ Module defaults merged into ${mergedStudents.length} configured student(s)`);
  },

  _assignAutoStudentsOnce(moduleConfig, autoStudents) {
    if (moduleConfig._autoStudentsAssigned) {
      this._mmLog('debug', null, 'Auto-discovered students already assigned; skipping reassignment');
      return;
    }

    const normalizedAutoStudents = this._mergeModuleDefaultsIntoStudents(moduleConfig, autoStudents, {
      markAutoDiscovered: true,
    });

    moduleConfig.students = normalizedAutoStudents;
    moduleConfig._autoStudentsAssigned = true;
    moduleConfig._moduleDefaultsMerged = true;

    const studentList = normalizedAutoStudents.map((s) => `• ${s.title} (ID: ${s.studentId})`).join('\n  ');
    this._mmLog('debug', null, `✓ Auto-discovered ${normalizedAutoStudents.length} student(s):\n  ${studentList}`);
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
      const configuredStudents = configuredStudentsRaw.filter((s) => this._isConfiguredStudentCandidate(s));
      let autoStudents = null;

      const hasParentCreds = Boolean((moduleConfig.username && moduleConfig.password && moduleConfig.school) || moduleConfig.qrcode);

      if (configuredStudents.length > 0) {
        if (hasParentCreds) {
          autoStudents = await this._loadAutoStudentsForConfiguredEntries(moduleConfig, configuredStudents);
          this._validateConfiguredStudentIds(configuredStudents, autoStudents);
        }

        this._mergeDefaultsIntoConfiguredStudentsOnce(moduleConfig);
        return;
      }

      if (!hasParentCreds) return;

      const server = moduleConfig.server || 'webuntis.com';
      const authResult = await this._getParentAuthResult(moduleConfig, server, `parent:${moduleConfig.username}@${server}`);

      autoStudents = moduleConfig._authService.deriveStudentsFromAppData(authResult.appData);

      if (!autoStudents || autoStudents.length === 0) {
        this._mmLog('warn', null, 'No students discovered via app/data; please configure students[] manually');
        return;
      }

      this._assignAutoStudentsOnce(moduleConfig, autoStudents);
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
      const startDate = h.startDate ?? WebUntisClient.normalizeDateToInteger(h.start);
      const endDate = h.endDate ?? WebUntisClient.normalizeDateToInteger(h.end);

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
      if (authSession && authSession.appData) {
        if (Array.isArray(authSession.appData.holidays)) {
          rawHolidays = authSession.appData.holidays;
        } else if (authSession.appData.data && Array.isArray(authSession.appData.data.holidays)) {
          rawHolidays = authSession.appData.data.holidays;
        }
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
    const dm = (displayMode === undefined || displayMode === null ? '' : String(displayMode)).toLowerCase().trim();
    if (!w) return false;

    const aliasMap = {
      homework: ['homework', 'homeworks'],
      absences: ['absence', 'absences'],
      messagesofday: ['messagesofday', 'messages'],
      lessons: ['lessons', 'list'],
      exams: ['exams', 'list'],
      grid: ['grid'],
    };

    const acceptedTokens = aliasMap[w] || [w];
    if (acceptedTokens.includes(dm)) return true;

    return dm
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .some((p) => acceptedTokens.includes(p));
  },

  /**
   * Parse compound session key format `identifier:sessionId`.
   *
   * @param {string} sessionKey - Session key
   * @returns {{identifier: string, sessionId: string}} Parsed parts
   */
  _parseSessionKey(sessionKey) {
    const raw = String(sessionKey || 'default:unknown');
    const idx = raw.indexOf(':');
    if (idx === -1) {
      return {
        identifier: raw || 'default',
        sessionId: 'unknown',
      };
    }
    return {
      identifier: raw.slice(0, idx) || 'default',
      sessionId: raw.slice(idx + 1) || 'unknown',
    };
  },

  /**
   * Build widget/fetch flags from displayMode.
   *
   * This is intentionally kept in node_helper (MMM adapter layer) so
   * lib/webuntis stays free of UI/displayMode concepts.
   *
   * @param {string} displayMode - Effective display mode
   * @returns {Object} Widget and fetch flags
   */
  _buildFetchFlags(displayMode) {
    const wants = (name) => this._wantsWidget(name, displayMode);
    const wantsGridWidget = wants('grid');
    const wantsLessonsWidget = wants('lessons');
    const wantsExamsWidget = wants('exams');
    const wantsHomeworkWidget = wants('homework');
    const wantsAbsencesWidget = wants('absences');
    const wantsMessagesOfDayWidget = wants('messagesofday');

    return {
      wantsGridWidget,
      wantsLessonsWidget,
      wantsExamsWidget,
      wantsHomeworkWidget,
      wantsAbsencesWidget,
      wantsMessagesOfDayWidget,
      fetchTimegrid: Boolean(wantsGridWidget || wantsLessonsWidget),
      fetchTimetable: Boolean(wantsGridWidget || wantsLessonsWidget),
      fetchExams: Boolean(wantsGridWidget || wantsExamsWidget),
      fetchHomeworks: Boolean(wantsGridWidget || wantsHomeworkWidget),
      fetchAbsences: Boolean(wantsGridWidget || wantsAbsencesWidget),
      fetchMessagesOfDay: Boolean(wantsMessagesOfDayWidget),
    };
  },

  /**
   * Calculate current base date in configured timezone and optional debug override.
   *
   * @param {Object} config - Module config
   * @returns {Date} Timezone-aware base date
   */
  _calculateBaseNow(config) {
    try {
      const dbg = (typeof config?.debugDate === 'string' && config.debugDate) || null;
      if (dbg) {
        const s = String(dbg).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
        if (/^\d{8}$/.test(s)) {
          return new Date(`${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}T00:00:00`);
        }
      }
    } catch {
      void 0;
    }

    const now = new Date(Date.now());
    return new Date(now.toLocaleString('en-US', { timeZone: config.timezone || 'Europe/Berlin' }));
  },

  /**
   * Get session config from cache or create it from identifier-level config.
   *
   * @param {string} sessionKey - Compound session key
   * @param {string} identifier - Module identifier
   * @returns {Object|null} Session config object
   */
  _getOrCreateSessionConfig(sessionKey, identifier) {
    if (this._configsBySession.has(sessionKey)) {
      return this._configsBySession.get(sessionKey);
    }

    const baseConfig = this._configsByIdentifier.get(identifier);
    if (!baseConfig) return null;

    const sessionConfig = { ...baseConfig };
    this._configsBySession.set(sessionKey, sessionConfig);
    return sessionConfig;
  },

  /**
   * Merge multiple warning arrays into one flattened warning list.
   *
   * @param {...Array} warningGroups - Warning arrays from validators
   * @returns {Array} Flattened warnings
   */
  _collectValidationWarnings(...warningGroups) {
    return warningGroups.flat().filter((warning) => typeof warning === 'string' && warning.length > 0);
  },

  /**
   * Validate student credentials and configuration before attempting fetch
   */
  _validateStudentConfig(student) {
    return this._collectValidationWarnings(
      widgetConfigValidator.validateStudentCredentials(student),
      widgetConfigValidator.validateStudentWidgets(student)
    );
  },

  /**
   * Validate module configuration for common issues
   */
  _validateModuleConfig(config) {
    const warnings = [];

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

    const validLogLevels = ['none', 'error', 'warn', 'info', 'debug'];
    if (config.logLevel && !validLogLevels.includes(config.logLevel.toLowerCase())) {
      warnings.push(`Invalid logLevel "${config.logLevel}". Use: ${validLogLevels.join(', ')}`);
    }

    return this._collectValidationWarnings(warnings, widgetConfigValidator.validateAllWidgets(config));
  },

  _deriveFallbackStudentTitle(student) {
    return (
      student?.title ||
      student?.name ||
      (student?.studentId !== undefined && student?.studentId !== null ? `Student ${student.studentId}` : 'Student')
    );
  },

  _buildPayloadDisplayWidgets(student, config) {
    return String(student?.displayMode || config?.displayMode || 'lessons,exams')
      .toLowerCase()
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  },

  _buildBaseStudentPayload({ identifier, sessionId, student, config, fetchFlags }) {
    return {
      contractVersion: 2,
      id: identifier,
      sessionId,
      meta: {
        moduleId: identifier,
        sessionId,
        generatedAt: new Date().toISOString(),
      },
      context: {
        student: {
          id: student?.studentId ?? null,
          title: this._deriveFallbackStudentTitle(student),
        },
        config: student,
        timezone: config?.timezone || 'Europe/Berlin',
        todayYmd: null,
        range: {
          startYmd: null,
          endYmd: null,
        },
        display: {
          mode: student?.mode || config?.mode || 'verbose',
          widgets: this._buildPayloadDisplayWidgets(student, config),
        },
      },
      data: {
        timeUnits: [],
        lessons: [],
        exams: [],
        homework: [],
        absences: [],
        messages: [],
        holidays: {
          ranges: [],
          current: null,
        },
      },
      state: {
        fetch: {
          timegrid: fetchFlags.fetchTimegrid,
          timetable: fetchFlags.fetchTimetable,
          exams: fetchFlags.fetchExams,
          homework: fetchFlags.fetchHomeworks,
          absences: fetchFlags.fetchAbsences,
          messages: fetchFlags.fetchMessagesOfDay,
        },
      },
    };
  },

  _buildApiStatusSnapshot(sessionKey) {
    const rawApiStatus = this._apiStatusBySession.get(sessionKey) || {};
    const apiStatus = {
      timetable: null,
      exams: null,
      homework: null,
      absences: null,
      messages: null,
    };

    Object.entries(rawApiStatus).forEach(([endpoint, record]) => {
      const status = typeof record === 'object' ? record?.status : record;
      if (!Number.isFinite(Number(status))) return;
      if (endpoint === 'messagesofday') {
        apiStatus.messages = Number(status);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(apiStatus, endpoint)) {
        apiStatus[endpoint] = Number(status);
      }
    });

    return apiStatus;
  },

  _buildWarningMetaFromMessages(messages, groupWarningMetaByMessage, fallbackMeta) {
    return messages.map(
      (message) =>
        groupWarningMetaByMessage.get(message) || {
          message,
          ...(fallbackMeta || { kind: 'generic', severity: 'warning' }),
        }
    );
  },

  _mergeGroupWarningsIntoPayload(payload, identifier, groupWarnings, groupWarningMetaByMessage) {
    const uniqWarnings = Array.from(new Set(groupWarnings));
    const mergedWarnings = Array.from(new Set([...(payload?.state?.warnings || []), ...uniqWarnings]));

    const mergedWarningMetaByMessage = new Map();
    (Array.isArray(payload?.state?.warningMeta) ? payload.state.warningMeta : []).forEach((entry) => {
      if (!entry?.message) return;
      mergedWarningMetaByMessage.set(String(entry.message), { ...entry });
    });

    uniqWarnings.forEach((message) => {
      const existing = mergedWarningMetaByMessage.get(message) || null;
      const groupMeta = groupWarningMetaByMessage.get(message) || null;
      if (!existing || (existing.kind === 'generic' && groupMeta)) {
        mergedWarningMetaByMessage.set(message, {
          message,
          ...(groupMeta || { kind: 'generic', severity: 'warning' }),
        });
      }
    });

    return {
      ...payload,
      id: identifier,
      state: {
        ...(payload.state || {}),
        warnings: mergedWarnings,
        warningMeta: mergedWarnings.map(
          (message) =>
            mergedWarningMetaByMessage.get(message) || {
              message,
              kind: 'generic',
              severity: 'warning',
            }
        ),
      },
    };
  },

  _buildStudentErrorPayload({
    identifier,
    sessionId,
    sessionKey,
    student,
    config,
    warnings,
    groupWarningMetaByMessage,
    warningFallbackMeta,
    includeApiSnapshot,
  }) {
    const effectiveDisplayMode = student?.displayMode || config?.displayMode;
    const fetchFlags = this._buildFetchFlags(effectiveDisplayMode);
    const basePayload = this._buildBaseStudentPayload({
      identifier,
      sessionId,
      student,
      config,
      fetchFlags,
    });

    return {
      ...basePayload,
      state: {
        ...basePayload.state,
        api: includeApiSnapshot
          ? this._buildApiStatusSnapshot(sessionKey)
          : {
              timetable: null,
              exams: null,
              homework: null,
              absences: null,
              messages: null,
            },
        warnings,
        warningMeta: this._buildWarningMetaFromMessages(warnings, groupWarningMetaByMessage, warningFallbackMeta),
      },
    };
  },

  _emitStudentAuthFailurePayloads({ identifier, sessionId, sessionKey, students, config, warnings, groupWarningMetaByMessage }) {
    students.forEach((student) => {
      this._emitGotData(
        this._buildStudentErrorPayload({
          identifier,
          sessionId,
          sessionKey,
          student,
          config,
          warnings,
          groupWarningMetaByMessage,
          warningFallbackMeta: { kind: 'generic', severity: 'warning' },
          includeApiSnapshot: false,
        })
      );
    });
  },

  _buildStudentFetchErrorPayload({
    identifier,
    sessionId,
    sessionKey,
    student,
    config,
    groupWarnings,
    warningMsg,
    groupWarningMetaByMessage,
    warningMetaBase,
  }) {
    const mergedWarnings = Array.from(new Set([...(groupWarnings || []), ...(warningMsg ? [warningMsg] : [])]));

    return this._buildStudentErrorPayload({
      identifier,
      sessionId,
      sessionKey,
      student,
      config,
      warnings: mergedWarnings,
      groupWarningMetaByMessage,
      warningFallbackMeta: warningMetaBase,
      includeApiSnapshot: true,
    });
  },

  _createGroupWarningCollector() {
    const groupWarnings = [];
    const groupWarningMetaByMessage = new Map();
    const currentFetchWarnings = new Set();

    return {
      groupWarnings,
      groupWarningMetaByMessage,
      currentFetchWarnings,
      addGroupWarning: (message, meta = {}) => {
        if (!message) return;
        if (!currentFetchWarnings.has(message)) {
          groupWarnings.push(message);
          currentFetchWarnings.add(message);
        }

        if (!groupWarningMetaByMessage.has(message)) {
          groupWarningMetaByMessage.set(message, {
            kind: 'generic',
            severity: 'warning',
            ...meta,
          });
        }
      },
    };
  },

  _handleProcessGroupAuthFailure({ err, credKey, identifier, sessionKey, students, config, sessionId, warningsState }) {
    const errorMsg = this._formatErr(err);
    const isNetworkError = this._isNetworkError(err);
    const msg = isNetworkError
      ? `Cannot reach WebUntis server for ${credKey}: ${errorMsg}`
      : `Authentication failed for ${credKey}: ${errorMsg}`;

    this._mmLog('error', null, msg);

    const authService = config?._authService || this._getAuthServiceForIdentifier(identifier);
    if (authService && typeof authService.invalidateAllCachesForSession === 'function') {
      authService.invalidateAllCachesForSession(sessionKey);
      this._mmLog('warn', null, `[REAUTH] Triggered complete re-authentication for session ${sessionKey} due to auth failure`);
    }

    warningsState.addGroupWarning(msg, this._classifyWarningMetaFromError(err, { kind: isNetworkError ? 'network' : 'auth' }));
    this._emitStudentAuthFailurePayloads({
      identifier,
      sessionId,
      sessionKey,
      students,
      config,
      warnings: warningsState.groupWarnings,
      groupWarningMetaByMessage: warningsState.groupWarningMetaByMessage,
    });
  },

  async _collectStudentPayloadsForGroup({
    students,
    authSession,
    identifier,
    credKey,
    compactHolidays,
    config,
    sessionKey,
    sessionId,
    warningsState,
  }) {
    const studentPayloads = [];

    for (const student of students) {
      try {
        const studentValidationWarnings = this._validateStudentConfig(student);
        if (studentValidationWarnings.length > 0) {
          studentValidationWarnings.forEach((warning) => {
            this._mmLog('warn', student, warning);
            warningsState.addGroupWarning(warning, { kind: 'config', severity: 'warning' });
          });
        }

        const payload = await this.fetchData({
          authSession,
          student,
          identifier,
          credKey,
          compactHolidays,
          config,
          sessionKey,
          currentFetchWarnings: warningsState.currentFetchWarnings,
        });

        if (!payload) {
          this._mmLog('warn', student, `fetchData returned empty payload for ${student.title}`);
          continue;
        }

        const nextPayload = this._mergeGroupWarningsIntoPayload(
          payload,
          identifier,
          warningsState.groupWarnings,
          warningsState.groupWarningMetaByMessage
        );
        studentPayloads.push(nextPayload);
      } catch (err) {
        const errorMsg = `Error fetching data for ${student.title}: ${this._formatErr(err)}`;
        this._mmLog('error', student, errorMsg);

        const warningMsg = WebUntisClient.convertRestErrorToWarning(err, {
          studentTitle: student.title,
          school: student.school || config?.school,
          server: student.server || config?.server || 'webuntis.com',
        });
        if (warningMsg) {
          warningsState.addGroupWarning(warningMsg, this._classifyWarningMetaFromError(err));
          this._mmLog('warn', student, warningMsg);
        }
        const warningMetaBase = this._classifyWarningMetaFromError(err);

        studentPayloads.push(
          this._buildStudentFetchErrorPayload({
            identifier,
            sessionId,
            sessionKey,
            student,
            config,
            groupWarnings: warningsState.groupWarnings,
            warningMsg,
            groupWarningMetaByMessage: warningsState.groupWarningMetaByMessage,
            warningMetaBase,
          })
        );
      }
    }

    return studentPayloads;
  },

  _emitStudentPayloadsForGroup(studentPayloads, identifier, sessionId) {
    for (const payload of studentPayloads) {
      this._emitGotData(payload, {
        identifier,
        sessionId,
      });
    }
  },

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
    let authSession;
    const sample = students[0];
    const warningsState = this._createGroupWarningCollector();

    try {
      const { sessionId } = this._parseSessionKey(sessionKey);

      try {
        authSession = await this._createAuthSession(sample, config, identifier, credKey);
      } catch (err) {
        this._handleProcessGroupAuthFailure({
          err,
          credKey,
          identifier,
          sessionKey,
          students,
          config,
          sessionId,
          warningsState,
        });
        return;
      }

      const { fetchTimegrid: shouldFetchHolidays } = this._buildFetchFlags(config?.displayMode);
      const sharedCompactHolidays = this._extractAndCompactHolidays(authSession, shouldFetchHolidays);

      const studentPayloads = await this._collectStudentPayloadsForGroup({
        students,
        authSession,
        identifier,
        credKey,
        compactHolidays: sharedCompactHolidays,
        config,
        sessionKey,
        sessionId,
        warningsState,
      });

      this._emitStudentPayloadsForGroup(studentPayloads, identifier, sessionId);
    } catch (error) {
      this._mmLog('error', null, `Error during login/fetch for group ${credKey}: ${this._formatErr(error)}`);
      const authMsg = `Authentication failed for group: ${this._formatErr(error)}`;
      warningsState.addGroupWarning(authMsg, this._classifyWarningMetaFromError(error, { kind: 'auth' }));
    }
  },

  /**
   * Handle socket notifications sent by the frontend module
   * Main entry point for all frontend-to-backend communication
   *
   * Listens for:
   *   - INIT_MODULE: First-time module initialization (config validation, student discovery)
   *   - FETCH_DATA: Data refresh request (periodic updates, manual refresh)
   *   - SESSION_STATE: Per-session lifecycle state updates (paused/active)
   *
   * @param {string} notification - Notification name (INIT_MODULE, FETCH_DATA, SESSION_STATE)
   * @param {any} payload - Notification payload (config object, refresh request)
   * @returns {Promise<void>}
   */
  async socketNotificationReceived(notification, payload) {
    const handlers = {
      INIT_MODULE: async () => this._handleInitModule(payload),
      FETCH_DATA: async () => this._handleFetchData(payload),
      SESSION_STATE: async () => this._handleSessionState(payload),
    };

    const handler = handlers[notification];
    if (!handler) return;
    await handler();
  },

  /**
   * Send GOT_DATA payload with consistent id/session routing metadata.
   *
   * @param {Object} payload - GOT_DATA payload
   * @param {Object} [route] - Optional route metadata override
   * @param {string} [route.identifier] - Module identifier
   * @param {string} [route.sessionId] - Session ID
   */
  _emitGotData(payload, route = {}) {
    if (!payload || typeof payload !== 'object') return;

    const nextPayload = { ...payload };
    if (route.identifier) nextPayload.id = route.identifier;
    if (route.sessionId) nextPayload.sessionId = route.sessionId;

    this.sendSocketNotification('GOT_DATA', nextPayload);
  },

  /**
   * Send INIT_ERROR with consistent routing metadata.
   *
   * @param {Object} payload - INIT_ERROR payload
   * @param {Object} [route] - Optional route metadata override
   * @param {string} [route.identifier] - Module identifier
   * @param {string} [route.sessionId] - Session ID
   */
  _emitInitError(payload, route = {}) {
    if (!payload || typeof payload !== 'object') return;

    const nextPayload = { ...payload };
    if (route.identifier && !nextPayload.id) nextPayload.id = route.identifier;
    if (route.sessionId && !nextPayload.sessionId) nextPayload.sessionId = route.sessionId;

    this.sendSocketNotification('INIT_ERROR', nextPayload);
  },

  /**
   * Send MODULE_INITIALIZED with consistent routing metadata.
   *
   * @param {Object} payload - MODULE_INITIALIZED payload
   * @param {Object} [route] - Optional route metadata override
   * @param {string} [route.identifier] - Module identifier
   * @param {string} [route.sessionId] - Session ID
   */
  _emitModuleInitialized(payload, route = {}) {
    if (!payload || typeof payload !== 'object') return;

    const nextPayload = { ...payload };
    if (route.identifier && !nextPayload.id) nextPayload.id = route.identifier;
    if (route.sessionId && !nextPayload.sessionId) nextPayload.sessionId = route.sessionId;

    this.sendSocketNotification('MODULE_INITIALIZED', nextPayload);
  },

  /**
   * Track frontend lifecycle state per session (suspend/resume)
   * so backend can guard against cross-session/background fetches.
   *
   * @param {Object} payload - Session state payload ({id, sessionId, state, reason})
   */
  _handleSessionState(payload = {}) {
    const identifier = payload.id || 'default';
    const sessionId = payload.sessionId || 'unknown';
    const state = payload.state === 'active' ? 'active' : 'paused';
    const reason = payload.reason || 'unspecified';
    const sessionKey = `${identifier}:${sessionId}`;

    if (state === 'paused') {
      this._pausedSessions.add(sessionKey);
    } else {
      this._pausedSessions.delete(sessionKey);
    }

    this._mmLog('debug', null, `[SESSION_STATE] ${state} (id=${identifier}, session=${sessionId}, reason=${reason})`);
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
      const result = this._normalizeLegacyConfig(payloadCopy);
      normalizedConfig = result.normalizedConfig;
      const legacyUsed = result.legacyUsed;

      identifier = normalizedConfig.id || 'default';
      const sessionId = payload.sessionId || 'unknown';
      const initReason = payload?.reason || 'unspecified';
      // Session key format: "identifier:sessionId" for complete browser-window isolation
      sessionKey = `${identifier}:${sessionId}`;

      this._mmLog('info', null, `[INIT_MODULE] Received (id=${identifier}, session=${sessionId}, reason=${initReason})`);

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
        this._emitInitError(
          {
            errors,
            warnings: combinedWarnings,
            warningMeta: this._buildWarningMetaEntries(combinedWarnings, { kind: 'config', severity: 'warning' }),
            severity: 'ERROR',
            message: 'Configuration validation failed',
          },
          {
            identifier,
            sessionId: payload.sessionId,
          }
        );
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
      this._emitModuleInitialized(
        {
          config: normalizedConfig,
          warnings: combinedWarnings,
          warningMeta: this._buildWarningMetaEntries(combinedWarnings, { kind: 'config', severity: 'warning' }),
          students: normalizedConfig.students || [],
        },
        {
          identifier,
          sessionId: payload.sessionId,
        }
      );

      // Automatically trigger initial data fetch after successful initialization
      // This eliminates the need for frontend (and CLI) to send FETCH_DATA immediately after MODULE_INITIALIZED
      // Simplifies the initialization flow: INIT_MODULE -> MODULE_INITIALIZED + GOT_DATA
      await this._handleFetchData({
        ...normalizedConfig,
        id: identifier,
        sessionId: payload.sessionId,
        reason: 'post-init-auto-fetch',
      });
    } catch (error) {
      this._mmLog('error', null, `[INIT_MODULE] Initialization failed: ${this._formatErr(error)}`);
      this._emitInitError(
        {
          errors: [error.message || 'Unknown initialization error'],
          warnings: [],
          severity: 'ERROR',
          message: 'Module initialization failed',
        },
        {
          identifier: identifier || 'unknown',
          sessionId: payload?.sessionId,
        }
      );
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
    const fetchReason = payload?.reason || 'unspecified';
    const sessionKey = `${identifier}:${sessionId}`;

    this._mmLog('debug', null, `[FETCH_DATA] Received (id=${identifier}, session=${sessionId}, reason=${fetchReason})`);

    if (this._pausedSessions.has(sessionKey)) {
      this._mmLog('debug', null, `[FETCH_DATA] Ignored for paused session (id=${identifier}, session=${sessionId}, reason=${fetchReason})`);
      return;
    }

    // Track FETCH_DATA requests to debug duplicate calls (silently)
    const fetchTimestamp = Date.now();
    this._lastFetchTimestamp = fetchTimestamp;

    // Verify module is initialized and ensure session-specific config exists.
    let normalizedConfig = this._getOrCreateSessionConfig(sessionKey, identifier);
    if (!normalizedConfig) {
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
    const { identifier: sessionIdentifier } = this._parseSessionKey(sessionKey);
    const config = this._getOrCreateSessionConfig(sessionKey, sessionIdentifier);
    if (!config) {
      this._mmLog('warn', null, `Session ${sessionKey} not found, skipping fetch`);
      return;
    }

    // Get AuthService reference (already initialized during INIT_MODULE)
    config._authService = this._getAuthServiceForIdentifier(sessionIdentifier);

    try {
      // AGGRESSIVE REAUTH: Wait for any session-wide authentication to complete
      // This ensures all API requests are blocked until complete re-authentication finishes
      // Prevents cascading failures from expired/corrupted tokens
      const authService = config._authService;
      if (authService && typeof authService.waitForSessionAuth === 'function') {
        await authService.waitForSessionAuth(sessionKey);
      }

      const groups = new Map();

      const studentsList = Array.isArray(config.students) ? config.students : [];
      for (const student of studentsList) {
        const credKey = this._getCredentialKey(student, config, sessionKey);
        if (!groups.has(credKey)) groups.set(credKey, []);
        groups.get(credKey).push(student);
      }

      for (const [credKey, students] of groups.entries()) {
        // If the same scoped credential group is already being fetched, wait for that
        // fetch to finish before starting the next one.
        const pendingFetch = this._pendingFetchByCredKey.get(credKey);
        if (pendingFetch) {
          this._mmLog('debug', null, `Session ${sessionKey}: Another fetch is in progress for credKey=${credKey}, waiting...`);
          await pendingFetch;
        }

        const inFlightFetch = this.processGroup(credKey, students, sessionIdentifier, sessionKey, config);
        this._pendingFetchByCredKey.set(credKey, inFlightFetch);

        try {
          await inFlightFetch;
        } finally {
          if (this._pendingFetchByCredKey.get(credKey) === inFlightFetch) {
            this._pendingFetchByCredKey.delete(credKey);
          }
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

    // Sort unique start times chronologically using shared HHMM normalization
    const sortedStarts = Array.from(startTimes).sort((a, b) => {
      const timeA = WebUntisClient.normalizeTimeToHHMM(a) || 0;
      const timeB = WebUntisClient.normalizeTimeToHHMM(b) || 0;
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
   * Delegates orchestrating, API calls, and payload creation to WebUntisClient.
   *
   * @param {Object} params - Fetch parameters
   * @param {Object} params.authSession - Authenticated session with server, school, cookies, token
   * @param {Object} params.student - Student config object
   * @param {string} params.identifier - Module instance identifier
   * @param {string} params.credKey - Credential grouping key
   * @param {Array} [params.compactHolidays] - Pre-extracted and compacted holidays (shared across students in group)
   * @param {Object} params.config - Module configuration
   * @param {string} params.sessionKey - Session key for API status tracking
   * @returns {Promise<Object|null>} GOT_DATA payload object or null on error
   */
  async fetchData(params) {
    const { authSession, student, identifier, credKey, compactHolidays = [], config, sessionKey, currentFetchWarnings } = params || {};

    if (!authSession || !student || !identifier || !credKey || !config || !sessionKey) {
      throw new Error('fetchData requires authSession, student, identifier, credKey, config, and sessionKey');
    }

    const effectiveDisplayMode = student.displayMode || config.displayMode;
    const fetchFlags = this._buildFetchFlags(effectiveDisplayMode);
    const baseNow = this._calculateBaseNow(config);
    const dateRanges = calculateFetchRanges({
      baseNow,
      fetchPlan: {
        wantsGridWidget: Boolean(fetchFlags.wantsGridWidget),
        wantsLessonsWidget: Boolean(fetchFlags.wantsLessonsWidget),
        fetchExams: Boolean(fetchFlags.fetchExams),
        fetchAbsences: Boolean(fetchFlags.fetchAbsences),
      },
      days: {
        globalPastDays: student.pastDays,
        globalNextDays: student.nextDays,
        gridPastDays: student.grid?.pastDays,
        gridNextDays: student.grid?.nextDays,
        lessonsPastDays: student.lessons?.pastDays,
        lessonsNextDays: student.lessons?.nextDays,
        examsPastDays: student.exams?.pastDays ?? student.pastDays,
        examsNextDays: student.exams?.nextDays,
        absencesPastDays: student.absences?.pastDays,
        absencesNextDays: student.absences?.nextDays,
        homeworkPastDays: student.homework?.pastDays,
        homeworkNextDays: student.homework?.nextDays,
      },
      options: {
        gridWeekView: student.grid?.weekView,
        debugDateEnabled: Boolean(config && typeof config.debugDate === 'string' && config.debugDate),
      },
    });

    const client = new WebUntisClient({
      mmLog: this._mmLog.bind(this),
      formatErr: this._formatErr.bind(this),
      extractTimegridFromTimetable: this._extractTimegridFromTimetable.bind(this),
      compactTimegrid: this._compactTimegrid.bind(this),
      cleanupOldDebugDumps: this._cleanupOldDebugDumps.bind(this),
      getApiStatus: (key) => {
        const raw = this._apiStatusBySession.get(key) || {};
        // Normalize to plain status numbers for frontend consumption
        const result = {};
        for (const [ep, record] of Object.entries(raw)) {
          result[ep] = typeof record === 'object' ? record.status : record;
        }
        return result;
      },
      shouldSkipApi: this._shouldSkipApi.bind(this),
      recordApiStatusFromError: this._recordApiStatusFromError.bind(this),
      setApiStatus: (key, endpoint, status) => {
        if (!this._apiStatusBySession.has(key)) {
          this._apiStatusBySession.set(key, {});
        }
        this._apiStatusBySession.get(key)[endpoint] = { status, recordedAt: Date.now() };
      },
    });

    return client.fetchStudentData({
      authSession,
      student,
      identifier,
      credKey,
      compactHolidays,
      config,
      plan: {
        authService: config._authService,
        homeworkFilter: {
          pastDays: student.homework?.pastDays,
          nextDays: student.homework?.nextDays,
        },
        fetchFlags: {
          fetchTimegrid: Boolean(fetchFlags.fetchTimegrid),
          fetchTimetable: Boolean(fetchFlags.fetchTimetable),
          fetchExams: Boolean(fetchFlags.fetchExams),
          fetchHomeworks: Boolean(fetchFlags.fetchHomeworks),
          fetchAbsences: Boolean(fetchFlags.fetchAbsences),
          fetchMessagesOfDay: Boolean(fetchFlags.fetchMessagesOfDay),
        },
        baseNow,
        dateRanges,
        flagsCtx: {
          debugApi: Boolean(config.debugApi),
          dumpRawApiResponses: Boolean(config.dumpRawApiResponses),
        },
      },
      sessionKey,
      currentFetchWarnings,
    });
  },
});
