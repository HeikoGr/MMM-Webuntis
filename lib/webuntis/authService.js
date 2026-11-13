/**
 * Authentication Service for WebUntis
 * Handles authentication, token management, and session caching
 */

const fetchClient = require("./fetchClient");
const { URL } = require("node:url");
const HttpClient = require("./httpClient");
const { tryOrNull, wrapAsync } = require("./errorUtils");
const { API_TIMEOUT_MS } = require("./transportConstants");
const { DEBUG_DUMP_DIR, cleanupOldRawDumps, redactDumpFields, writeDumpFile } = require("./debugDumpUtils");

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
const TOKEN_TTL_MS = 14 * 60 * 1000; // 14 minutes - assumed token lifetime when the JWT carries no `exp`
// A fetch takes seconds, so a token is reused until shortly before it expires. A buffer close to
// the fetch interval would renew the token on every second fetch.
const TOKEN_BUFFER_MS = 60 * 1000;
// An expiring token is renewed from the session cookie (one request) instead of a full login (three)
// - until the session is this old. Then a real login refreshes the app/data the cache also holds.
const MAX_SESSION_AGE_MS = 6 * 60 * 60 * 1000;
// After a failed login the same error answers every request for this long instead of a new login
// attempt: one expired session makes several endpoints ask for a login within milliseconds, and the
// server should not get a burst of attempts with the same credentials.
const LOGIN_FAILURE_COOLDOWN_MS = 30 * 1000;

// How long a successful timetable probe (real fetch or auth canary) vouches for the account's
// token. Sibling module instances sharing the same account typically refresh within milliseconds
// of each other (see dataFetchOrchestrator.runAuthCanaryIfNeeded); this window lets them skip a
// redundant canary call without meaningfully weakening the "catch a silently invalidated session"
// guarantee the canary exists for.
const TIMETABLE_VERIFIED_WINDOW_MS = 10 * 1000;

// School years rarely change mid-session; cache the list for a while instead of refetching it
// for every fetch cycle.
const SCHOOL_YEARS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * What a login hands its callers: the cache entry without its bookkeeping (expiresAt,
 * sessionStartedAt).
 * @param {Object} entry - Cache entry or freshly assembled login data
 * @returns {Object} { token, cookieString, tenantId, schoolYearId, appData, personId, role, school, server }
 */
