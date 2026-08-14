/**
 * Student credential validation for MMM-Webuntis
 *
 * Per-plugin config validation lives in the plugin backends and uses
 * lib/pluginValidationUtils.js. This module only covers student credentials,
 * which are not owned by any single plugin.
 *
 * @module lib/widgetConfigValidator
 */

/**
 * Validate student credentials and basic configuration
 *
 * @param {Object} student - Student configuration
 * @returns {string[]} Array of warning messages
 */
function validateStudentCredentials(student) {
  const warnings = [];

  if (!student || typeof student !== 'object') {
    return ['Invalid student configuration: must be an object'];
  }

  // Check for missing credentials
  const hasQr = Boolean(student.qrcode);
  const hasDirectCreds = Boolean(student.username && student.password && student.school && student.server);
  const hasPartialDirectCreds = Boolean(student.username || student.password || student.school || student.server);
  const hasStudentId = Number.isFinite(Number(student.studentId));

  if (!hasQr && !hasDirectCreds && !hasStudentId) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": No credentials configured. Provide either qrcode OR (username + password + school + server) OR studentId (for parent account).`
    );
  }

  if (!hasQr && hasPartialDirectCreds && !hasDirectCreds) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": Incomplete direct credentials. Need username, password, school, and server together.`
    );
  }

  // Check for invalid QR code format
  if (hasQr && typeof student.qrcode === 'string' && !student.qrcode.startsWith('untis://')) {
    warnings.push(
      `Student "${student.title || 'Unknown'}": QR code malformed. Expected format: untis://setschool?url=...&school=...&user=...&key=...`
    );
  }

  // Check for missing title
  if (!student.title || typeof student.title !== 'string') {
    warnings.push('Student missing required "title" field');
  }

  return warnings;
}

module.exports = {
  validateStudentCredentials,
};
