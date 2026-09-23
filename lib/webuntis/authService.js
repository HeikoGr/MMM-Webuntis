/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const fetchClient = require("./fetchClient");
const { URL } = require("node:url");
const fs = require("node:fs");
const path = require("node:path");
const HttpClient = require("./httpClient");
const { tryOrNull, tryOrDefault, tryOrThrow } = require("./errorUtils");
const { API_TIMEOUT_MS } = require("./transportConstants");
const { cleanupOldRawDumps, redactDumpFields } = require("./debugDumpUtils");

const ROLE = Object.freeze({
  TEACHER: "TEACHER",
  STUDENT: "STUDENT",
  LEGAL_GUARDIAN: "LEGAL_GUARDIAN",
});

const ROLE_ALIASES = new Map([
  ["ROLE_TEACHER", ROLE.TEACHER],
  ["TEACHER", ROLE.TEACHER],
  ["DOZENT", ROLE.TEACHER],
  ["ROLE_STUDENT", ROLE.STUDENT],
  ["STUDENT", ROLE.STUDENT],
  ["PUPIL", ROLE.STUDENT],
  ["ROLE_LEGAL_GUARDIAN", ROLE.LEGAL_GUARDIAN],
  ["LEGAL_GUARDIAN", ROLE.LEGAL_GUARDIAN],
  ["GUARDIAN", ROLE.LEGAL_GUARDIAN],
  ["PARENT", ROLE.LEGAL_GUARDIAN],
  ["ELTERN", ROLE.LEGAL_GUARDIAN],
]);

// Auth timing constants
const TOKEN_TTL_MS = 14 * 60 * 1000; // 14 minutes - WebUntis token lifetime
const TOKEN_BUFFER_MS = 5 * 60 * 1000; // 5 minutes - safety buffer to prevent expired token usage

// How long a successful timetable probe (real fetch or auth canary) vouches for the account's
// token. Sibling module instances sharing the same account typically refresh within milliseconds
// of each other (see dataFetchOrchestrator.runAuthCanaryIfNeeded); this window lets them skip a
// redundant canary call without meaningfully weakening the "catch a silently invalidated session"
// guarantee the canary exists for.
const TIMETABLE_VERIFIED_WINDOW_MS = 10 * 1000;