function toAuthResult(entry) {
  return {
    token: entry.token,
    cookieString: entry.cookieString,
    tenantId: entry.tenantId,
    schoolYearId: entry.schoolYearId,
    appData: entry.appData || null,
    personId: entry.personId,
    role: entry.role || null,
    school: entry.school,
    server: entry.server,
  };
}

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
    // Cache entry: the auth result (see toAuthResult) plus expiresAt and sessionStartedAt.
    // One entry per credential fingerprint (see node_helper._getCredentialKey); the service is
    // shared process-wide so every module instance using the same account reuses one session.
    this._authCache = new Map();
    this._pendingAuth = new Map(); // cacheKey -> Promise (for race condition protection)
    this._forceReauth = new Set(); // cacheKey set to force next auth to skip cache
    this._loginFailures = new Map(); // cacheKey -> { at, error } of the last failed login (see LOGIN_FAILURE_COOLDOWN_MS)
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
   * The payload of a JWT bearer token.
   * @param {string} token - JWT bearer token
   * @returns {Object} Decoded payload
   * @throws {Error} When the token is no JWT
   */
  _decodeJwtPayload(token) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT format");
    return JSON.parse(Buffer.from(parts[1], "base64").toString());
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
        const personId = Number(this._decodeJwtPayload(token).person_id);
        if (!Number.isFinite(personId)) throw new Error("person_id not found in token");
        return personId;
      },
      (msg) => this.logger("debug", `[AuthService] Extract person_id: ${msg}`),
    );
  }

  /**
   * When the token stops being valid: the JWT's `exp`, else TOKEN_TTL_MS from now.
   * @param {string} token - JWT bearer token
   * @returns {number} Epoch milliseconds
   */
  _tokenExpiresAt(token) {
    const exp = tryOrNull(() => Number(this._decodeJwtPayload(token).exp));
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : Date.now() + TOKEN_TTL_MS;
  }

  /**
   * A cached token is used until shortly before it expires (TOKEN_BUFFER_MS): parallel requests
   * must not run into its expiry, and some endpoints answer an expired token with 200 and empty
   * data instead of 401.
   * @param {Object|undefined} cached - Cache entry
   * @returns {boolean}
   */
  _isFresh(cached) {
    return Boolean(cached) && cached.expiresAt > Date.now() + TOKEN_BUFFER_MS;
  }

  /**
   * Get REST API authentication via QR code
   * @param {string} qrCodeUrl - QR code URL from WebUntis
   * @param {Object} options - Additional options (cacheKey)
   * @returns {Promise<Object>} { token, cookieString, tenantId, schoolYearId, appData, personId, school, server }
   */
  async getAuthFromQRCode(qrCodeUrl, options = {}) {
    const effectiveCacheKey = options.cacheKey || `qrcode:${qrCodeUrl}`;

    // After invalidateCache (an auth error) the next login must not reuse anything cached.
    const forceReauth = this._forceReauth.has(effectiveCacheKey);
    if (forceReauth) {
      this.logger("debug", "[AuthService] QR Auth: forceReauth flag set, skipping cache");
      this._authCache.delete(effectiveCacheKey);
      this._forceReauth.delete(effectiveCacheKey);
    }

    const cached = this._authCache.get(effectiveCacheKey);
    // Any auth error later triggers a full re-authentication via the onAuthError callback.
    if (this._isFresh(cached)) return toAuthResult(cached);

    // Race condition protection: if auth is already in progress, wait for it
    if (this._pendingAuth.has(effectiveCacheKey)) {
      this.logger("debug", "[AuthService] Authentication already in progress, waiting...");
      return await this._pendingAuth.get(effectiveCacheKey);
    }

    this._throwOnRecentLoginFailure(effectiveCacheKey);

    const authPromise = this._performQRAuth(effectiveCacheKey, qrCodeUrl, cached, options);
    this._pendingAuth.set(effectiveCacheKey, authPromise);

    try {
      const result = await authPromise;
      this._loginFailures.delete(effectiveCacheKey);
      return result;
    } catch (error) {
      this._rememberLoginFailure(effectiveCacheKey, error);
      throw error;
    } finally {
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
      const { cookies, personId, school, server } = await this.httpClient.authenticateWithQRCode(qrCodeUrl);
      const token = await this.httpClient.getBearerToken(server, cookies);
      const metadata = await this._fetchAppData(server, cookies, token, options);
      const role = this._extractRoleFromAppData(metadata.appData);

      const result = toAuthResult({ token, cookieString: cookies, ...metadata, personId, role, school, server });
      this._cacheAuthResult(effectiveCacheKey, result);
      this.logger(
        "debug",
        `[AuthService]${userInfo} QR Auth: success (role=${role || "unknown"}, personId=${personId ?? "unknown"})`,
      );
      return result;
    };

    return wrapAsync(performQRAuth, {
      logger: (msg) => this.logger("error", `[AuthService] QR code authentication failed: ${msg}`),
      rethrow: true,
    });
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
      this.logger("debug", "[AuthService] REST auth: forceReauth flag set, skipping cache");
      this._authCache.delete(effectiveCacheKey);
      // _pendingAuth stays: parallel requests wait for the login already under way.
      this._forceReauth.delete(effectiveCacheKey);
    }

    const cached = this._authCache.get(effectiveCacheKey);
    if (this._isFresh(cached)) return toAuthResult(cached);

    // Race condition protection: if auth is already in progress, wait for it
    if (this._pendingAuth.has(effectiveCacheKey)) {
      // Waiting for pending auth silently (common during parallel requests)
      return await this._pendingAuth.get(effectiveCacheKey);
    }

    // A login that just failed answers again with its error (see LOGIN_FAILURE_COOLDOWN_MS)
    this._throwOnRecentLoginFailure(effectiveCacheKey);

    // An expiring token is renewed from the session cookie when that still works; a real login
    // (info level on purpose - see the QR counterpart in _performQRAuth: cache hits, renewals and
    // pending-auth joins never reach it) follows otherwise, exactly once per real login.
    const login = () => {
      this.logger(
        "info",
        `[AuthService] REST auth: ${cached ? "cached session expiring, " : ""}logging in (school=${school}, server=${server}${forceReauth ? ", forced" : ""})`,
      );
      return this._performAuthFromCredentials(effectiveCacheKey, school, username, password, server, options);
    };
    const renewable = cached && this._canRenewToken(cached);
    const authPromise = renewable
      ? this._renewToken(effectiveCacheKey, cached).then((renewed) => renewed || login())
      : login();
    this._pendingAuth.set(effectiveCacheKey, authPromise);

    try {
      const result = await authPromise;
      this.logger(
        "debug",
        `[AuthService] REST auth: success (role=${result.role || "unknown"}, personId=${result.personId ?? "unknown"})`,
      );
      this._loginFailures.delete(effectiveCacheKey);
      return result;
    } catch (error) {
      this._rememberLoginFailure(effectiveCacheKey, error);
      throw error;
    } finally {
      // Clean up pending auth after completion
      this._pendingAuth.delete(effectiveCacheKey);
    }
  }

  /**
   * Fail fast while the last login for this account failed less than LOGIN_FAILURE_COOLDOWN_MS ago.
   * @private
   * @param {string} cacheKey - Credential fingerprint
   * @throws {Error} The error of that login
   */
  _throwOnRecentLoginFailure(cacheKey) {
    const failure = this._loginFailures.get(cacheKey);
    if (!failure) return;
    if (Date.now() - failure.at >= LOGIN_FAILURE_COOLDOWN_MS) {
      this._loginFailures.delete(cacheKey);
      return;
    }
    this.logger("debug", "[AuthService] Not logging in again yet, the last login failed moments ago");
    throw failure.error;
  }

  /**
   * @private
   * @param {string} cacheKey - Credential fingerprint
   * @param {Error} error - Why the login failed
   */
  _rememberLoginFailure(cacheKey, error) {
    this._loginFailures.set(cacheKey, { at: Date.now(), error });
  }

  /**
   * Whether the cached session may still get a new token from its cookie: it knows its server, and
   * it is a real login (only those record a start) younger than MAX_SESSION_AGE_MS.
   * @private
   * @param {Object} cached - Cache entry
   * @returns {boolean}
   */
  _canRenewToken(cached) {
    return Boolean(
      cached?.cookieString &&
        cached.server &&
        Number.isFinite(cached.sessionStartedAt) &&
        Date.now() - cached.sessionStartedAt < MAX_SESSION_AGE_MS,
    );
  }

  /**
   * Get a new bearer token with the cached session's cookie and keep everything else (tenant,
   * school year, app/data). The classic session cookie idles out after about five minutes, so this
   * works only while the fetches keep it warm (exams, homework and absences use it); otherwise it
   * fails and the caller logs in. Never throws: null means "log in again".
   * @private
   * @param {string} cacheKey - Credential fingerprint
   * @param {Object} cached - Cache entry
   * @returns {Promise<Object|null>} The auth result, or null when the cookie no longer works
   */
  async _renewToken(cacheKey, cached) {
    try {
      const token = await this.httpClient.getBearerToken(cached.server, cached.cookieString);
      const renewed = { ...cached, token, expiresAt: this._tokenExpiresAt(token) };
      this._authCache.set(cacheKey, renewed);
      this.logger("debug", "[AuthService] REST auth: token renewed from the existing session");
      return toAuthResult(renewed);
    } catch (error) {
      this.logger("debug", `[AuthService] Token renewal failed, logging in: ${error?.message || error}`);
      return null;
    }
  }

  /**
   * A re-login for an account whose cached session had only aged out leaves that session on the
   * server until its idle timeout. Log it out in the background (best effort) so the account's
   * session count does not grow with every re-login.
   * @private
   * @param {string} cacheKey - Credential fingerprint
   * @param {string} newCookies - Cookies of the session that replaces it
   */
  _retireReplacedSession(cacheKey, newCookies) {
    const previous = this._authCache.get(cacheKey);
    if (!previous?.cookieString || previous.cookieString === newCookies || !previous.server || !previous.school) {
      return;
    }
    this.httpClient.logout(previous.server, previous.school, previous.cookieString).catch((error) => {
      this.logger("debug", `[AuthService] Logout of the replaced session failed: ${error?.message || error}`);
    });
  }

  /**
   * Store a completed login; sessionStartedAt opens the window in which its token may be renewed.
   * @private
   */
  _cacheAuthResult(effectiveCacheKey, result) {
    this._retireReplacedSession(effectiveCacheKey, result.cookieString);
    this._authCache.set(effectiveCacheKey, {
      ...result,
      sessionStartedAt: Date.now(),
      expiresAt: this._tokenExpiresAt(result.token),
    });
  }

  _writeDebugDump(server, fileSuffix, payload, logLabel) {
    const serverSafe = String(server || "server").replace(/[^a-z0-9.-]/gi, "_");
    const redactedPayload = JSON.parse(JSON.stringify(payload ?? null));
    redactDumpFields(redactedPayload);
    const filePath = writeDumpFile(`raw_api_${Date.now()}_${serverSafe}_${fileSuffix}.json`, redactedPayload);
    this.logger("debug", `[AuthService] Wrote ${logLabel} to ${filePath}`);
    cleanupOldRawDumps(DEBUG_DUMP_DIR);
  }

  async _performAuthFromCredentials(effectiveCacheKey, school, username, password, server, options) {
    if (!username) {
      throw new Error("No username specified and no existing session available");
    }

    try {
      const { cookies: cookieString } = await this.httpClient.authenticateWithCredentials({
        school,
        username,
        password,
        server,
      });
      if (!cookieString) {
        throw new Error("No session cookies received");
      }

      const token = await this.httpClient.getBearerToken(server, cookieString);
      const metadata = await this._fetchAppData(server, cookieString, token, options);
      const result = toAuthResult({
        token,
        cookieString,
        ...metadata,
        personId: metadata.appData?.user?.person?.id || null,
        role: this._extractRoleFromAppData(metadata.appData),
        // Needed to log this session out later (replaced by a re-login, or on shutdown).
        school,
        server,
      });
      this._cacheAuthResult(effectiveCacheKey, result);
      return result;
    } catch (error) {
      this.logger("error", `[AuthService] REST auth failed: ${error?.message || error}`);
      throw error;
    }
  }

  /**
   * Invalidate cached authentication for a specific cache key
   * Used when token expires or authentication fails
   * Also clears any pending auth requests to force fresh authentication
   * @param {string} cacheKey - Cache key to invalidate
   * @param {Object} [options]
   * @param {string} [options.failedToken] - Token of the request that failed. When the cache already
   *   holds a different one (a parallel request logged in again meanwhile), the cache is kept: the
   *   caller retries with the new session instead of discarding it for a third login.
   * @returns {boolean} True when a cached session was discarded
   */
  invalidateCache(cacheKey, { failedToken } = {}) {
    if (!cacheKey) {
      this.logger("warn", `[AuthService] invalidateCache called with empty cacheKey: ${cacheKey}`);
      return false;
    }
    const cached = this._authCache.get(cacheKey);
    if (cached && failedToken && cached.token !== failedToken) {
      this.logger("debug", "[AuthService] Auth error from a replaced session; keeping the current one");
      return false;
    }
    if (cached) {
      this._authCache.delete(cacheKey);
      // Also clear pending auth to force fresh authentication on next request,
      // so parallel requests do not keep using the expired token
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

  /**
   * Fetch app/data to get tenantId and schoolYearId
   * @private
   */
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

      // dumpRawApiResponses: the raw app/data of every real login (roles, linked children, tenant)
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

    return { tenantId, schoolYearId, appData: this._compactAppData(appData) };
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

    // First role if none of the expected ones
    return roles[0];
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
   * @param {Object} params
   * @param {Object} params.student - Student configuration
   * @param {Object} params.moduleConfig - Module configuration
   * @param {string} params.school - Resolved school identifier
   * @param {string} params.server - Resolved server hostname
   * @param {number} params.ownPersonId - Own person ID from login (parent, student, or teacher depending on login type)
   * @param {string} [params.bearerToken] - JWT bearer token to extract person_id from
   * @param {Object} [params.appData] - App data with user.students[] for parent account child mapping
   * @param {string} [params.role] - User role: 'STUDENT', 'LEGAL_GUARDIAN', or 'TEACHER'
   * @returns {Array} Array of target objects { personId, role, school, server }
   */
  buildRestTargets({
    student,
    moduleConfig,
    school,
    server,
    ownPersonId,
    bearerToken = null,
    appData = null,
    role = null,
  }) {
    const login = this._describeLogin(student, moduleConfig, appData, role);
    const personId = this._resolveTargetPersonId(student, login, ownPersonId, bearerToken);

    // Parent logged in, but asking for a child's data: the target is that student.
    const targetRole =
      login.role === ROLE.LEGAL_GUARDIAN && personId !== ownPersonId ? ROLE.STUDENT : login.role || null;

    const targets = [];
    if (login.useQrLogin && school && server) {
      targets.push({ school, server, personId: personId || null, role: targetRole });
    }
    if (!login.useQrLogin && login.hasOwnCredentials && personId !== null) {
      targets.push({ school, server, personId, role: targetRole });
    }
    if (!login.useQrLogin && login.hasParentCreds && personId !== null) {
      targets.push({
        school: school || moduleConfig.school,
        server: server || moduleConfig.server || "webuntis.com",
        personId,
        role: targetRole,
      });
    }

    if (targets.length === 0) {
      this._logEmptyRestTargets(student, login, { school, server, personId });
    }
    return targets;
  }

  /**
   * How this student logs in and what the login knows about linked children.
   * @private
   */
  _describeLogin(student, moduleConfig, appData, role) {
    const useQrLogin = Boolean(student.qrcode);
    const hasOwnCredentials = Boolean(student.username && student.password && student.school && student.server);
    const hasParentCreds = Boolean(moduleConfig?.username && moduleConfig?.password);
    return {
      useQrLogin,
      hasOwnCredentials,
      hasParentCreds,
      // The login actually used for THIS student, not just which credentials exist.
      isParentLogin: !useQrLogin && !hasOwnCredentials && hasParentCreds,
      role: this._normalizeRoleValue(role) || this._extractRoleFromAppData(appData),
      linkedChildren: Array.isArray(appData?.user?.students) ? appData.user.students : [],
    };
  }

  /**
   * Whose timetable to fetch. personId (the login) differs from the studentId (the timetable)
   * for a LEGAL_GUARDIAN; a TEACHER always fetches for itself. Order for everyone else:
   * configured studentId, auto-discovered studentId, the matching (or only) linked child of a
   * parent login, the login itself for a student login, the JWT person_id, and finally the login
   * for any non-guardian (or for a parent's class timetable).
   * @private
   */
  _resolveTargetPersonId(student, login, ownPersonId, bearerToken) {
    if (login.role === ROLE.TEACHER) return ownPersonId;

    const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
    let studentId = hasStudentId ? Number(student.studentId) : null;

    if (!studentId && ownPersonId) {
      studentId = this._studentIdFromLogin(student, login, ownPersonId);
    }
    if (!studentId && bearerToken) {
      studentId = this.extractPersonIdFromToken(bearerToken) || studentId;
    }
    if (!studentId && ownPersonId && login.role !== ROLE.LEGAL_GUARDIAN) {
      // Shared or non-parent logins where WebUntis authenticates one person but app/data has
      // no child list or incomplete role metadata.
      studentId = ownPersonId;
    }
    if (!studentId && login.isParentLogin && student.useClassTimetable && ownPersonId) {
      // Lets the class timetable continue with the parent login; _resolveClassIdViaRest() then
      // falls back to timetable/filter.
      return ownPersonId;
    }
    return studentId;
  }

  /**
   * The student behind a login: the matching (or only) linked child for a parent login, the
   * login itself for a student login.
   * @private
   */
  _studentIdFromLogin(student, login, ownPersonId) {
    if (login.isParentLogin && login.linkedChildren.length > 0) {
      const child =
        this._matchChildByStudentTitle(login.linkedChildren, student.title) ||
        (login.linkedChildren.length === 1 ? login.linkedChildren[0] : null);
      return child ? Number(child.id || child.studentId || child.personId) : null;
    }
    if (login.role === ROLE.STUDENT || !login.isParentLogin) {
      return ownPersonId;
    }
    return null;
  }

  /**
   * Explain in the debug log why no REST target could be built.
   * @private
   */
  _logEmptyRestTargets(student, login, { school, server, personId }) {
    const hasPartialOwnCredentials = Boolean(student.username || student.password || student.school || student.server);
    const diagnostics = [];
    if (!login.useQrLogin && !login.hasOwnCredentials && !login.hasParentCreds) {
      diagnostics.push("No credentials configured (need qrcode, student credentials, or parent credentials)");
    }
    if (hasPartialOwnCredentials && !login.hasOwnCredentials) {
      diagnostics.push("Student credentials are incomplete (need username, password, school, and server together)");
    }
    if (login.hasOwnCredentials && (student.username === "" || student.password === "")) {
      diagnostics.push("Student credentials are empty strings (should be omitted or filled)");
    }
    if (login.useQrLogin && (!school || !server)) {
      diagnostics.push(`QR login missing school=${school || "null"} or server=${server || "null"}`);
    }
    if (!login.useQrLogin && login.hasParentCreds && personId === null) {
      diagnostics.push(
        `Parent credentials configured but no studentId resolvable (missing student.studentId or appData.user.students empty)`,
      );
      if (login.linkedChildren.length > 1) {
        diagnostics.push(
          "Parent login has multiple linked children and no exact title match. Configure student.studentId or set student.title to the exact child display name.",
        );
      }
      if (student.useClassTimetable) {
        diagnostics.push(
          "useClassTimetable is enabled, but no parent personId was available for timetable/filter class fallback.",
        );
      }
    }
    if (diagnostics.length > 0) {
      this.logger("debug", `[AuthService] buildRestTargets returned empty: ${diagnostics.join("; ")}`);
    }
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
    this._loginFailures.clear();

    await Promise.all(entries.map((entry) => this.httpClient.logout(entry.server, entry.school, entry.cookieString)));
    if (entries.length > 0) {
      this.logger("debug", `[AuthService] Logged out ${entries.length} cached session(s)`);
    }
    return entries.length;
  }
}

module.exports = AuthService;
