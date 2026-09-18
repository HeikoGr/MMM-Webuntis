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
  const hasOwnCredentials = student.qrcode || (student.username && student.password && student.school && student.server);
  const isParentMode = hasStudentId && !hasOwnCredentials;

  if (isParentMode && moduleConfig) {
    if (moduleConfig.qrcode) return `qrcode:${moduleConfig.qrcode}`;
    return `parent:${moduleConfig.username || 'undefined'}@${moduleConfig.server || 'webuntis.com'}/${moduleConfig.school || 'undefined'}`;
  }

  if (student.qrcode) return `qrcode:${student.qrcode}`;
  const server = student.server || 'default';
  return `user:${student.username}@${server}/${student.school}`;
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
    return authService.getAuthFromQRCode(moduleConfig.qrcode, { cacheKey: getParentCredentialKey(moduleConfig, server) });
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
    const server = useStudentCreds ? sample.server : sample.server || moduleConfig.server || 'webuntis.com';
    const username = useStudentCreds ? sample.username : moduleConfig.username;
    const password = useStudentCreds ? sample.password : moduleConfig.password;

    const authResult = await authService.getAuth({
      school,
      username,
      password,
      server,
      options: { cacheKey: cacheKey || `${useStudentCreds ? 'student' : 'parent'}:${username}@${server}/${school}` },
    });
    return toAuthSession({ ...authResult, school, server }, { username });
  }

  throw new Error(
    [
      '',
      'Credentials missing! need either:',
      '  (1) studentId + username/password in module config, or',
      '  (2) username/password/school/server in student config, or',
      '  (3) qrcode in student config for QR code login, or',
      '  (4) qrcode in module config for parent (LEGAL_GUARDIAN) authentication',
      '',
    ].join('\n')
  );
}

module.exports = {
  createAuthSession,
  getCredentialKey,
  getParentAuthResult,
  getParentCredentialKey,
};
