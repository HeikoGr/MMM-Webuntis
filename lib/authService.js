/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const fetchClient = require('./fetchClient');
const { URL } = require('url');
const HttpClient = require('./httpClient');
const { tryOrNull, tryOrDefault, tryOrThrow, wrapAsync } = require('./errorUtils');
const { createBackendLogger } = require('./logger');

class AuthService {
  constructor(options = {}) {
    // Use provided logger, or fallback to structured logger (instead of raw console.log)
    this.logger =
      options.logger ||
      createBackendLogger((level, student, msg) => {
        console.log(`[AuthService] [${level}]`, msg);
      }).log;
    this.httpClient = new HttpClient({ logger: this.logger });
    // Cache structure: { token, cookieString, tenantId, schoolYearId, appData, rawAppData, personId, role, school, server, expiresAt, lastCookieValidation }
    this._authCache = new Map();
    this._pendingAuth = new Map(); // cacheKey -> Promise (for race condition protection)
    this._forceReauth = new Set(); // cacheKey set to force next auth to skip cache
    // Cookie validation interval - only revalidate cookies every 5 minutes to maintain cache performance
    this.COOKIE_VALIDATION_INTERVAL = 5 * 60 * 1000; // 5 minutes
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
      this.logger('info', `[AuthService] QR Auth: forceReauth flag set for ${effectiveCacheKey}, skipping cache`);
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
    // Use token if it has at least 2 minutes remaining (instead of 1 minute)
    // This gives more buffer before actual expiration
    if (cached && cached.expiresAt > Date.now() + 120000) {
      // CRITICAL: Even if token is cached, WebUntis JSESSIONID cookies may have expired
      // Test if cookies are still valid by attempting a token refresh
      // This prevents "Session expired" errors after ~3-5 minutes of inactivity
      // However, only validate cookies periodically (every 5 minutes) to maintain cache performance
      const shouldValidateCookies =
        cached.cookieString &&
        cached.server &&
        (!cached.lastCookieValidation || Date.now() - cached.lastCookieValidation > this.COOKIE_VALIDATION_INTERVAL);

      if (shouldValidateCookies) {
        try {
          // Try to get a fresh bearer token with existing cookies
          const refreshedToken = await this.httpClient.getBearerToken(cached.server, cached.cookieString);
          // Cookies are still valid - update cache with fresh token and validation timestamp
          this._authCache.set(effectiveCacheKey, {
            ...cached,
            token: refreshedToken,
            expiresAt: Date.now() + 14 * 60 * 1000,
            lastCookieValidation: Date.now(),
          });
          return {
            token: refreshedToken,
            cookieString: cached.cookieString,
            tenantId: cached.tenantId,
            schoolYearId: cached.schoolYearId,
            personId: cached.personId,
            role: cached.role || null,
            school: cached.school,
            server: cached.server,
            appData: cached.appData || null,
          };
        } catch (err) {
          // Token refresh failed - cookies expired, fall through to full re-auth
          this.logger('warn', `[AuthService] QR code session expired (cookies invalid), re-authenticating: ${err.message}`);
          this._authCache.delete(effectiveCacheKey);
        }
      } else {
        // Cookies were validated recently or not applicable - return cached data
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
    const skipRefresh = Boolean(options.skipRefresh);

    // Optional token refresh: if we have cached cookies, try refreshing (but don't fail if it doesn't work)
    if (!skipRefresh && cached?.cookieString && cached?.server) {
      this.logger('debug', `[AuthService] QR Auth: Attempting token refresh with cached cookies (cached exists)`);
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
        const refreshedRole = cached.role || this._extractRoleFromAppData(cached.appData);
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
          rawAppData: cached.rawAppData || null,
          role: refreshedRole || null,
          expiresAt: Date.now() + 14 * 60 * 1000,
          lastCookieValidation: cached.lastCookieValidation, // Preserve validation timestamp
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
          role: refreshedRole || null,
        };
      }
    }

    // Full QR code authentication (fail-fast)
    this.logger(
      'info',
      `[AuthService] QR Auth: Starting full QR re-authentication (cached=${cached ? 'exists' : 'null'}, skipRefresh=${skipRefresh})`
    );
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
        expiresAt: Date.now() + 14 * 60 * 1000,
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
      this.logger('info', `[AuthService] REST auth: forceReauth flag set for ${effectiveCacheKey}, skipping cache and authSession reuse`);
      this._authCache.delete(effectiveCacheKey);
      this._pendingAuth.delete(effectiveCacheKey);
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

    // Check cache - use token only if it has at least 2 minutes remaining
    // This 2-minute buffer prevents race conditions where parallel requests
    // start with a token that expires during their execution
    const cached = forceReauth ? null : this._authCache.get(effectiveCacheKey);
    const twoMinutesInMs = 2 * 60 * 1000;
    if (cached && cached.expiresAt > Date.now() + twoMinutesInMs) {
      // Optionally dump cached appData when requested (helps debugging when cache was populated earlier)
      try {
        const maybeOptions = options || {};
        if (maybeOptions.dumpRawApiResponses) {
          const fs = require('fs');
          const path = require('path');
          const dumpDir = path.join(__dirname, '..', 'debug_dumps');
          fs.mkdirSync(dumpDir, { recursive: true });
          const serverSafe = String(server || 'server').replace(/[^a-z0-9.-]/gi, '_');
          if (cached.rawAppData) {
            const filename = `raw_api_${Date.now()}_${serverSafe}_appdata_cached_raw.json`;
            const filePath = path.join(dumpDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(cached.rawAppData, null, 2), { encoding: 'utf8' });
            this.logger('debug', `[AuthService] Wrote cached raw app/data to ${filePath}`);
          } else if (cached.appData) {
            const filename = `raw_api_${Date.now()}_${serverSafe}_appdata_cached_compacted.json`;
            const filePath = path.join(dumpDir, filename);
            fs.writeFileSync(filePath, JSON.stringify(cached.appData, null, 2), { encoding: 'utf8' });
            this.logger('debug', `[AuthService] Wrote cached compacted app/data to ${filePath}`);
          }
        }
      } catch (err) {
        this.logger('debug', `[AuthService] Failed to dump cached appData: ${err && err.message ? err.message : err}`);
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
  async _performAuth(effectiveCacheKey, school, username, password, server, options) {
    const { untisClient, qrCodeUrl } = options;
    const forceReauth = Boolean(options.forceReauth);
    const authSession = forceReauth ? null : options.authSession;

    // Perform auth with provided credentials (logged details removed for cleaner output)

    let appData = null;

    // If authSession is provided (from QR or existing session), try to refresh it if needed (unless forceReauth)
    if (!forceReauth && authSession?.token && authSession?.cookieString) {
      // Optional token refresh with authSession cookies
      if (authSession.server && authSession.cookieString) {
        const newToken = await tryOrDefault(
          async () => {
            // Refreshing token with existing cookies silently
            const token = await this.httpClient.getBearerToken(authSession.server, authSession.cookieString);
            // Token refreshed successfully
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
        // Using existing authSession silently

        // Fetch app/data to get tenantId and schoolYearId if not already present
        // Force fresh fetch if dumpRawApiResponses is enabled (to get raw app/data dump)
        const metadata =
          authSession.appData && !options.dumpRawApiResponses
            ? {
                tenantId: authSession.tenantId,
                schoolYearId: authSession.schoolYearId,
                appData: authSession.appData,
              }
            : await this._fetchAppData(server || authSession.server, authSession.cookieString, authSession.token, options);

        // Extract personId from appData if not already present
        const personId = authSession.personId || metadata.appData?.user?.person?.id || null;

        // Extract role from appData
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

        this._authCache.set(effectiveCacheKey, {
          ...result,
          expiresAt: Date.now() + 14 * 60 * 1000,
          lastCookieValidation: Date.now(), // Set initial validation timestamp for QR session
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
      const metadata = await this._fetchAppData(server, cookieString, token, options);
      appData = metadata.appData;

      // Extract personId from appData
      const personId = appData?.user?.person?.id || null;

      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData: metadata.appData,
        rawAppData: metadata.rawAppData || null,
        personId,
        expiresAt: Date.now() + 14 * 60 * 1000,
        lastCookieValidation: Date.now(), // Set initial validation timestamp
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
      const metadata = await this._fetchAppData(server, cookieString, token, options);
      appData = metadata.appData;

      // Extract personId from appData (for direct student login)
      const personId = appData?.user?.person?.id || null;

      // Extract role from appData (STUDENT, LEGAL_GUARDIAN, or TEACHER)
      const role = this._extractRoleFromAppData(metadata.appData);

      // Cache the token (expires in 900 seconds, with buffer we cache for 14 minutes)
      this._authCache.set(effectiveCacheKey, {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData: metadata.appData,
        personId,
        role,
        expiresAt: Date.now() + 14 * 60 * 1000,
        lastCookieValidation: Date.now(), // Set initial validation timestamp
      });

      this.logger('debug', `[AuthService] REST auth token obtained successfully, role=${role}, personId=${personId}`);
      return {
        token,
        cookieString,
        tenantId: metadata.tenantId,
        schoolYearId: metadata.schoolYearId,
        appData,
        personId,
        role,
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
      // Force next auth call to skip any residual cache and re-run full QR auth
      this._forceReauth.add(cacheKey);
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

  async _fetchAppData(server, cookieString, token) {
    let tenantId = null;
    let schoolYearId = null;
    let appData = null;

    // accept optional options parameter (last arg) for dump control
    const maybeOptions = arguments.length >= 4 && typeof arguments[3] === 'object' ? arguments[3] : {};

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

          // Optionally dump raw app/data response for debugging
          try {
            if (maybeOptions.dumpRawApiResponses) {
              const fs = require('fs');
              const path = require('path');
              const dumpDir = path.join(__dirname, '..', 'debug_dumps');
              fs.mkdirSync(dumpDir, { recursive: true });
              const serverSafe = String(server || 'server').replace(/[^a-z0-9.-]/gi, '_');
              const filename = `raw_api_${Date.now()}_${serverSafe}_appdata.json`;
              const filePath = path.join(dumpDir, filename);
              fs.writeFileSync(filePath, JSON.stringify(appDataResp.data, null, 2), { encoding: 'utf8' });
              this.logger('debug', `[AuthService] Wrote raw app/data to ${filePath}`);
            }
          } catch (dumpErr) {
            this.logger(
              'warn',
              `[AuthService] Failed to write raw app/data dump: ${dumpErr && dumpErr.message ? dumpErr.message : dumpErr}`
            );
          }
        }
      },
      {
        warningPrefix: `[AuthService] Failed to fetch app/data (server=${server || 'unknown'})`,
        logger: this.logger,
        context: { server },
      }
    );

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
    if (roles.includes('TEACHER')) return 'TEACHER';
    if (roles.includes('STUDENT')) return 'STUDENT';
    if (roles.includes('LEGAL_GUARDIAN')) return 'LEGAL_GUARDIAN';

    // Return first role if none of the expected ones
    return roles.length > 0 ? roles[0] : null;
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
      return roles
        .map((r) => (typeof r === 'string' ? r : r?.role || r?.name || null))
        .filter(Boolean)
        .map((r) => String(r).toUpperCase());
    }
    if (typeof roles === 'string') {
      return [roles.toUpperCase()];
    }
    if (typeof roles === 'object' && (roles.role || roles.name)) {
      return [String(roles.role || roles.name).toUpperCase()];
    }
    return [];
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
   * @param {number} ownPersonId - Own person ID from login (parent, student, or teacher depending on login type)
   * @param {string} bearerToken - Optional JWT bearer token to extract person_id from
   * @param {Object} appData - App data with user.students[] for parent account child mapping
   * @param {string} role - User role: 'STUDENT', 'LEGAL_GUARDIAN', or 'TEACHER'
   * @returns {Array} Array of target objects { mode, school, server, username, password, personId, role }
   */
  buildRestTargets(student, moduleConfig, school, server, ownPersonId, bearerToken = null, appData = null, role = null) {
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

    // CRITICAL: personId (login user) ≠ studentId (timetable target) for LEGAL_GUARDIAN
    // For TEACHER: personId IS the timetable target (no studentId exists)
    // Priority for personId determination:
    // 1. TEACHER: always use ownPersonId (no child/student mapping)
    // 2. Manual studentId (highest priority - explicit config) for STUDENT/LEGAL_GUARDIAN
    // 3. Auto-discovered studentId (from parent account child list)
    // 4. For LEGAL_GUARDIAN login: map parent personId → child studentId via appData.user.students[]
    // 5. For STUDENT login (QR or direct): personId = studentId (same person)
    // 6. JWT token person_id as final fallback

    let effectivePersonId = null;

    // TEACHER: use ownPersonId directly (no studentId concept)
    if (role === 'TEACHER') {
      effectivePersonId = ownPersonId;
    } else {
      // STUDENT or LEGAL_GUARDIAN: determine studentId
      let effectiveStudentId = manualStudentId;
      if (!effectiveStudentId && hasAutoDiscoveredStudentId) {
        effectiveStudentId = Number(student.studentId);
      }
      if (!effectiveStudentId && ownPersonId) {
        // Check if this is ACTUAL parent login (not just parent creds existing)
        if (isParentLogin && appData?.user?.students && Array.isArray(appData.user.students)) {
          const children = appData.user.students;
          if (children.length > 0) {
            // Auto-select: try to match by student.title, otherwise use first child
            const matchedChild =
              children.find((c) => student.title && (c.displayName?.includes(student.title) || c.name?.includes(student.title))) ||
              children[0];
            effectiveStudentId = Number(matchedChild.id || matchedChild.studentId || matchedChild.personId);
          }
        } else if (role === 'STUDENT' || !isParentLogin) {
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
      effectivePersonId = effectiveStudentId;
    }

    // Determine the role for the REST target:
    // - If we're requesting data for a different person (parent logged in, child's data), role = STUDENT
    // - Otherwise, keep the original role (TEACHER, STUDENT, or LEGAL_GUARDIAN for self)
    let targetRole = role;
    if (role === 'LEGAL_GUARDIAN' && effectivePersonId !== ownPersonId) {
      // Parent logged in, but requesting child's data
      targetRole = 'STUDENT';
    }

    if (useQrLogin && school && server) {
      targets.push({
        mode: 'qr',
        school,
        server,
        username: null,
        password: null,
        personId: effectivePersonId || null,
        role: targetRole || null,
      });
    }

    if (!useQrLogin && hasParentCreds && effectivePersonId !== null) {
      targets.push({
        mode: 'parent',
        school: school || moduleConfig.school,
        server: server || moduleConfig.server || 'webuntis.com',
        username: moduleConfig.username,
        password: moduleConfig.password,
        personId: effectivePersonId,
        role: targetRole || null,
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
