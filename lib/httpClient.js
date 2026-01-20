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
const { URL } = require('url');
const { tryOrThrow, wrapAsync } = require('./errorUtils');

// Try to load otplib v13 - if it fails, we'll provide a meaningful error later
let generate = null;
try {
  ({ generate } = require('otplib'));
} catch {
  // otplib not installed - will be caught during usage
  generate = null;
}

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
    const performAuth = async () => {
      const qrUrl = tryOrThrow(
        () => new URL(qrCodeUrl),
        (msg) => this.logger('error', `[HttpClient] Invalid QR URL: ${msg}`)
      );

      const school = qrUrl.searchParams.get('school');
      const server = qrUrl.searchParams.get('url');
      const otpSecret = qrUrl.searchParams.get('key');
      const user = qrUrl.searchParams.get('user');

      this.logger(
        'debug',
        `[HttpClient] QR params: school=${school}, server=${server}, user=${user}, secretLength=${otpSecret?.length || 0}`
      );

      if (!school || !server || !otpSecret || !user) {
        throw new Error('Invalid QR code: missing required parameters (school, url, key, user)');
      }

      if (!generate || typeof generate !== 'function') {
        throw new Error('otplib dependency not found. Please run: npm install');
      }

      let paddedSecret = otpSecret;
      const minBase32Chars = 26;
      if (otpSecret.length < minBase32Chars) {
        paddedSecret = otpSecret.padEnd(minBase32Chars, 'A');
        this.logger('debug', `[DEBUG] Padded secret from ${otpSecret.length} to ${paddedSecret.length} chars (Base32)`);
      }

      const clientTime = new Date().getTime();

      const otpToken = await generate({
        secret: paddedSecret,
        algorithm: 'sha1',
        digits: 6,
        period: 30,
      });

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
      const cookieStr = this._cookieJar.getCookieString(server);
      const sessionId = this._extractSessionId(cookieStr);

      if (!sessionId) {
        throw new Error('QR code authentication failed: No JSESSIONID in cookies');
      }

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

      const persons = loginServiceUser.persons || [];
      const person = persons.find((p) => p.id === personId);
      const personType = person ? person.type : undefined;

      this.logger('debug', `[HttpClient] QR authentication successful for ${school}@${server}`);

      return {
        cookies: cookieStr,
        sessionId,
        personId,
        personType,
        school,
        server,
      };
    };

    return tryOrThrow(performAuth, (msg) => {
      // Provide context for common network errors
      if (msg.includes('fetch failed')) {
        const networkError = `Cannot connect to WebUntis server "${qrCodeUrl.split('url=')[1]?.split('&')[0] || 'unknown'}" - check server address and network connection`;
        this.logger('error', `[HttpClient] ${networkError}`);
        throw new Error(networkError);
      }
      if (msg.includes('timeout')) {
        const timeoutError = `Connection timeout to WebUntis server - check network or try again later`;
        this.logger('error', `[HttpClient] ${timeoutError}`);
        throw new Error(timeoutError);
      }
      this.logger('error', `[HttpClient] QR authentication: ${msg}`);
      throw new Error(msg);
    });
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
    const performAuth = async () => {
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
      const cookieStr = this._cookieJar.getCookieString(server);
      const sessionId = authResp.data.result.sessionId;
      const personId = authResp.data.result.personId;

      this.logger('debug', `[HttpClient] Credential authentication successful for ${username}@${school}`);

      return {
        cookies: cookieStr,
        sessionId,
        personId,
        school,
        server,
      };
    };

    return tryOrThrow(performAuth, (msg) => this.logger('error', `[HttpClient] Credential auth: ${msg}`));
  }

  /**
   * Get Bearer token for REST API authentication
   * @param {string} server - Server hostname
   * @param {string} cookies - Session cookies
   * @returns {Promise<string>} Bearer token
   */
  async getBearerToken(server, cookies) {
    this.logger(
      'debug',
      `[HttpClient] Requesting bearer token from ${server}, cookies: ${cookies ? cookies.substring(0, 30) + '...' : 'NONE'}`
    );
    const performTokenRequest = async () => {
      const tokenResp = await fetchClient.get(`https://${server}/WebUntis/api/token/new`, {
        headers: { Cookie: cookies },
        timeout: 10000,
      });

      if (tokenResp.status !== 200) {
        throw new Error(`Bearer token request failed: HTTP ${tokenResp.status}`);
      }

      if (typeof tokenResp.data !== 'string' || tokenResp.data.trim().length === 0) {
        throw new Error('Bearer token response is empty or invalid');
      }

      const token = tokenResp.data.trim();

      // WebUntis returns HTML login page when cookies are expired (despite 200 OK)
      // Validate that response is actually a token, not HTML or JSON
      if (token.startsWith('<') || token.startsWith('{') || token.includes('<!DOCTYPE')) {
        throw new Error('Session expired: received HTML/JSON instead of bearer token');
      }

      this.logger('debug', '[HttpClient] Bearer token obtained successfully');
      return token;
    };

    return tryOrThrow(performTokenRequest, (msg) => this.logger('error', `[HttpClient] Bearer token: ${msg}`));
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
    const performRpc = async () => {
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
    };

    return tryOrThrow(performRpc, (msg) => this.logger('error', `[HttpClient] JSON-RPC ${method}: ${msg}`));
  }

  /**
   * Logout from session
   * @param {string} server - Server hostname
   * @param {string} school - School identifier
   * @param {string} cookies - Session cookies
   * @returns {Promise<void>}
   */
  async logout(server, school, cookies) {
    // Logout is non-blocking: log but don't throw
    await wrapAsync(
      async () => {
        await this.jsonRpc({
          server,
          school,
          method: 'logout',
          methodParams: {},
          cookies,
        });
        this.logger('debug', '[HttpClient] Logout successful');
      },
      {
        warningPrefix: '[HttpClient] Logout failed (non-critical)',
        logger: this.logger,
      }
    );
  }

  /**
   * Extract cookies from Set-Cookie headers
   * @private
   * @param {Array<string>} setCookieHeaders - Set-Cookie headers
   * @returns {string} Cookie string
   */
  _extractCookies(setCookieHeaders) {
    const cookieMap = {};
    const setCookies = setCookieHeaders || [];

    setCookies.forEach((setCookie) => {
      const [cookie] = setCookie.split(';');
      const [key, value] = cookie.split('=');
      if (key && value) {
        cookieMap[key.trim()] = value;
      }
    });

    return Object.entries(cookieMap)
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
