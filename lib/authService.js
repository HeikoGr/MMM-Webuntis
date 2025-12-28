/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const axios = require('axios');
const { URL } = require('url');

class AuthService {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this._authCache = new Map(); // cacheKey -> { token, cookieString, tenantId, schoolYearId, appData, expiresAt }
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
    const { cacheKey, untisClient } = options;
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
          this.logger('debug', `[REST] JWT via existing session failed: ${err.message}`);
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
      const cookieString = this._extractCookies(authResp.headers['set-cookie']);
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
   * Extract cookies from Set-Cookie headers
   * @private
   */
  _extractCookies(setCookieHeaders) {
    const cookies = {};
    const setCookies = setCookieHeaders || [];

    setCookies.forEach((setCookie) => {
      const [cookie] = setCookie.split(';');
      const [key, value] = cookie.split('=');
      if (key && value) {
        cookies[key.trim()] = value;
      }
    });

    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
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

      const appDataResp = await axios.get(`https://${server}/WebUntis/api/rest/view/v1/app/data`, {
        headers,
        validateStatus: () => true,
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
   * @param {number} ownPersonId - Own person ID from login
   * @returns {Array} Array of target objects { mode, school, server, username, password, studentId }
   */
  buildRestTargets(student, moduleConfig, school, server, ownPersonId) {
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