// School years rarely change mid-session; cache the list for a while instead of refetching it
// for every fetch cycle.
const SCHOOL_YEARS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class AuthService {
  constructor(options = {}) {
    // Keep logger injection as the primary path to avoid coupling to module-level logger utilities.
    this.logger =
      typeof options.logger === "function"
        ? options.logger
        : (level, message) => {
            console.log(`[AuthService] [${level || "debug"}]`, message);
          };
    this.httpClient = new HttpClient({ logger: this.logger });
    // Cache structure: { token, cookieString, tenantId, schoolYearId, appData, rawAppData, personId, role, school, server, expiresAt, lastCookieValidation }
    // One entry per credential fingerprint (see node_helper._getCredentialKey); the service is
    // shared process-wide so every module instance using the same account reuses one session.
    this._authCache = new Map();
    this._pendingAuth = new Map(); // cacheKey -> Promise (for race condition protection)
    this._forceReauth = new Set(); // cacheKey set to force next auth to skip cache
    this._timetableVerifiedAt = new Map(); // cacheKey -> epoch ms of last successful timetable probe
    this._schoolYearsCache = new Map(); // cacheKey -> { years: [...], expiresAt }
  }

  /**
   * Record that the timetable endpoint just answered successfully for this account - the one
   * endpoint that reliably 401s on an invalid token instead of returning 200 with empty data.
   * @param {string} cacheKey - Credential fingerprint (see node_helper._getCredentialKey)
   */
  markTimetableVerified(cacheKey) {
    if (!cacheKey) return;
    this._timetableVerifiedAt.set(cacheKey, Date.now());
  }

  /**
   * Whether the timetable endpoint answered successfully for this account within the last
   * `windowMs`. Used to skip the auth-canary probe for a sibling module instance that shares the
   * account but has the timetable widget disabled.
   * @param {string} cacheKey - Credential fingerprint
   * @param {number} [windowMs] - Freshness window, defaults to TIMETABLE_VERIFIED_WINDOW_MS
   * @returns {boolean}
   */
  wasTimetableRecentlyVerified(cacheKey, windowMs = TIMETABLE_VERIFIED_WINDOW_MS) {
    if (!cacheKey) return false;
    const verifiedAt = this._timetableVerifiedAt.get(cacheKey);
    return Boolean(verifiedAt) && Date.now() - verifiedAt < windowMs;
  }

  /**
   * Extract person_id from JWT bearer token
   * @param {string} token - JWT bearer token
   * @returns {number|null} person_id from token payload, or null if not found
   */
  extractPersonIdFromToken(token) {
    if (!token || typeof token !== "string") return null;

    return tryOrNull(
      () => {
        const parts = token.split(".");
        if (parts.length !== 3) throw new Error("Invalid JWT format");

        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        const personId = Number(payload.person_id);

        if (!Number.isFinite(personId)) throw new Error("person_id not found in token");
        return personId;
      },
      (msg) => this.logger("debug", `[AuthService] Extract person_id: ${msg}`),
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
      this.logger("debug", "[AuthService] dumpRawApiResponses: dropping cached QR login for a fresh app/data");
      this._authCache.delete(effectiveCacheKey);
    }

    // Check cache (unless a forced reauth was requested)
    const forceReauth = this._forceReauth.has(effectiveCacheKey);
    if (forceReauth) {
      this.logger("debug", "[AuthService] QR Auth: forceReauth flag set, skipping cache");
      this._authCache.delete(effectiveCacheKey);
      this._pendingAuth.delete(effectiveCacheKey);
      this._forceReauth.delete(effectiveCacheKey);
    }

    const cached = forceReauth ? null : this._authCache.get(effectiveCacheKey);
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
      this.logger("debug", "[AuthService] Authentication already in progress, waiting...");
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
      userFromQR = url.searchParams.get("user");
    } catch {
      // Ignore URL parsing errors
    }

    // Full QR code authentication (fail-fast)
    const userInfo = userFromQR ? ` [${userFromQR}]` : "";
    // Info level on purpose: this is the one line per actual login. Cache hits return before
    // _performQRAuth is called, so switching to logLevel 'info' yields the re-login timestamps
    // needed to correlate fetch cycles with session drops - and nothing else.
    this.logger(
      "info",
      `[AuthService]${userInfo} QR Auth: Starting authentication (cached=${cached ? "exists" : "null"})`,
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
        expiresAt: Date.now() + TOKEN_TTL_MS,
        lastCookieValidation: Date.now(), // Set initial validation timestamp for QR auth
      });

      this.logger(
        "debug",
        `[AuthService]${userInfo} QR Auth: success (role=${role || "unknown"}, personId=${personId ?? "unknown"})`,
      );
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

    return tryOrThrow(performQRAuth, (msg) =>
      this.logger("error", `[AuthService] QR code authentication failed: ${msg}`),
    );
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
    const effectiveCacheKey = cacheKey || `user:${username || "session"}@${server || school || "default"}`;

    const forceReauth = this._forceReauth.has(effectiveCacheKey);
    if (forceReauth) {
      this.logger("debug", "[AuthService] REST auth: forceReauth flag set, skipping cache and authSession reuse");
      this._authCache.delete(effectiveCacheKey);
      // Do NOT delete _pendingAuth here - let parallel requests wait for the first auth to complete
      // Only clear the forceReauth flag so it doesn't affect subsequent requests
      this._forceReauth.delete(effectiveCacheKey);
    }

    // Force cache invalidation if dumpRawApiResponses is enabled (to get fresh raw app/data)
    if (options.dumpRawApiResponses && this._authCache.has(effectiveCacheKey)) {
      this.logger("debug", "[AuthService] dumpRawApiResponses: dropping cached login for a fresh app/data");
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
            this._writeDebugDump(server, "appdata_cached_raw", cached.rawAppData, "cached raw app/data");
          } else if (cached.appData) {
            this._writeDebugDump(server, "appdata_cached_compacted", cached.appData, "cached compacted app/data");
          }
        }
      } catch (err) {
        this.logger("debug", `[AuthService] Failed to dump cached appData: ${err?.message ? err.message : err}`);
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

    // Info level on purpose - see the QR counterpart in _performQRAuth: cache hits and pending-auth
    // joins both returned above, so this fires exactly once per real login.
    this.logger(
      "info",
      `[AuthService] REST auth: ${cached ? "cached session expiring, " : ""}logging in (school=${school}, server=${server}${forceReauth ? ", forced" : ""})`,
    );

    // Create a promise for this auth request
    const authPromise = this._performAuth(effectiveCacheKey, school, username, password, server, {
      ...options,
      forceReauth,
    });
    this._pendingAuth.set(effectiveCacheKey, authPromise);

    try {
      const result = await authPromise;
      this.logger(
        "debug",
        `[AuthService] REST auth: success (role=${result.role || "unknown"}, personId=${result.personId ?? "unknown"})`,
      );
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
    const dumpDir = path.join(__dirname, "..", "..", "debug_dumps");
    fs.mkdirSync(dumpDir, { recursive: true });
    const serverSafe = String(server || "server").replace(/[^a-z0-9.-]/gi, "_");
    const filename = `raw_api_${Date.now()}_${serverSafe}_${fileSuffix}.json`;
    const filePath = path.join(dumpDir, filename);
    // payload may be the live cached appData object (returned to other callers), so redact
    // a clone rather than mutating it in place.
    const redactedPayload = JSON.parse(JSON.stringify(payload ?? null));
    redactDumpFields(redactedPayload);
    fs.writeFileSync(filePath, JSON.stringify(redactedPayload, null, 2), { encoding: "utf8" });
    this.logger("debug", `[AuthService] Wrote ${logLabel} to ${filePath}`);
    cleanupOldRawDumps(dumpDir);
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
      throw new Error("No session cookies available from existing login");
    }

    let token = null;
    if (typeof untisClient._getJWT === "function") {
      token = await tryOrDefault(
        async () => untisClient._getJWT(false),
        null,
        (err) => this.logger("debug", `[REST] JWT via existing session: ${err}`),
      );
    }

    if (!token) {
      token = await tryOrDefault(
        async () => this.httpClient.getBearerToken(server, cookieString),
        null,
        (err) => this.logger("debug", `[REST] Bearer token via httpClient: ${err}`),
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
      throw new Error("No session cookies received");
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

    if (untisClient && typeof untisClient._buildCookies === "function") {
      return this._performAuthFromUntisClient(effectiveCacheKey, untisClient, server, options);
    }

    if (!username) {
      throw new Error("No username specified and no existing session available");
    }

    const performRestAuth = () =>
      this._performAuthFromCredentials(effectiveCacheKey, school, username, password, server, options);

    return tryOrThrow(performRestAuth, (msg) => this.logger("error", `[AuthService] REST auth failed: ${msg}`));
  }

  /**
   * Invalidate cached authentication for a specific cache key
   * Used when token expires or authentication fails
   * Also clears any pending auth requests to force fresh authentication
   * @param {string} cacheKey - Cache key to invalidate
   */
  invalidateCache(cacheKey) {
    if (!cacheKey) {
      this.logger("warn", `[AuthService] invalidateCache called with empty cacheKey: ${cacheKey}`);
      return false;
    }
    if (this._authCache.has(cacheKey)) {
      this._authCache.delete(cacheKey);
      // Also clear pending auth to force fresh authentication on next request
      // This ensures parallel requests don't keep using the old expired token
      this._pendingAuth.delete(cacheKey);
      // Force next auth call to skip any residual cache and re-run full QR auth
      this._forceReauth.add(cacheKey);
      // The invalidated token may be exactly what a recent "verified" mark was based on.
      this._timetableVerifiedAt.delete(cacheKey);
      // Info level on purpose: the counterpart to the login lines above. A login without a
      // preceding invalidation means the token simply aged out; with one, something rejected it.
      this.logger("info", "[AuthService] Invalidating expired token cache");
      return true;
    }
    return false;
  }

  /**
   * Fetch (and cache) every school year known to this account, most recent first.
   *
   * WebUntis scopes several REST endpoints (notably homework) to the school year named by the
   * X-Webuntis-Api-School-Year-Id header; a request whose header doesn't match the school year
   * that actually contains the queried date range comes back empty, even though the same data is
   * visible on the WebUntis website itself. The value cached at login always reflects "today",
   * which is wrong for any query targeting a different year - debugDate testing, or a real
   * request placed in the days just before/after the school year rolls over.
   *
   * @param {string} cacheKey - Credential fingerprint (see node_helper._getCredentialKey)
   * @param {Object} session - { token, cookieString, server } from an already-authenticated session
   * @returns {Promise<Array<{id: number, name: string, dateRange: {start: string, end: string}}>>}
   */
  async getSchoolYears(cacheKey, { token, cookieString, server }) {
    const cached = cacheKey ? this._schoolYearsCache.get(cacheKey) : null;
    if (cached && cached.expiresAt > Date.now()) return cached.years;

    try {
      const headers = { Accept: "application/json" };
      if (cookieString) headers.Cookie = cookieString;
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await fetchClient.get(`https://${server}/WebUntis/api/rest/view/v1/schoolyears`, {
        headers,
        timeout: API_TIMEOUT_MS,
      });
      const years = Array.isArray(resp.data) ? resp.data : [];
      if (cacheKey) this._schoolYearsCache.set(cacheKey, { years, expiresAt: Date.now() + SCHOOL_YEARS_CACHE_TTL_MS });
      return years;
    } catch (err) {
      this.logger("debug", `[AuthService] Failed to fetch school years: ${err?.message ? err.message : err}`);
      return [];
    }
  }

  /**
   * Pick the school year whose date range contains `date`.
   * @param {Array} years - Result of getSchoolYears()
   * @param {Date} date - Date to match
   * @returns {number|null} School year id, or null if none of the known years contains `date`
   */
  resolveSchoolYearId(years, date) {
    if (!Array.isArray(years) || !(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    const ymd = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    const match = years.find((year) => {
      const start = Number(String(year?.dateRange?.start || "").replaceAll("-", ""));
      const end = Number(String(year?.dateRange?.end || "").replaceAll("-", ""));
      return Number.isFinite(start) && Number.isFinite(end) && start <= ymd && ymd <= end;
    });
    return match ? match.id : null;
  }

  /**
   * Resolve the school year id that actually contains `date`, falling back to
   * `fallbackSchoolYearId` (typically the "current" id cached from login) when the school years
   * list is unavailable or none of them contains `date`.
   *
   * @param {string} cacheKey - Credential fingerprint
   * @param {Date} date - Date the caller is about to query (e.g. the fetch's baseNow/debugDate)
   * @param {Object} session - { token, cookieString, server, fallbackSchoolYearId }
   * @returns {Promise<number|null>}
   */
  async getSchoolYearIdForDate(cacheKey, date, { token, cookieString, server, fallbackSchoolYearId = null }) {
    const years = await this.getSchoolYears(cacheKey, { token, cookieString, server });
    const resolved = this.resolveSchoolYearId(years, date);
    return resolved ?? fallbackSchoolYearId;
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

    // fetchClient.get() throws on every non-2xx (a 401 or login redirect arrives as a tagged
    // auth error), so only 2xx responses reach the checks below.
    const headers = {
      Cookie: cookieString,
      Accept: "application/json",
    };

    // Add bearer token if available
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const appDataResp = await fetchClient.get(`https://${server}/WebUntis/api/rest/view/v1/app/data`, {
      headers,
      timeout: API_TIMEOUT_MS,
    });

    if (appDataResp.data && typeof appDataResp.data === "object") {
      appData = appDataResp.data;
      tenantId = appDataResp.data?.tenant?.id;
      schoolYearId = appDataResp.data?.currentSchoolYear?.id;

      // Optionally dump raw app/data response for debugging
      try {
        if (options.dumpRawApiResponses) {
          this._writeDebugDump(server, "appdata", appDataResp.data, "raw app/data");
        }
      } catch (dumpErr) {
        this.logger(
          "warn",
          `[AuthService] Failed to write raw app/data dump: ${dumpErr?.message ? dumpErr.message : dumpErr}`,
        );
      }
    }

    if (!appData) {
      this.logger(
        "warn",
        `[AuthService] app/data HTTP ${appDataResp.status} without JSON body (server=${server || "unknown"}); no tenant, school year or child list for this session`,
      );
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
    const normalized = String(role || "")
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, "_");
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
            .map((r) => (typeof r === "string" ? r : r?.role || r?.name || null))
            .filter(Boolean)
            .map((r) => this._normalizeRoleValue(r))
            .filter(Boolean),
        ),
      );
    }
    if (typeof roles === "string") {
      const normalized = this._normalizeRoleValue(roles);
      return normalized ? [normalized] : [];
    }
    if (typeof roles === "object" && (roles.role || roles.name)) {
      const normalized = this._normalizeRoleValue(String(roles.role || roles.name));
      return normalized ? [normalized] : [];
    }
    return [];
  }

  _normalizeIdentityString(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
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
  buildRestTargets(
    student,
    moduleConfig,
    school,
    server,
    ownPersonId,
    bearerToken = null,
    appData = null,
    role = null,
  ) {
    const targets = [];
    const useQrLogin = Boolean(student.qrcode);
    const wantsClassTimetable = Boolean(student.useClassTimetable);
    const hasOwnCredentials = Boolean(student.username && student.password && student.school && student.server);
    const hasPartialOwnCredentials = Boolean(student.username || student.password || student.school || student.server);
    const linkedChildren = Array.isArray(appData?.user?.students) ? appData.user.students : [];
    const hasManualStudentId =
      student.studentId && Number.isFinite(Number(student.studentId)) && !student._autoDiscovered;
    const hasAutoDiscoveredStudentId =
      student.studentId && Number.isFinite(Number(student.studentId)) && student._autoDiscovered;
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
        server: server || moduleConfig.server || "webuntis.com",
        personId: effectivePersonId,
        role: targetRole || null,
      });
    }

    // Diagnostic logging when no targets were built
    if (targets.length === 0) {
      const diagnostics = [];
      if (!useQrLogin && !hasOwnCredentials && !hasParentCreds) {
        diagnostics.push("No credentials configured (need qrcode, student credentials, or parent credentials)");
      }
      if (hasPartialOwnCredentials && !hasOwnCredentials) {
        diagnostics.push("Student credentials are incomplete (need username, password, school, and server together)");
      }
      if (hasOwnCredentials && (student.username === "" || student.password === "")) {
        diagnostics.push("Student credentials are empty strings (should be omitted or filled)");
      }
      if (useQrLogin && (!school || !server)) {
        diagnostics.push(`QR login missing school=${school || "null"} or server=${server || "null"}`);
      }
      if (!useQrLogin && hasParentCreds && effectivePersonId === null) {
        diagnostics.push(
          `Parent credentials configured but no studentId resolvable (missing student.studentId or appData.user.students empty)`,
        );
        if (linkedChildren.length > 1) {
          diagnostics.push(
            "Parent login has multiple linked children and no exact title match. Configure student.studentId or set student.title to the exact child display name.",
          );
        }
        if (wantsClassTimetable) {
          diagnostics.push(
            "useClassTimetable is enabled, but no parent personId was available for timetable/filter class fallback.",
          );
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
   * End every cached WebUntis session on the server (best effort, used on shutdown).
   *
   * WebUntis lets sessions linger until their idle timeout; logging out keeps the server-side
   * session count of an account from growing with every MagicMirror restart.
   *
   * @returns {Promise<number>} Number of logout calls attempted
   */
  async logoutAll() {
    const entries = Array.from(this._authCache.values()).filter(
      (entry) => entry?.cookieString && entry?.server && entry?.school,
    );
    this._authCache.clear();
    this._pendingAuth.clear();
    this._forceReauth.clear();

    await Promise.all(entries.map((entry) => this.httpClient.logout(entry.server, entry.school, entry.cookieString)));
    if (entries.length > 0) {
      this.logger("debug", `[AuthService] Logged out ${entries.length} cached session(s)`);
    }
    return entries.length;
  }
}

module.exports = AuthService;
