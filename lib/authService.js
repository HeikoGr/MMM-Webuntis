/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const fetchClient = require('./fetchClient');
const { URL } = require('url');
const HttpClient = require('./httpClient');

class AuthService {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.httpClient = new HttpClient({ logger: this.logger });
    this._authCache = new Map(); // cacheKey -> { token, cookieString, tenantId, schoolYearId, appData, expiresAt }
  }

  /**
   * Extract person_id from JWT bearer token
   * @param {string} token - JWT bearer token
   * @returns {number|null} person_id from token payload, or null if not found
   */
  extractPersonIdFromToken(token) {
    if (!token || typeof token !== 'string') return null;

    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      const personId = Number(payload.person_id);

      return Number.isFinite(personId) ? personId : null;
    } catch (error) {
      this.logger('debug', `[AuthService] Failed to extract person_id from token: ${error.message}`);
      return null;
    }
  }

  /**
   * Get REST API authentication via QR code
   * @param {string} qrCodeUrl - QR code URL from WebUntis
   * @param {Object} options - Additional options (cacheKey)
   * @returns {Promise<Object>} { token, cookieString, tenantId, schoolYearId, appData, personId, school, server }
   */
  async getAuthFromQRCode(qrCodeUrl, options = {}) {
    const { cacheKey } = options;
    const effectiveCacheKey = cacheKey || `qr:${qrCodeUrl}`;

    // Check cache
    const cached = this._authCache.get(effectiveCacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        appData: cached.appData,
        personId: cached.personId,
        school: cached.school,
        server: cached.server,
      };
    }

    try {
      // Authenticate with QR code
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
        appData: metadata.appData,
        personId,
        school,
        server,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      this.logger('debug', '[AuthService] QR code authentication successful');
      return {
        token,
        cookieString: cookies,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData: metadata.appData,
        personId,
        school,
        server,
      };
    } catch (error) {
      this.logger('error', `[AuthService] QR code authentication failed: ${error.message}`);
      throw error;
    }
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
    const { cacheKey, untisClient, authSession } = options;
    const effectiveCacheKey = cacheKey || `user:${username || 'session'}@${server || school || 'default'}`;

    // Check cache
    const cached = this._authCache.get(effectiveCacheKey);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return {
        token: cached.token,
        cookieString: cached.cookieString,
        tenantId: cached.tenantId,
        schoolYearId: cached.schoolYearId,
        appData: cached.appData,
        personId: cached.personId,
      };
    }

    let appData = null;

    // If authSession is provided (from QR or existing session), use it directly
    if (authSession && authSession.token && authSession.cookieString) {
      this.logger('debug', '[AuthService] Using existing authSession');

      // Fetch app/data to get tenantId and schoolYearId if not already present
      const metadata = authSession.appData
        ? { tenantId: authSession.tenantId, schoolYearId: authSession.schoolYearId, appData: authSession.appData }
        : await this._fetchAppData(server || authSession.server, authSession.cookieString, authSession.token);

      const result = {
        token: authSession.token,
        cookieString: authSession.cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData: metadata.appData,
        personId: authSession.personId,
      };

      this._authCache.set(effectiveCacheKey, {
        ...result,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      return result;
    }

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
          this.logger('debug', `[REST] JWT via existing session failed: ${err.message}`);
        }
      }

      // If token retrieval failed, get it via httpClient
      if (!token) {
        try {
          token = await this.httpClient.getBearerToken(server, cookieString);
        } catch (err) {
          this.logger('debug', `[REST] Bearer token via httpClient failed: ${err.message}`);
        }
      }

      // Fetch app/data to get tenantId and schoolYearId
      const metadata = await this._fetchAppData(server, cookieString, token);
      appData = metadata.appData;

      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      return {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
      };
    }

    // If no username provided and no authSession/untisClient, throw error
    if (!username) {
      throw new Error('No username specified and no existing session available');
    }

    try {
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

      // Cache the token (expires in 900 seconds, with buffer we cache for 14 minutes)
      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
        expiresAt: Date.now() + 14 * 60 * 1000,
      });

      this.logger('debug', '[AuthService] REST auth token obtained successfully');
      return {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
      };
    } catch (error) {
      this.logger('error', `[AuthService] REST auth failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetch app/data to get tenantId and schoolYearId
   * @private
   */
  async _fetchAppData(server, cookieString, token) {
    let tenantId = null;
    let schoolYearId = null;
    let appData = null;

    try {
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
    } catch (err) {
      this.logger('debug', `[AuthService] Failed to fetch app/data: ${err.message}`);
    }

    return { tenantId, schoolYearId, appData };
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
      try {
        server = new URL(server).hostname;
      } catch {
        // leave as-is
      }
    }

    return { school, server };
  }

  /**
   * Build REST targets for a student depending on login mode (QR vs. parent account)
   * @param {Object} student - Student configuration
   * @param {Object} moduleConfig - Module configuration
   * @param {string} school - Resolved school identifier
   * @param {string} server - Resolved server hostname
   * @param {number} ownPersonId - Own person ID from login (from app/config or app/data)
   * @param {string} bearerToken - Optional JWT bearer token to extract person_id from
   * @returns {Array} Array of target objects { mode, school, server, username, password, studentId }
   */
  buildRestTargets(student, moduleConfig, school, server, ownPersonId, bearerToken = null) {
    const targets = [];
    const useQrLogin = Boolean(student.qrcode);
    const hasManualStudentId = student.studentId && Number.isFinite(Number(student.studentId));
    const manualStudentId = hasManualStudentId ? Number(student.studentId) : null;
    const hasParentCreds = Boolean(moduleConfig?.username && moduleConfig?.password);

    // Priority for studentId determination:
    // 1. Manual studentId (highest priority)
    // 2. ownPersonId from app/data (parent account auto-discovery)
    // 3. person_id from JWT token (direct student login)
    let effectiveStudentId = manualStudentId;
    if (!effectiveStudentId && ownPersonId) {
      effectiveStudentId = ownPersonId;
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
