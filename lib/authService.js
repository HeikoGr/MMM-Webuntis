/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const fetchClient = require('./fetchClient');
const { URL } = require('url');
const HttpClient = require('./httpClient');
const { tryOrNull, tryOrDefault, tryOrThrow, wrapAsync } = require('./errorUtils');

class AuthService {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.httpClient = new HttpClient({ logger: this.logger });
    this._authCache = new Map(); // cacheKey -> { token, cookieString, tenantId, schoolYearId, appData, expiresAt }
    this._pendingAuth = new Map(); // cacheKey -> Promise (for race condition protection)
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

    // Check cache
    const cached = this._authCache.get(effectiveCacheKey);
    // Use token if it has at least 2 minutes remaining (instead of 1 minute)
    // This gives more buffer before actual expiration
    if (cached && cached.expiresAt > Date.now() + 120000) {
      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        personId: cached.personId,
        school: cached.school,
        server: cached.server,
        appData: cached.appData || null, // Include appData from cache (needed for holidays and timegrid)
      };
    }

    // Race condition protection: if auth is already in progress, wait for it
    if (this._pendingAuth.has(effectiveCacheKey)) {
      this.logger('debug', '[AuthService] Authentication already in progress, waiting...');
      return await this._pendingAuth.get(effectiveCacheKey);
    }

    // Create a promise for this auth request
    const authPromise = this._performQRAuth(effectiveCacheKey, qrCodeUrl, cached);
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
  async _performQRAuth(effectiveCacheKey, qrCodeUrl, cached) {
    // Optional token refresh: if we have cached cookies, try refreshing (but don't fail if it doesn't work)
    if (cached?.cookieString && cached?.server) {
      let refreshedToken = null;
      try {
        this.logger('info', '[AuthService] Token expired, refreshing with existing cookies...');
        refreshedToken = await this.httpClient.getBearerToken(cached.server, cached.cookieString);
        this.logger('info', '[AuthService] Token refresh successful');
      } catch (err) {
        this.logger('warn', `[AuthService] Token refresh failed, will re-authenticate: ${err.message}`);
        refreshedToken = null; // Explicitly set to null to fall through to full re-auth
      }

      if (refreshedToken) {
        // Update cache with new token but keep everything else
        this._authCache.set(effectiveCacheKey, {
          token: refreshedToken,
          cookieString: cached.cookieString,
          tenantId: cached.tenantId,
          schoolYearId: cached.schoolYearId,
          personId: cached.personId,
          school: cached.school,
          server: cached.server,
          appData: cached.appData,
          expiresAt: Date.now() + 14 * 60 * 1000,
        });

        return {
          token: refreshedToken,
          cookieString: cached.cookieString,
          tenantId: cached.tenantId,
          schoolYearId: cached.schoolYearId,
          personId: cached.personId,
          school: cached.school,
          server: cached.server,
          appData: cached.appData || null,
        };
      }
    }

    // Full QR code authentication (fail-fast)
    this.logger('info', '[AuthService] Starting full QR code re-authentication');
    const performQRAuth = async () => {
      const authResult = await this.httpClient.authenticateWithQRCode(qrCodeUrl);
      const { cookies, personId, school, server } = authResult;

      // Get Bearer token
      const token = await this.httpClient.getBearerToken(server, cookies);

      // Fetch app/data to get tenantId and schoolYearId
      const metadata = await this._fetchAppData(server, cookies, token);

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
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      this.logger('info', '[AuthService] QR code re-authentication successful');
      return {
        token,
        cookieString: cookies,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        personId,
        school,
        server,
        appData: metadata.appData,
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

    // Check cache - use token only if it has at least 2 minutes remaining
    // This 2-minute buffer prevents race conditions where parallel requests
    // start with a token that expires during their execution
    const cached = this._authCache.get(effectiveCacheKey);
    const twoMinutesInMs = 2 * 60 * 1000;
    if (cached && cached.expiresAt > Date.now() + twoMinutesInMs) {
      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        appData: cached.appData,
        personId: cached.personId,
      };
    }

    // Race condition protection: if auth is already in progress, wait for it
    if (this._pendingAuth.has(effectiveCacheKey)) {
      this.logger('debug', '[AuthService] Authentication already in progress, waiting...');
      return await this._pendingAuth.get(effectiveCacheKey);
    }

    // Create a promise for this auth request
    const authPromise = this._performAuth(effectiveCacheKey, school, username, password, server, options);
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
  async _performAuth(effectiveCacheKey, school, username, password, server, options) {
    const { untisClient, authSession, qrCodeUrl } = options;

    // DEBUG: Log what we received
    this.logger(
      'debug',
      `[AuthService] _performAuth called with qrCodeUrl=${qrCodeUrl ? 'SET' : 'UNSET'}, authSession=${authSession ? 'SET' : 'UNSET'}`
    );

    let appData = null;

    // If authSession is provided (from QR or existing session), try to refresh it if needed
    if (authSession?.token && authSession?.cookieString) {
      // Optional token refresh with authSession cookies
      if (authSession.server && authSession.cookieString) {
        const newToken = await tryOrDefault(
          async () => {
            this.logger('info', '[AuthService] authSession provided - refreshing token with cookies...');
            const token = await this.httpClient.getBearerToken(authSession.server, authSession.cookieString);
            this.logger('info', '[AuthService] Token refreshed successfully from authSession cookies');
            return token;
          },
          null, // Return null if refresh fails
          (msg) => this.logger('warn', `[AuthService] Token refresh from authSession failed: ${msg}`)
        );

        if (newToken) {
          authSession.token = newToken;
        } else if (qrCodeUrl) {
          // If token refresh failed and we have QR code, force cache invalidation and do a clean QR re-auth
          this.invalidateCache(effectiveCacheKey);
          this.logger('info', '[AuthService] Re-authenticating with QR code after token refresh failure...');
          return await this.getAuthFromQRCode(qrCodeUrl, { cacheKey: effectiveCacheKey });
        } else {
          // Don't use the old authSession if token refresh failed and no QR code available
          authSession.token = null;
        }
      }

      if (authSession.token) {
        this.logger('debug', '[AuthService] Using existing authSession');

        // Fetch app/data to get tenantId and schoolYearId if not already present
        const metadata = authSession.appData
          ? { tenantId: authSession.tenantId, schoolYearId: authSession.schoolYearId, appData: authSession.appData }
          : await this._fetchAppData(server || authSession.server, authSession.cookieString, authSession.token);

        // Extract personId from appData if not already present
        const personId = authSession.personId || metadata.appData?.user?.person?.id || null;

        const result = {
          token: authSession.token,
          cookieString: authSession.cookieString,
          tenantId: metadata.tenantId,
          schoolYearId: metadata.schoolYearId,
          appData: metadata.appData,
          personId,
        };

        this._authCache.set(effectiveCacheKey, {
          ...result,
          expiresAt: Date.now() + 14 * 60 * 1000,
        });

        return result;
      }
    }

    // Prefer an already logged-in Untis client (QR or parent login) to avoid duplicate logins
    if (untisClient && typeof untisClient._buildCookies === 'function') {
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

      // If token retrieval failed, get it via httpClient
      if (!token) {
        token = await tryOrDefault(
          async () => this.httpClient.getBearerToken(server, cookieString),
          null,
          (err) => this.logger('debug', `[REST] Bearer token via httpClient: ${err}`)
        );
      }

      // Fetch app/data to get tenantId and schoolYearId
      const metadata = await this._fetchAppData(server, cookieString, token);
      appData = metadata.appData;

      // Extract personId from appData
      const personId = appData?.user?.person?.id || null;

      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData: metadata.appData,
        personId,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      return {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
        personId,
      };
    }

    // If no username provided and no authSession/untisClient, throw error
    if (!username) {
      throw new Error('No username specified and no existing session available');
    }

    const performRestAuth = async () => {
      // Step 1: Authenticate via httpClient to get session cookies
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

      // Step 2: Get Bearer Token using the session cookies
      const token = await this.httpClient.getBearerToken(server, cookieString);

      // Step 3: Fetch app/data to get tenantId and schoolYearId
      const metadata = await this._fetchAppData(server, cookieString, token);
      appData = metadata.appData;

      // Extract personId from appData (for direct student login)
      const personId = appData?.user?.person?.id || null;

      // Cache the token (expires in 900 seconds, with buffer we cache for 14 minutes)
      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData: metadata.appData,
        personId,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      this.logger('debug', '[AuthService] REST auth token obtained successfully');
      return {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
        personId,
      };
    };

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
      this.logger('info', `[AuthService] Invalidating expired token cache for key: ${cacheKey}`);
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
        }
        : null,
      tenant: appData.tenant
        ? {
          id: appData.tenant.id,
        }
        : null,
    };
  }

  async _fetchAppData(server, cookieString, token) {
    let tenantId = null;
    let schoolYearId = null;
    let appData = null;

    await wrapAsync(
      async () => {
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
          timeout: 15000,
        });

        if (appDataResp.status === 200 && appDataResp.data) {
          appData = appDataResp.data;
          tenantId = appDataResp.data?.tenant?.id;
          schoolYearId = appDataResp.data?.currentSchoolYear?.id;
        }
      },
      {
        warningPrefix: '[AuthService] Failed to fetch app/data',
        logger: this.logger,
      }
    );

    return { tenantId, schoolYearId, appData: this._compactAppData(appData) };
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
    if (server && server.startsWith('http')) {
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
   * @param {number} ownPersonId - Own person ID from login (parent or student depending on login type)
   * @param {string} bearerToken - Optional JWT bearer token to extract person_id from
   * @param {Object} appData - App data with user.students[] for parent account child mapping
   * @returns {Array} Array of target objects { mode, school, server, username, password, studentId }
   */
  buildRestTargets(student, moduleConfig, school, server, ownPersonId, bearerToken = null, appData = null) {
    const targets = [];
    const useQrLogin = Boolean(student.qrcode);
    const hasOwnCredentials = Boolean(student.username && student.password && student.school && student.server);
    const hasManualStudentId = student.studentId && Number.isFinite(Number(student.studentId)) && !student._autoDiscovered;
    const hasAutoDiscoveredStudentId = student.studentId && Number.isFinite(Number(student.studentId)) && student._autoDiscovered;
    const manualStudentId = hasManualStudentId ? Number(student.studentId) : null;
    const hasParentCreds = Boolean(moduleConfig?.username && moduleConfig?.password);

    // Determine actual login mode used for THIS student
    // (not just what credentials are available in moduleConfig)
    const isParentLogin = !useQrLogin && !hasOwnCredentials && hasParentCreds;

    // CRITICAL: personId (login user) ≠ studentId (timetable target)
    // Priority for studentId determination:
    // 1. Manual studentId (highest priority - explicit config)
    // 2. Auto-discovered studentId (from parent account child list)
    // 3. For PARENT login: map parent personId → child studentId via appData.user.students[]
    // 4. For STUDENT login (QR or direct): personId = studentId (same person)
    // 5. JWT token person_id as final fallback
    let effectiveStudentId = manualStudentId;
    if (effectiveStudentId) {
      this.logger('debug', `[AuthService] Using manual studentId=${effectiveStudentId} (highest priority - from config)`);
    }
    if (!effectiveStudentId && hasAutoDiscoveredStudentId) {
      effectiveStudentId = Number(student.studentId);
      this.logger('debug', `[AuthService] Using auto-discovered studentId=${effectiveStudentId} (from parent account)`);
    }
    if (!effectiveStudentId && ownPersonId) {
      // Check if this is ACTUAL parent login (not just parent creds existing)
      if (isParentLogin && appData?.user?.students && Array.isArray(appData.user.students)) {
        const children = appData.user.students;
        this.logger('debug', `[AuthService] Parent login detected: personId=${ownPersonId}, children count=${children.length}`);
        if (children.length > 0) {
          // Auto-select: try to match by student.title, otherwise use first child
          const matchedChild =
            children.find((c) => student.title && (c.displayName?.includes(student.title) || c.name?.includes(student.title))) ||
            children[0];
          effectiveStudentId = Number(matchedChild.id || matchedChild.studentId || matchedChild.personId);
          this.logger(
            'debug',
            `[AuthService] Parent account: mapped personId=${ownPersonId} → child studentId=${effectiveStudentId} (${matchedChild.displayName || matchedChild.name})${student.title ? ` [matched title: ${student.title}]` : ' [first child]'}`
          );
        } else {
          this.logger('warn', `[AuthService] Parent account (personId=${ownPersonId}) has no children in appData.user.students`);
        }
      } else if (!isParentLogin) {
        // Direct student login (QR or username/password): personId = studentId (same person)
        effectiveStudentId = ownPersonId;
        const loginType = useQrLogin ? 'QR code' : 'direct credentials';
        this.logger('debug', `[AuthService] Student login (${loginType}): personId=${ownPersonId} = studentId (same person)`);
      } else {
        // Parent creds but no appData or students array - this is a problem
        this.logger('warn', `[AuthService] Parent credentials detected but no appData.user.students available (personId=${ownPersonId})`);
      }
    }
    if (!effectiveStudentId && bearerToken) {
      const tokenPersonId = this.extractPersonIdFromToken(bearerToken);
      if (tokenPersonId) {
        effectiveStudentId = tokenPersonId;
        this.logger('debug', `[AuthService] Using person_id from JWT token: ${tokenPersonId}`);
      }
    }

    if (useQrLogin && school && server) {
      targets.push({
        mode: 'qr',
        school,
        server,
        username: null,
        password: null,
        studentId: effectiveStudentId || null,
      });
    }

    if (!useQrLogin && hasParentCreds && effectiveStudentId !== null) {
      targets.push({
        mode: 'parent',
        school: school || moduleConfig.school,
        server: server || moduleConfig.server || 'webuntis.com',
        username: moduleConfig.username,
        password: moduleConfig.password,
        studentId: effectiveStudentId,
      });
    }

    return targets;
  }

  /**
   * Derive students from app/data response (parent account mode)
   * @param {Object} appData - App data response from WebUntis API
   * @returns {Array} Array of derived student objects
   */
  deriveStudentsFromAppData(appData) {
    if (!appData || !appData.user || !Array.isArray(appData.user.students)) return [];

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
