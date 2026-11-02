/**
 * Credential resolution for the MagicMirror adapter: which credentials a student entry uses,
 * the cache key that identifies that account, and the auth-session object the fetch flow
 * works with.
 */

/**
 * Build the credential fingerprint used for auth caching and fetch grouping.
 *
 * The key is deliberately NOT scoped by module instance, browser session or carouselId:
 * every consumer of the same account shares one WebUntis session (WebUntis does not invalidate
 * older sessions on re-login, and sharing keeps one session warm across instances).
 * For parent accounts (studentId + module-level username) the parent credentials are the
 * fingerprint; for direct student logins the student's own credentials are.
 *
 * @param {Object} student - Student credential object
 * @param {Object} moduleConfig - Module configuration
 * @returns {string} credential key (e.g., "parent:user@server/school")
 */
function getCredentialKey(student, moduleConfig) {
  const hasStudentId = student.studentId && Number.isFinite(Number(student.studentId));
  const hasOwnCredentials =
    student.qrcode || (student.username && student.password && student.school && student.server);
  const isParentMode = hasStudentId && !hasOwnCredentials;

  if (isParentMode && moduleConfig) {
    if (moduleConfig.qrcode) return `qrcode:${moduleConfig.qrcode}`;
    return `parent:${moduleConfig.username || "undefined"}@${moduleConfig.server || "webuntis.com"}/${moduleConfig.school || "undefined"}`;
  }

  if (student.qrcode) return `qrcode:${student.qrcode}`;
  const server = student.server || "default";
  return `user:${student.username}@${server}/${student.school}`;
}

/**
 * Printable form of a credential key for logs and warnings. A QR-code key holds the whole QR URL
 * including its `key` OTP secret (issue #147), so it is shown as `qrcode:user@server/school` like
 * the other kinds; `user:`/`parent:` keys carry no secret and stay as they are.
 *
 * @param {string} credKey - Key from getCredentialKey()/getParentCredentialKey()
 * @returns {string} Label without secrets
 */
function describeCredentialKey(credKey) {
  const text = String(credKey || "");
  if (!text.startsWith("qrcode:")) return text;
  const params = parseQrCodeParams(text.slice("qrcode:".length));
  if (!params) return "qrcode:(malformed)";
  return `qrcode:${params.get("user") || "?"}@${params.get("url") || "?"}/${params.get("school") || "?"}`;
}

/** @returns {URLSearchParams|null} Parameters of a QR-code URL, null when it does not parse */
function parseQrCodeParams(qrcode) {
  try {
    return new URL(String(qrcode)).searchParams;
  } catch {
    return null;
  }
}

/**
 * WebUntis server a student talks to, for user-facing texts: its own server, the one in its QR
 * code, then the module-level ones.
 *
 * @param {Object} student - Student config
 * @param {Object} moduleConfig - Module config
 * @returns {string} Server hostname
 */
function resolveServerName(student, moduleConfig) {
  const fromQr = (qrcode) => (qrcode ? parseQrCodeParams(qrcode)?.get("url") : null);
  return (
    student?.server || fromQr(student?.qrcode) || moduleConfig?.server || fromQr(moduleConfig?.qrcode) || "webuntis.com"
  );
}

/**
 * Cache key for module-level (parent) credentials, identical to what getCredentialKey() yields
 * for a parent-mode student so discovery and fetching share one login.
 *
 * @param {Object} moduleConfig - Module configuration
 * @param {string} server - Resolved server
 * @returns {string} cache key
 */
function getParentCredentialKey(moduleConfig, server) {
  if (moduleConfig.qrcode) return `qrcode:${moduleConfig.qrcode}`;
  return `parent:${moduleConfig.username}@${server}/${moduleConfig.school}`;
}

/**
 * Authenticate with module-level parent credentials (QR or username/password).
 *
 * @param {import('./webuntis/authService')} authService - Shared auth service
 * @param {Object} moduleConfig - Module configuration
 * @param {string} server - Target server hostname
 * @returns {Promise<Object>} Auth result from authService
 */
async function getParentAuthResult(authService, moduleConfig, server) {
  if (moduleConfig.qrcode) {
    return authService.getAuthFromQRCode(moduleConfig.qrcode, {
      cacheKey: getParentCredentialKey(moduleConfig, server),
    });
  }
  return authService.getAuth({
    school: moduleConfig.school,
    username: moduleConfig.username,
    password: moduleConfig.password,
    server,
    options: { cacheKey: getParentCredentialKey(moduleConfig, server) },
  });
}

function toAuthSession(authResult, extra) {
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
    ...extra,
  };
}

/**
 * Create an authenticated session for a student (or the parent account it belongs to).
 *
 * @param {import('./webuntis/authService')} authService - Shared auth service
 * @param {Object} sample - Student configuration
 * @param {Object} moduleConfig - Module configuration
 * @param {string} cacheKey - Credential key from getCredentialKey()
 * @returns {Promise<Object>} Session object { school, server, personId, role, cookieString, token, tenantId, schoolYearId, appData, qrCodeUrl|username }
 * @throws {Error} When no usable credentials are configured
 */
async function createAuthSession(authService, sample, moduleConfig, cacheKey) {
  const useQrLogin = Boolean(sample.qrcode);
  const hasOwnCredentials = sample.username && sample.password && sample.school && sample.server;
  const hasParentCredentials = moduleConfig?.username && moduleConfig.password && moduleConfig.school;
  const useParentQr = !useQrLogin && Boolean(moduleConfig?.qrcode);
  const useParentCreds = !useQrLogin && !useParentQr && hasParentCredentials;

  if (useQrLogin || useParentQr) {
    const qrCode = useQrLogin ? sample.qrcode : moduleConfig.qrcode;
    const authResult = await authService.getAuthFromQRCode(qrCode, { cacheKey: cacheKey || `qrcode:${qrCode}` });
    return toAuthSession(authResult, { qrCodeUrl: qrCode });
  }

  if (useParentCreds || hasOwnCredentials) {
    const useStudentCreds = Boolean(hasOwnCredentials);
    const school = useStudentCreds ? sample.school : sample.school || moduleConfig.school;
    const server = useStudentCreds ? sample.server : sample.server || moduleConfig.server || "webuntis.com";
    const username = useStudentCreds ? sample.username : moduleConfig.username;
    const password = useStudentCreds ? sample.password : moduleConfig.password;

    const authResult = await authService.getAuth({
      school,
      username,
      password,
      server,
      options: { cacheKey: cacheKey || `${useStudentCreds ? "student" : "parent"}:${username}@${server}/${school}` },
    });
    // The password stays with the session: after a 401 the REST layer logs in again with exactly these
    // credentials (webuntisClient._buildRestAuthHandlers); without it that login fails with
    // "bad credentials".
    return toAuthSession({ ...authResult, school, server }, { username, password });
  }

  throw new Error(
    [
      "",
      "Credentials missing! need either:",
      "  (1) studentId + username/password in module config, or",
      "  (2) username/password/school/server in student config, or",
      "  (3) qrcode in student config for QR code login, or",
      "  (4) qrcode in module config for parent (LEGAL_GUARDIAN) authentication",
      "",
    ].join("\n"),
  );
}

module.exports = {
  createAuthSession,
  describeCredentialKey,
  getCredentialKey,
  getParentAuthResult,
  getParentCredentialKey,
  resolveServerName,
};
