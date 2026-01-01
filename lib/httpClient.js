/**
 * Generic HTTP Client for WebUntis API
 * Provides authentication and session management without direct WebUntis library dependency
 *
 * This client abstracts the authentication flow:
 * 1. QR Code authentication (via JSON-RPC OTP)
 * 2. Username/Password authentication (via JSON-RPC)
 * 3. Bearer token retrieval
 * 4. Session cookie management
 */

const fetchClient = require('./fetchClient');
const CookieJar = require('./cookieJar');
const { authenticator: OtpAuthenticator } = require('otplib');
const { URL } = require('url');

// Configure OTP authenticator for WebUntis
OtpAuthenticator.options = {
  step: 30, // Time step in seconds (standard TOTP)
  window: 1, // Allow 1 time window before/after
  digits: 6, // 6-digit codes
  algorithm: 'sha1', // SHA1 hash algorithm
};

/**
 * HTTP Client for WebUntis
 */
class HttpClient {
  constructor(options = {}) {
    this.logger = options.logger || (() => {});
    this._sessionCache = new Map(); // sessionKey -> { cookies, sessionId, personId, expiresAt }
    this._cookieJar = new CookieJar();
  }

  /**
   * Authenticate via QR code
   * @param {string} qrCodeUrl - QR code URL from WebUntis
   * @returns {Promise<Object>} { cookies, sessionId, personId, school, server }
   */
  async authenticateWithQRCode(qrCodeUrl) {
    try {
      const qrUrl = new URL(qrCodeUrl);
      const school = qrUrl.searchParams.get('school');
      const server = qrUrl.searchParams.get('url');
      const otpSecret = qrUrl.searchParams.get('key');
      const user = qrUrl.searchParams.get('user'); // Extract user from QR code

      if (!school || !server || !otpSecret) {
        throw new Error('Invalid QR code: missing school, url, or key parameter');
      }

      if (!user) {
        throw new Error('Invalid QR code: missing user parameter');
      }

      // Generate OTP token
      const otpToken = OtpAuthenticator.generate(otpSecret);
      const clientTime = new Date().getTime();

      const requestBody = {
        jsonrpc: '2.0',
        method: 'getUserData2017',
        params: [
          {
            auth: {
              clientTime,
              user,
              otp: otpToken,
            },
          },
        ],
        id: 1,
      };

      const requestParams = {
        m: 'getUserData2017',
        school,
        v: 'i2.2',
      };

      // Authenticate via JSON-RPC intern endpoint (getUserData2017)
      const authUrl = new URL(`https://${server}/WebUntis/jsonrpc_intern.do`);
      Object.entries(requestParams).forEach(([key, value]) => {
        authUrl.searchParams.append(key, value);
      });

      const authResp = await fetchClient.post(authUrl.toString(), requestBody, {
        timeout: 10000,
      });

      if (authResp.status !== 200 || authResp.data?.error) {
        const errorMsg = authResp.data?.error?.message || 'Unknown error';
        throw new Error(`QR code authentication failed: ${authResp.status} - ${errorMsg}`);
      }

      this._cookieJar.setCookies(authResp.headers, server);
      const cookies = this._cookieJar.getCookieString(server);
      const sessionId = this._extractSessionId(cookies);

      if (!sessionId) {
        throw new Error('QR code authentication failed: No JSESSIONID in cookies');
      }

      // Get personId and personType from app/config
      const configResp = await fetchClient.get(`https://${server}/WebUntis/api/app/config`, {
        headers: {
          Cookie: `JSESSIONID=${sessionId}; schoolname=_${Buffer.from(school).toString('base64')}`,
        },
        timeout: 10000,
      });

      if (!configResp.data?.data?.loginServiceConfig?.user) {
        throw new Error('QR code authentication failed: Invalid app config response');
      }

      const loginServiceUser = configResp.data.data.loginServiceConfig.user;
      const personId = loginServiceUser.personId;

      if (!personId) {
        throw new Error('QR code authentication failed: No personId in config');
      }

      // Find person type
      const persons = loginServiceUser.persons || [];
      const person = persons.find((p) => p.id === personId);
      const personType = person ? person.type : undefined;

      this.logger('debug', `[HttpClient] QR authentication successful for ${school}@${server}`);

      return {
        cookies,
        sessionId,
        personId,
        personType,
        school,
        server,
      };
    } catch (error) {
      this.logger('error', `[HttpClient] QR authentication failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Extract JSESSIONID from cookies string
   * @param {string} cookieString - Cookies string from _extractCookies
   * @returns {string|null} Session ID
   * @private
   */
  _extractSessionId(cookieString) {
    if (!cookieString) return null;

    const match = cookieString.match(/JSESSIONID=([^;]+)/);
    return match ? match[1] : null;
  }

  /**
   * Authenticate with username and password
   * @param {Object} params - Authentication parameters
   * @param {string} params.school - School identifier
   * @param {string} params.username - Username
   * @param {string} params.password - Password
   * @param {string} params.server - Server hostname
   * @returns {Promise<Object>} { cookies, sessionId, personId, school, server }
   */
  async authenticateWithCredentials({ school, username, password, server }) {
    try {
      const authResp = await fetchClient.post(
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
        {
          timeout: 10000,
        }
      );

      if (authResp.status !== 200 || !authResp.data?.result) {
        throw new Error(`Credentials authentication failed: ${authResp.status} - ${authResp.data?.error?.message || 'Unknown error'}`);
      }

      this._cookieJar.setCookies(authResp.headers, server);
      const cookies = this._cookieJar.getCookieString(server);
      const sessionId = authResp.data.result.sessionId;
      const personId = authResp.data.result.personId;

      this.logger('debug', `[HttpClient] Credential authentication successful for ${username}@${school}`);

      return {
        cookies,
        sessionId,
        personId,
        school,
        server,
      };
    } catch (error) {
      this.logger('error', `[HttpClient] Credential authentication failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get Bearer token for REST API authentication
   * @param {string} server - Server hostname
   * @param {string} cookies - Session cookies
   * @returns {Promise<string>} Bearer token
   */
  async getBearerToken(server, cookies) {
    try {
      const tokenResp = await fetchClient.get(`https://${server}/WebUntis/api/token/new`, {
        headers: { Cookie: cookies },
        timeout: 10000,
      });

      if (tokenResp.status !== 200 || typeof tokenResp.data !== 'string') {
        throw new Error(`Bearer token request failed: ${tokenResp.status}`);
      }

      this.logger('debug', '[HttpClient] Bearer token obtained successfully');
      return tokenResp.data;
    } catch (error) {
      this.logger('error', `[HttpClient] Bearer token retrieval failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Perform a JSON-RPC call
   * @param {Object} params - RPC parameters
   * @param {string} params.server - Server hostname
   * @param {string} params.school - School identifier
   * @param {string} params.method - JSON-RPC method name
   * @param {Object} params.methodParams - Method parameters
   * @param {string} params.cookies - Session cookies
   * @returns {Promise<any>} Response result
   */
  async jsonRpc({ server, school, method, methodParams, cookies }) {
    try {
      const resp = await fetchClient.post(
        `https://${server}/WebUntis/jsonrpc.do?school=${encodeURIComponent(school)}`,
        {
          jsonrpc: '2.0',
          method,
          params: methodParams || {},
          id: Date.now(),
        },
        {
          headers: cookies ? { Cookie: cookies } : {},
          timeout: 15000,
        }
      );

      if (resp.status !== 200 || !resp.data) {
        throw new Error(`JSON-RPC ${method} failed: ${resp.status}`);
      }

      if (resp.data.error) {
        throw new Error(`JSON-RPC ${method} error: ${resp.data.error.message}`);
      }

      return resp.data.result;
    } catch (error) {
      this.logger('error', `[HttpClient] JSON-RPC ${method} failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Logout from session
   * @param {string} server - Server hostname
   * @param {string} school - School identifier
   * @param {string} cookies - Session cookies
   * @returns {Promise<void>}
   */
  async logout(server, school, cookies) {
    try {
      await this.jsonRpc({
        server,
        school,
        method: 'logout',
        methodParams: {},
        cookies,
      });
      this.logger('debug', '[HttpClient] Logout successful');
    } catch (error) {
      this.logger('debug', `[HttpClient] Logout failed (non-critical): ${error.message}`);
    }
  }

  /**
   * Extract cookies from Set-Cookie headers
   * @private
   * @param {Array<string>} setCookieHeaders - Set-Cookie headers
   * @returns {string} Cookie string
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
   * Cache session data
   * @param {string} sessionKey - Unique session key
   * @param {Object} sessionData - Session data to cache
   * @param {number} ttlMs - Time-to-live in milliseconds
   */
  cacheSession(sessionKey, sessionData, ttlMs = 14 * 60 * 1000) {
    this._sessionCache.set(sessionKey, {
      ...sessionData,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Get cached session data
   * @param {string} sessionKey - Unique session key
   * @returns {Object|null} Cached session data or null if expired/not found
   */
  getCachedSession(sessionKey) {
    const cached = this._sessionCache.get(sessionKey);
    if (!cached) return null;

    if (cached.expiresAt <= Date.now() + 60000) {
      this._sessionCache.delete(sessionKey);
      return null;
    }

    return cached;
  }

  /**
   * Clear session cache
   * @param {string} sessionKey - Optional specific key to clear
   */
  clearCache(sessionKey = null) {
    if (sessionKey) {
      this._sessionCache.delete(sessionKey);
    } else {
      this._sessionCache.clear();
    }
  }

  /**
   * Get cache statistics
   * @returns {Object} { size, keys }
   */
  getCacheStats() {
    return {
      size: this._sessionCache.size,
      keys: Array.from(this._sessionCache.keys()),
    };
  }
}

module.exports = HttpClient;
