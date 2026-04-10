/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const fetchClient = require('./fetchClient');
const { URL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const HttpClient = require('./httpClient');
const { tryOrNull, tryOrDefault, tryOrThrow } = require('./errorUtils');

// API timeout constant (15 seconds)
const API_TIMEOUT_MS = 15000;

const ROLE = Object.freeze({
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  LEGAL_GUARDIAN: 'LEGAL_GUARDIAN',
});

const ROLE_ALIASES = new Map([
  ['ROLE_TEACHER', ROLE.TEACHER],
  ['TEACHER', ROLE.TEACHER],
  ['DOZENT', ROLE.TEACHER],
  ['ROLE_STUDENT', ROLE.STUDENT],
  ['STUDENT', ROLE.STUDENT],
  ['PUPIL', ROLE.STUDENT],
  ['ROLE_LEGAL_GUARDIAN', ROLE.LEGAL_GUARDIAN],
  ['LEGAL_GUARDIAN', ROLE.LEGAL_GUARDIAN],
  ['GUARDIAN', ROLE.LEGAL_GUARDIAN],
  ['PARENT', ROLE.LEGAL_GUARDIAN],
  ['ELTERN', ROLE.LEGAL_GUARDIAN],
]);

const AUTH_CACHE_KEY_KINDS = new Set(['PARENT', 'QRCODE', 'USER', 'STUDENT']);

// Auth timing constants
const TOKEN_TTL_MS = 14 * 60 * 1000; // 14 minutes - WebUntis token lifetime
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // 5 minutes - safety buffer to prevent expired token usage

class AuthService {
  constructor(options = {}) {
    // Keep logger injection as the primary path to avoid coupling to module-level logger utilities.
    this.logger =
      typeof options.logger === 'function'
        ? options.logger
        : (level, message) => {
            console.log(`[AuthService] [${level || 'debug'}]`, message);
          };
    this.httpClient = new HttpClient({ logger: this.logger });
    // Cache structure: { token, cookieString, tenantId, schoolYearId, appData, rawAppData, personId, role, school, server, expiresAt, lastCookieValidation }
    this._authCache = new Map();
    this._pendingAuth = new Map(); // cacheKey -> Promise (for race condition protection)
    this._pendingAuthBySession = new Map(); // sessionKey -> Promise (for session-wide auth blocking)
    this._forceReauth = new Set(); // cacheKey set to force next auth to skip cache
    // Cookie validation interval - only revalidate cookies every 5 minutes to maintain cache performance
    this.COOKIE_VALIDATION_INTERVAL = TOKEN_BUFFER_MS; // 5 minutes
  }

  /**
   * Extract person_id from JWT bearer token
   * @param {string} token - JWT bearer token
   * @returns {number|null} person_id from token payload, or null if not found
   */
  extractPersonIdFromToken(token) {
    if (!token || typeof token !== 'string') return null;

    return tryOrNull(
      () => {
        const parts = token.split('.');
        if (parts.length !== 3) throw new Error('Invalid JWT format');

        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        const personId = Number(payload.person_id);

        if (!Number.isFinite(personId)) throw new Error('person_id not found in token');
        return personId;
      },
      (msg) => this.logger('debug', `[AuthService] Extract person_id: ${msg}`)
    );
  }

  /**
   * Get REST API authentication via QR code
   * @param {string} qrCodeUrl - QR code URL from WebUntis
   * @param {Object} options - Additional options (cacheKey)
   * @returns {Promise<Object>} { token, cookieString, tenantId, schoolYearId, appData, personId, school, server }
   */
  async getAuthFromQRCode(qrCodeUrl, options = {}) {
    const { cacheKey } = options;
    const effectiveCacheKey = cacheKey || `qrcode:${qrCodeUrl}`;

    // Force cache invalidation if dumpRawApiResponses is enabled (to get fresh raw app/data)
    if (options.dumpRawApiResponses && this._authCache.has(effectiveCacheKey)) {
      this.logger('debug', '[AuthService] dumpRawApiResponses=true, invalidating QR cache to force fresh app/data fetch');
      this._authCache.delete(effectiveCacheKey);
    }

    // Check cache (unless a forced reauth was requested)
    const forceReauth = this._forceReauth.has(effectiveCacheKey);
    if (forceReauth) {
      this.logger('info', '[AuthService] QR Auth: forceReauth flag set, skipping cache');
      this._authCache.delete(effectiveCacheKey);
      this._pendingAuth.delete(effectiveCacheKey);
      this._forceReauth.delete(effectiveCacheKey);
    }

    const cached = forceReauth ? null : this._authCache.get(effectiveCacheKey);
    this.logger(
      'debug',
      `[AuthService] QR code cache check: ${cached ? `found (expires in ${Math.round((cached.expiresAt - Date.now()) / 1000)}s)` : 'not found'}${
        forceReauth ? ' (forced reauth)' : ''
      }`
    );
    // Use token if it has at least 5 minutes remaining
    // This prevents issues where parallel requests use a token that expires during execution
    // and also prevents silent API failures (some endpoints return 200 OK with empty data for expired tokens)
    if (cached && cached.expiresAt > Date.now() + TOKEN_BUFFER_MS) {
      // Return cached data without token refresh attempts
      // Any auth errors will trigger full re-authentication via onAuthError callback
      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        personId: cached.personId,
        role: cached.role || null,
        school: cached.school,
        server: cached.server,
        appData: cached.appData || null,
      };
    }

    // Race condition protection: if auth is already in progress, wait for it
    if (this._pendingAuth.has(effectiveCacheKey)) {
      this.logger('debug', '[AuthService] Authentication already in progress, waiting...');
      return await this._pendingAuth.get(effectiveCacheKey);
    }

    // Create a promise for this auth request
    const authPromise = this._performQRAuth(effectiveCacheKey, qrCodeUrl, cached, {
      ...options,
      skipRefresh: forceReauth,
    });
    this._pendingAuth.set(effectiveCacheKey, authPromise);

    try {
      const result = await authPromise;
      return result;
    } finally {
      // Clean up pending auth after completion
      this._pendingAuth.delete(effectiveCacheKey);
    }
  }

  /**
   * Perform QR code authentication (internal method)
   * @private
   */
  async _performQRAuth(effectiveCacheKey, qrCodeUrl, cached, options = {}) {
    // Extract user from QR code URL for logging
    let userFromQR = null;
    try {
      const url = new URL(qrCodeUrl);
      userFromQR = url.searchParams.get('user');
    } catch {
      // Ignore URL parsing errors
    }

    // Full QR code authentication (fail-fast)
    const userInfo = userFromQR ? ` [${userFromQR}]` : '';
    this.logger('info', `[AuthService]${userInfo} QR Auth: Starting authentication (cached=${cached ? 'exists' : 'null'})`);
    const performQRAuth = async () => {
      const authResult = await this.httpClient.authenticateWithQRCode(qrCodeUrl);
      const { cookies, personId, school, server } = authResult;

      // Get Bearer token
      const token = await this.httpClient.getBearerToken(server, cookies);

      // Fetch app/data to get tenantId and schoolYearId
      const metadata = await this._fetchAppData(server, cookies, token, options);
      const role = this._extractRoleFromAppData(metadata.appData);

      // Cache the result
      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString: cookies,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        personId,
        school,
        server,
        appData: metadata.appData,
        rawAppData: metadata.rawAppData || null,
        role: role || null,
        expiresAt: Date.now() + TOKEN_TTL_MS,
        lastCookieValidation: Date.now(), // Set initial validation timestamp for QR auth
      });

      // QR auth successful - no log needed
      // Clear forceReauth flag on success
      this._forceReauth.delete(effectiveCacheKey);
      return {
        token,
        cookieString: cookies,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        personId,
        school,
        server,
        appData: metadata.appData,
        role: role || null,
      };
    };

    return tryOrThrow(performQRAuth, (msg) => this.logger('error', `[AuthService] QR code authentication failed: ${msg}`));
  }

  /**
   * Get REST API authentication (bearer token + cookies)
   * @param {Object} params - Authentication parameters
   * @param {string} params.school - School identifier
   * @param {string} params.username - Username for authentication
   * @param {string} params.password - Password for authentication
   * @param {string} params.server - WebUntis server hostname
   * @param {Object} params.options - Additional options (cacheKey, untisClient)
   * @returns {Promise<Object>} { token, cookieString, tenantId, schoolYearId, appData }
   */
  async getAuth({ school, username, password, server, options = {} }) {
    const { cacheKey } = options;
    const effectiveCacheKey = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;

    const forceReauth = this._forceReauth.has(effectiveCacheKey);
    if (forceReauth) {
      this.logger('info', '[AuthService] REST auth: forceReauth flag set, skipping cache and authSession reuse');
      this._authCache.delete(effectiveCacheKey);
      // Do NOT delete _pendingAuth here - let parallel requests wait for the first auth to complete
      // Only clear the forceReauth flag so it doesn't affect subsequent requests
      this._forceReauth.delete(effectiveCacheKey);
    }

    // Force cache invalidation if dumpRawApiResponses is enabled (to get fresh raw app/data)
    if (options.dumpRawApiResponses && this._authCache.has(effectiveCacheKey)) {
      this.logger('debug', '[AuthService] dumpRawApiResponses=true, invalidating cache to force fresh app/data fetch');
      this._authCache.delete(effectiveCacheKey);
    }

    // If forceReauth was requested and a QR code is available, jump straight to QR auth to avoid reusing stale cookies
    if (forceReauth && options.qrCodeUrl) {
      return this.getAuthFromQRCode(options.qrCodeUrl, {
        cacheKey: effectiveCacheKey,
        dumpRawApiResponses: options.dumpRawApiResponses,
      });
    }

    // Check cache - use token only if it has at least 5 minutes remaining
    // This 5-minute buffer prevents issues where parallel requests use a token
    // that expires during their execution, and also prevents silent API failures
    // (some WebUntis endpoints return 200 OK with empty arrays for expired tokens
    // instead of 401, leading to missing data without error indication)
    const cached = forceReauth ? null : this._authCache.get(effectiveCacheKey);
    if (cached && cached.expiresAt > Date.now() + TOKEN_BUFFER_MS) {
      // Optionally dump cached appData when requested (helps debugging when cache was populated earlier)
      try {
        const maybeOptions = options || {};
        if (maybeOptions.dumpRawApiResponses) {
          if (cached.rawAppData) {
            this._writeDebugDump(server, 'appdata_cached_raw', cached.rawAppData, 'cached raw app/data');
          } else if (cached.appData) {
            this._writeDebugDump(server, 'appdata_cached_compacted', cached.appData, 'cached compacted app/data');
          }
        }
      } catch (err) {
        this.logger('debug', `[AuthService] Failed to dump cached appData: ${err?.message ? err.message : err}`);
      }

      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        appData: cached.appData,
        personId: cached.personId,
        role: cached.role || null,
        school: cached.school,
        server: cached.server,
      };
    }

    // Race condition protection: if auth is already in progress, wait for it
    if (this._pendingAuth.has(effectiveCacheKey)) {
      // Waiting for pending auth silently (common during parallel requests)
      return await this._pendingAuth.get(effectiveCacheKey);
    }

    // Create a promise for this auth request
    const authPromise = this._performAuth(effectiveCacheKey, school, username, password, server, {
      ...options,
      forceReauth,
    });
    this._pendingAuth.set(effectiveCacheKey, authPromise);

    try {
      const result = await authPromise;
      return result;
    } finally {
      // Clean up pending auth after completion
      this._pendingAuth.delete(effectiveCacheKey);
    }
  }

  /**
   * Perform authentication (internal method)
   * @private
   */
  _cacheAuthResult(effectiveCacheKey, resultObject, rawAppData = null) {
    this._authCache.set(effectiveCacheKey, {
      ...resultObject,
      rawAppData: rawAppData || null,
      expiresAt: Date.now() + TOKEN_TTL_MS,
      lastCookieValidation: Date.now(),
    });
  }

  _writeDebugDump(server, fileSuffix, payload, logLabel) {
    const dumpDir = path.join(__dirname, '..', '..', 'debug_dumps');
    fs.mkdirSync(dumpDir, { recursive: true });
    const serverSafe = String(server || 'server').replace(/[^a-z0-9.-]/gi, '_');
    const filename = `raw_api_${Date.now()}_${serverSafe}_${fileSuffix}.json`;
    const filePath = path.join(dumpDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: 'utf8' });
    this.logger('debug', `[AuthService] Wrote ${logLabel} to ${filePath}`);
  }

  async _performAuthFromSession(effectiveCacheKey, school, server, authSession, options) {
    const metadata =
      authSession.appData && !options.dumpRawApiResponses
        ? {
            tenantId: authSession.tenantId,
            schoolYearId: authSession.schoolYearId,
            appData: authSession.appData,
          }
        : await this._fetchAppData(server || authSession.server, authSession.cookieString, authSession.token, options);

    const personId = authSession.personId || metadata.appData?.user?.person?.id || null;
    const role = this._extractRoleFromAppData(metadata.appData);

    const result = {
      token: authSession.token,
      cookieString: authSession.cookieString,
      tenantId: metadata.tenantId,
      schoolYearId: metadata.schoolYearId,
      appData: metadata.appData,
      personId,
      role,
      school: authSession.school || school,
      server: authSession.server || server,
    };

    this._cacheAuthResult(effectiveCacheKey, result, metadata.rawAppData || null);
    return result;
  }

  async _performAuthFromUntisClient(effectiveCacheKey, untisClient, server, options) {
    const cookieString = untisClient._buildCookies();
    if (!cookieString) {
      throw new Error('No session cookies available from existing login');
    }

    let token = null;
    if (typeof untisClient._getJWT === 'function') {
      token = await tryOrDefault(
        async () => untisClient._getJWT(false),
        null,
        (err) => this.logger('debug', `[REST] JWT via existing session: ${err}`)
      );
    }

    if (!token) {
      token = await tryOrDefault(
        async () => this.httpClient.getBearerToken(server, cookieString),
        null,
        (err) => this.logger('debug', `[REST] Bearer token via httpClient: ${err}`)
      );
    }

    const metadata = await this._fetchAppData(server, cookieString, token, options);
    const appData = metadata.appData;
    const personId = appData?.user?.person?.id || null;

    const result = {
      token,
      cookieString,
      tenantId: metadata.tenantId,
      schoolYearId: metadata.schoolYearId,
      appData,
      personId,
    };

    this._cacheAuthResult(effectiveCacheKey, result, metadata.rawAppData || null);
    return result;
  }

  async _performAuthFromCredentials(effectiveCacheKey, school, username, password, server, options) {
    const authResult = await this.httpClient.authenticateWithCredentials({
      school,
      username,
      password,
      server,
    });

    const cookieString = authResult.cookies;
    if (!cookieString) {
      throw new Error('No session cookies received');
    }

    const token = await this.httpClient.getBearerToken(server, cookieString);
    const metadata = await this._fetchAppData(server, cookieString, token, options);
    const appData = metadata.appData;
    const personId = appData?.user?.person?.id || null;
    const role = this._extractRoleFromAppData(metadata.appData);

    const resultObject = {
      token,
      cookieString,
      tenantId: metadata.tenantId,
      schoolYearId: metadata.schoolYearId,
      appData,
      personId,
      role,
    };

    this._cacheAuthResult(effectiveCacheKey, resultObject, metadata.rawAppData || null);
    return resultObject;
  }

  async _performAuth(effectiveCacheKey, school, username, password, server, options) {
    const { untisClient } = options;
    const forceReauth = Boolean(options.forceReauth);
    const authSession = forceReauth ? null : options.authSession;

    if (!forceReauth && authSession?.token && authSession?.cookieString) {
      return this._performAuthFromSession(effectiveCacheKey, school, server, authSession, options);
    }

    if (untisClient && typeof untisClient._buildCookies === 'function') {
      return this._performAuthFromUntisClient(effectiveCacheKey, untisClient, server, options);
    }

    if (!username) {
      throw new Error('No username specified and no existing session available');
    }

    const performRestAuth = () => this._performAuthFromCredentials(effectiveCacheKey, school, username, password, server, options);

    return tryOrThrow(performRestAuth, (msg) => this.logger('error', `[AuthService] REST auth failed: ${msg}`));
  }

  /**
   * Invalidate cached authentication for a specific cache key
   * Used when token expires or authentication fails
   * Also clears any pending auth requests to force fresh authentication
   * @param {string} cacheKey - Cache key to invalidate
   */
  invalidateCache(cacheKey) {
    if (!cacheKey) {
      this.logger('warn', `[AuthService] invalidateCache called with empty cacheKey: ${cacheKey}`);
      return false;
    }
    if (this._authCache.has(cacheKey)) {
      this._authCache.delete(cacheKey);
      // Also clear pending auth to force fresh authentication on next request
      // This ensures parallel requests don't keep using the old expired token
      this._pendingAuth.delete(cacheKey);
      // Force next auth call to skip any residual cache and re-run full QR auth
      this._forceReauth.add(cacheKey);
      this.logger('info', '[AuthService] Invalidating expired token cache');
      return true;
    }
    return false;
  }

  /**
   * Fetch app/data to get tenantId and schoolYearId
   * @private
   */
  /**
   * Extract only essential fields from appData to reduce cache size
   * @param {Object} appData - Full appData from API
   * @returns {Object} Compacted appData with only necessary fields
   */
  _compactAppData(appData) {
    if (!appData) return null;

    const normalizedRoles = this._normalizeRoles(appData.user?.roles);

    return {
      holidays: appData.holidays || [],
      currentSchoolYear: appData.currentSchoolYear
        ? {
            id: appData.currentSchoolYear.id,
            timeGrid: appData.currentSchoolYear.timeGrid || null,
          }
        : null,
      user: appData.user
        ? {
            students: appData.user.students || [],
            person: appData.user.person || null, // Keep person info for personId extraction
            roles: normalizedRoles, // Keep roles for STUDENT/LEGAL_GUARDIAN/TEACHER detection
          }
        : null,
      tenant: appData.tenant
        ? {
            id: appData.tenant.id,
          }
        : null,
    };
  }

  async _fetchAppData(server, cookieString, token, options = {}) {
    let tenantId = null;
    let schoolYearId = null;
    let appData = null;

    // Fetch app/data with aggressive error handling for 401 (auth errors)
    // 401 during auth flow must abort immediately to force full re-authentication
    const headers = {
      Cookie: cookieString,
      Accept: 'application/json',
    };

    // Add bearer token if available
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const appDataResp = await fetchClient.get(`https://${server}/WebUntis/api/rest/view/v1/app/data`, {
      headers,
      timeout: API_TIMEOUT_MS,
    });

    // CRITICAL: 401 during auth flow indicates invalid/expired credentials
    // We MUST throw an error to abort the auth flow and force complete re-authentication
    if (appDataResp.status === 401) {
      this.logger('error', `[AuthService] app/data returned 401 Unauthorized - aborting auth flow to force complete re-authentication`);
      const err = new Error(`app/data authentication failed (HTTP 401): credentials or token invalid/expired`);
      err.code = 'AUTH_FAILED';
      err.isAuthError = true;
      err.httpStatus = 401;
      throw err;
    }

    if (appDataResp.status === 200 && appDataResp.data) {
      appData = appDataResp.data;
      tenantId = appDataResp.data?.tenant?.id;
      schoolYearId = appDataResp.data?.currentSchoolYear?.id;

      // Optionally dump raw app/data response for debugging
      try {
        if (options.dumpRawApiResponses) {
          this._writeDebugDump(server, 'appdata', appDataResp.data, 'raw app/data');
        }
      } catch (dumpErr) {
        this.logger('warn', `[AuthService] Failed to write raw app/data dump: ${dumpErr?.message ? dumpErr.message : dumpErr}`);
      }
    } else if (appDataResp.status !== 200) {
      // Log non-200 responses for debugging
      this.logger('warn', `[AuthService] app/data returned HTTP ${appDataResp.status} (server=${server || 'unknown'})`);
    }

    if (!appData) {
      this.logger('warn', `[AuthService] app/data response was empty for server=${server || 'unknown'} (server offline or unreachable?)`);
    }

    return { tenantId, schoolYearId, appData: this._compactAppData(appData), rawAppData: appData };
  }

  /**
   * Extract user role from app/data response
   * @param {Object} appData - App data from API
   * @returns {string|null} Role: 'STUDENT', 'LEGAL_GUARDIAN', 'TEACHER', or null
   * @private
   */
  _extractRoleFromAppData(appData) {
    const roles = this._normalizeRoles(appData?.user?.roles);
    if (!roles.length) {
      return null;
    }

    // Priority: TEACHER > STUDENT > LEGAL_GUARDIAN (in case of multiple roles)
    if (roles.includes(ROLE.TEACHER)) return ROLE.TEACHER;
    if (roles.includes(ROLE.STUDENT)) return ROLE.STUDENT;
    if (roles.includes(ROLE.LEGAL_GUARDIAN)) return ROLE.LEGAL_GUARDIAN;

    // Return first role if none of the expected ones
    return roles.length > 0 ? roles[0] : null;
  }

  _normalizeRoleValue(role) {
    const normalized = String(role || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');
    if (!normalized) return null;
    return ROLE_ALIASES.get(normalized) || normalized;
  }

  /**
   * Normalize roles from array/string/object into uppercase string array
   * @param {any} roles
   * @returns {Array<string>} Normalized roles
   * @private
   */
  _normalizeRoles(roles) {
    if (!roles) return [];
    if (Array.isArray(roles)) {
      return Array.from(
        new Set(
          roles
            .map((r) => (typeof r === 'string' ? r : r?.role || r?.name || null))
            .filter(Boolean)
            .map((r) => this._normalizeRoleValue(r))
            .filter(Boolean)
        )
      );
    }
    if (typeof roles === 'string') {
      const normalized = this._normalizeRoleValue(roles);
      return normalized ? [normalized] : [];
    }
    if (typeof roles === 'object' && (roles.role || roles.name)) {
      const normalized = this._normalizeRoleValue(String(roles.role || roles.name));
      return normalized ? [normalized] : [];
    }
    return [];
  }

  _normalizeIdentityString(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  _matchChildByStudentTitle(children, studentTitle) {
    if (!Array.isArray(children) || children.length === 0) return null;
    const normalizedTitle = this._normalizeIdentityString(studentTitle);
    if (!normalizedTitle) return null;

    return (
      children.find((child) => {
        const displayName = this._normalizeIdentityString(child?.displayName);
        const name = this._normalizeIdentityString(child?.name);
        return displayName === normalizedTitle || name === normalizedTitle;
      }) || null
    );
  }

  _extractCacheKeyKind(cacheKey) {
    const key = String(cacheKey || '');
    const match = key.match(/(?:^|::)(parent|qrcode|user|student):/i);
    return match ? String(match[1]).toUpperCase() : null;
  }

  /**
   * Resolve school and server from student config and QR code
   * @param {Object} student - Student configuration
   * @param {Object} moduleConfig - Module configuration
   * @returns {Object} { school, server }
   */
  resolveSchoolAndServer(student, moduleConfig = {}) {
    let school = student.school || moduleConfig?.school || null;
    let server = student.server || moduleConfig?.server || null;

    if ((!school || !server) && student.qrcode) {
      try {
        const qrUrl = new URL(student.qrcode);
        school = school || qrUrl.searchParams.get('school');
        server = server || qrUrl.searchParams.get('url');
      } catch (err) {
        this.logger('error', `Failed to parse QR code for school/server: ${err.message}`);
      }
    }

    // Normalize server host if a full URL was provided
    if (server?.startsWith('http')) {
      server = tryOrDefault(
        () => new URL(server).hostname,
        server, // fallback: use original value
        (msg) => this.logger('debug', `[AuthService] Failed to parse server hostname: ${msg}`)
      );
    }

    return { school, server };
  }

  /**
   * Build REST targets for a student depending on login mode (QR vs. parent account)
   * @param {Object} student - Student configuration
   * @param {Object} moduleConfig - Module configuration
   * @param {string} school - Resolved school identifier
   * @param {string} server - Resolved server hostname
   * @param {number} ownPersonId - Own person ID from login (parent, student, or teacher depending on login type)
   * @param {string} bearerToken - Optional JWT bearer token to extract person_id from
   * @param {Object} appData - App data with user.students[] for parent account child mapping
   * @param {string} role - User role: 'STUDENT', 'LEGAL_GUARDIAN', or 'TEACHER'
   * @returns {Array} Array of target objects { personId, role, school, server }
   */
  buildRestTargets(student, moduleConfig, school, server, ownPersonId, bearerToken = null, appData = null, role = null) {
    const targets = [];
    const useQrLogin = Boolean(student.qrcode);
    const wantsClassTimetable = Boolean(student.useClassTimetable);
    const hasOwnCredentials = Boolean(student.username && student.password && student.school && student.server);
    const hasPartialOwnCredentials = Boolean(student.username || student.password || student.school || student.server);
    const linkedChildren = Array.isArray(appData?.user?.students) ? appData.user.students : [];
    const hasManualStudentId = student.studentId && Number.isFinite(Number(student.studentId)) && !student._autoDiscovered;
    const hasAutoDiscoveredStudentId = student.studentId && Number.isFinite(Number(student.studentId)) && student._autoDiscovered;
    const manualStudentId = hasManualStudentId ? Number(student.studentId) : null;
    const hasParentCreds = Boolean(moduleConfig?.username && moduleConfig?.password);

    // Derive role from app/data if not explicitly provided
    const effectiveRole = this._normalizeRoleValue(role) || this._extractRoleFromAppData(appData);

    // Determine actual login mode used for THIS student
    // (not just what credentials are available in moduleConfig)
    const isParentLogin = !useQrLogin && !hasOwnCredentials && hasParentCreds;

    // CRITICAL: personId (login user) ≠ studentId (timetable target) for LEGAL_GUARDIAN
    // For TEACHER: personId IS the timetable target (no studentId exists)
    // Priority for personId determination:
    // 1. TEACHER: always use ownPersonId (no child/student mapping)
    // 2. Manual studentId (highest priority - explicit config) for STUDENT/LEGAL_GUARDIAN
    // 3. Auto-discovered studentId (from parent account child list)
    // 4. For LEGAL_GUARDIAN login: map parent personId → child studentId via appData.user.students[]
    // 5. For STUDENT login (QR or direct): personId = studentId (same person)
    // 6. JWT token person_id as final fallback

    let effectivePersonId;

    // TEACHER: use ownPersonId directly (no studentId concept)
    if (effectiveRole === ROLE.TEACHER) {
      effectivePersonId = ownPersonId;
    } else {
      // STUDENT or LEGAL_GUARDIAN: determine studentId
      let effectiveStudentId = manualStudentId;
      if (!effectiveStudentId && hasAutoDiscoveredStudentId) {
        effectiveStudentId = Number(student.studentId);
      }
      if (!effectiveStudentId && ownPersonId) {
        // Check if this is ACTUAL parent login (not just parent creds existing)
        if (isParentLogin && linkedChildren.length > 0) {
          const matchedChild = this._matchChildByStudentTitle(linkedChildren, student.title);
          const onlyChild = linkedChildren.length === 1 ? linkedChildren[0] : null;
          const selectedChild = matchedChild || onlyChild;
          if (selectedChild) {
            effectiveStudentId = Number(selectedChild.id || selectedChild.studentId || selectedChild.personId);
          }
        } else if (effectiveRole === ROLE.STUDENT || !isParentLogin) {
          // Direct student login (QR or username/password): personId = studentId (same person)
          effectiveStudentId = ownPersonId;
        }
      }
      if (!effectiveStudentId && bearerToken) {
        const tokenPersonId = this.extractPersonIdFromToken(bearerToken);
        if (tokenPersonId) {
          effectiveStudentId = tokenPersonId;
        }
      }
      if (!effectiveStudentId && ownPersonId && effectiveRole !== ROLE.LEGAL_GUARDIAN) {
        // Fallback for shared/non-parent logins where WebUntis authenticates a single person
        // but app/data does not expose a child list or role metadata is incomplete.
        effectiveStudentId = ownPersonId;
      }
      effectivePersonId = effectiveStudentId;
      if (!effectivePersonId && isParentLogin && wantsClassTimetable && ownPersonId) {
        // Allow class timetable resolution to continue with the parent login identity.
        // _resolveClassIdViaRest() will then fall back to timetable/filter when no studentId is available.
        effectivePersonId = ownPersonId;
      }
    }

    // Determine the role for the REST target:
    // - If we're requesting data for a different person (parent logged in, child's data), role = STUDENT
    // - Otherwise, keep the original role (TEACHER, STUDENT, or LEGAL_GUARDIAN for self)
    let targetRole = effectiveRole;
    if (effectiveRole === ROLE.LEGAL_GUARDIAN && effectivePersonId !== ownPersonId) {
      // Parent logged in, but requesting child's data
      targetRole = ROLE.STUDENT;
    }

    if (useQrLogin && school && server) {
      targets.push({
        school,
        server,
        personId: effectivePersonId || null,
        role: targetRole || null,
      });
    }

    if (!useQrLogin && hasOwnCredentials && effectivePersonId !== null) {
      targets.push({
        school,
        server,
        personId: effectivePersonId,
        role: targetRole || null,
      });
    }

    if (!useQrLogin && hasParentCreds && effectivePersonId !== null) {
      targets.push({
        school: school || moduleConfig.school,
        server: server || moduleConfig.server || 'webuntis.com',
        personId: effectivePersonId,
        role: targetRole || null,
      });
    }

    // Diagnostic logging when no targets were built
    if (targets.length === 0) {
      const diagnostics = [];
      if (!useQrLogin && !hasOwnCredentials && !hasParentCreds) {
        diagnostics.push('No credentials configured (need qrcode, student credentials, or parent credentials)');
      }
      if (hasPartialOwnCredentials && !hasOwnCredentials) {
        diagnostics.push('Student credentials are incomplete (need username, password, school, and server together)');
      }
      if (hasOwnCredentials && (student.username === '' || student.password === '')) {
        diagnostics.push('Student credentials are empty strings (should be omitted or filled)');
      }
      if (useQrLogin && (!school || !server)) {
        diagnostics.push(`QR login missing school=${school || 'null'} or server=${server || 'null'}`);
      }
      if (!useQrLogin && hasParentCreds && effectivePersonId === null) {
        diagnostics.push(
          `Parent credentials configured but no studentId resolvable (missing student.studentId or appData.user.students empty)`
        );
        if (linkedChildren.length > 1) {
          diagnostics.push(
            'Parent login has multiple linked children and no exact title match. Configure student.studentId or set student.title to the exact child display name.'
          );
        }
        if (wantsClassTimetable) {
          diagnostics.push('useClassTimetable is enabled, but no parent personId was available for timetable/filter class fallback.');
        }
      }
      // if (diagnostics.length > 0) {
      //   this.logger('debug', `[AuthService] buildRestTargets returned empty: ${diagnostics.join('; ')}`);
      // }
    }

    return targets;
  }

  /**
   * Derive students from app/data response (parent account mode)
   * @param {Object} appData - App data response from WebUntis API
   * @returns {Array} Array of derived student objects
   */
  deriveStudentsFromAppData(appData) {
    if (!appData?.user || !Array.isArray(appData.user.students)) return [];

    const derived = [];
    appData.user.students.forEach((st, idx) => {
      const sid = Number(st?.id ?? st?.studentId ?? st?.personId);
      if (!Number.isFinite(sid)) return;

      const title = st?.displayName || st?.name || `Student ${idx + 1}`;
      derived.push({
        title,
        studentId: sid,
        imageUrl: st?.imageUrl || null,
      });
    });

    return derived;
  }

  /**
   * Clear authentication cache
   * @param {string} cacheKey - Optional specific key to clear, or clear all if not provided
   */
  clearCache(cacheKey = null) {
    if (cacheKey) {
      this._authCache.delete(cacheKey);
    } else {
      this._authCache.clear();
    }
  }

  /**
   * Force complete re-authentication for all cache keys related to a session
   * This triggers full re-authentication (new cookies, OTP, etc.) for all credentials used by a session
   * @param {string} sessionKey - Session identifier (e.g., "module_2_MMM-Webuntis:sessionId")
   */
  invalidateAllCachesForSession(sessionKey) {
    // Mark all caches for force reauth and clear them
    const sessionPrefix = sessionKey.split(':')[0]; // Extract identifier part
    const keysToInvalidate = [];

    for (const cacheKey of this._authCache.keys()) {
      const keyString = String(cacheKey || '');
      const isScopedKey = keyString.startsWith(`${sessionPrefix}::`);
      const keyKind = this._extractCacheKeyKind(keyString);
      const isGlobalAuthKey = keyKind && AUTH_CACHE_KEY_KINDS.has(keyKind);

      // Include all caches that might be used by this session.
      if (isScopedKey || isGlobalAuthKey) {
        keysToInvalidate.push(cacheKey);
      }
    }

    for (const cacheKey of keysToInvalidate) {
      this._forceReauth.add(cacheKey);
      this._authCache.delete(cacheKey);
      this._pendingAuth.delete(cacheKey);
    }

    // Clear session-wide auth blocking
    this._pendingAuthBySession.delete(sessionKey);

    this.logger(
      'warn',
      `[AuthService] Invalidated ${keysToInvalidate.length} auth caches for session ${sessionKey}: ${keysToInvalidate.join(', ')}`
    );
  }

  /**
   * Wait for any pending session-wide authentication to complete
   * @param {string} sessionKey - Session identifier
   * @returns {Promise} Resolves when session auth is complete
   */
  async waitForSessionAuth(sessionKey) {
    if (this._pendingAuthBySession.has(sessionKey)) {
      // this.logger('debug', `[AuthService] Waiting for pending session auth: ${sessionKey}`);
      await this._pendingAuthBySession.get(sessionKey);
    }
  }

  /**
   * Set session-wide authentication promise
   * @param {string} sessionKey - Session identifier
   * @param {Promise} authPromise - Auth promise that all requests should wait for
   */
  setSessionAuthPromise(sessionKey, authPromise) {
    this._pendingAuthBySession.set(sessionKey, authPromise);
    // Clean up when auth completes
    authPromise.finally(() => {
      this._pendingAuthBySession.delete(sessionKey);
    });
  }

  /**
   * Get cache statistics
   * @returns {Object} { size, keys }
   */
  getCacheStats() {
    return {
      size: this._authCache.size,
      keys: Array.from(this._authCache.keys()),
    };
  }
}

module.exports = AuthService;
