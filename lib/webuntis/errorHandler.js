/**
 * Error Handler Service for MMM-Webuntis
 *
 * Centralizes error handling and user-friendly error message conversion.
 * Provides utilities to convert technical errors into actionable warnings
 * for users and logs.
 *
 * @module lib/webuntis/errorHandler
 */

/**
 * Format error object to readable string
 *
 * @param {Error|string|null} err - Error object or message
 * @returns {string} Formatted error message
 *
 * @example
 * formatError(new Error("Connection failed")) // "Connection failed"
 * formatError("Simple error") // "Simple error"
 * formatError(null) // "(no error)"
 */
function formatError(err) {
  if (!err) return '(no error)';
  if (typeof err === 'string') return err;

  const base = String(err?.message || err);
  const details = [];

  const code = err?.code;
  if (code) details.push(`code=${code}`);

  const status = err?.response?.status ?? err?.status ?? err?.httpStatus;
  if (status !== undefined && status !== null && Number.isFinite(Number(status))) {
    details.push(`status=${Number(status)}`);
  }

  const cause = err?.cause;
  if (cause) {
    const causeMessage = String(cause?.message || cause);
    const causeCode = cause?.code ? `, causeCode=${cause.code}` : '';
    details.push(`cause=${causeMessage}${causeCode}`);
  }

  if (details.length === 0) return base;
  return `${base} (${details.join(', ')})`;
}

/**
 * Convert REST API errors to user-friendly warning messages
 * Provides actionable guidance based on error type
 *
 * @param {Error} error - Error object from REST API call
 * @param {Object} context - Context information for personalized messages
 * @param {string} [context.studentTitle='Student'] - Student name for messages
 * @param {string} [context.school='school'] - School name
 * @param {string} [context.server='server'] - Server hostname
 * @returns {string|null} User-friendly warning message or null if no conversion available
 *
 * @example
 * convertRestErrorToWarning(
 *   new Error("401 Unauthorized"),
 *   { studentTitle: "Max", school: "bachgymnasium" }
 * )
 * // Returns: 'Authentication failed for "Max": Invalid credentials or insufficient permissions.'
 */
function convertRestErrorToWarning(error, context = {}) {
  const { studentTitle = 'Student', server = 'server' } = context;

  if (!error) return null;

  const statusRaw = error?.response?.status ?? error?.status ?? error?.httpStatus ?? error?.cause?.status ?? error?.cause?.httpStatus;
  const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();

  // Access forbidden (403) - endpoint not available (school licensing)
  if (status === 403) {
    return `Endpoint not available for "${studentTitle}": your school may not have licensed this feature.`;
  }

  // Authentication errors (401)
  if (status === 401) {
    return `Authentication failed for "${studentTitle}": Invalid credentials or insufficient permissions.`;
  }

  // Network/Connection errors
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EHOSTUNREACH' || code === 'ENOTFOUND') {
    return `Cannot connect to WebUntis server "${server}". Check server name and network connection.`;
  }

  // Allowed fallback: sometimes lower-level fetch surfaces only network text.
  const msg = String(error?.message || error?.cause?.message || '').toLowerCase();
  if (
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach')
  ) {
    return `Cannot connect to WebUntis server "${server}". Check server name and network connection.`;
  }

  // Service unavailable (503)
  if (status === 503) {
    return `WebUntis API temporarily unavailable (HTTP 503). Retrying on next fetch...`;
  }

  // Generic network error (no HTTP response)
  if (!error.response && status === null) {
    return `Network error connecting to WebUntis: ${error.message || 'Unknown error'}`;
  }

  // Client errors (4xx)
  if (status && status >= 400 && status < 500) {
    return `HTTP ${status} error for "${studentTitle}": ${error.message || 'Client error'}`;
  }

  // Server errors (5xx)
  if (status && status >= 500) {
    return `Server error (HTTP ${status}): ${error.message || 'Server error'}`;
  }

  return null;
}

/**
 * Check if empty data array should trigger a warning
 * Useful for validating fetch results and providing feedback
 *
 * @param {Array} dataArray - Data array to check
 * @param {string} dataType - Type of data (e.g., "lessons", "exams", "homework")
 * @param {string} studentTitle - Student name for message
 * @param {boolean} [isExpectedData=true] - Whether data is expected (false suppresses warning)
 * @returns {string|null} Warning message or null if no issue
 *
 * @example
 * checkEmptyDataWarning([], "homework", "Max", true)
 * // Returns: 'Student "Max": No homework found in selected date range.'
 *
 * checkEmptyDataWarning([{...}], "homework", "Max", true)
 * // Returns: null (data exists)
 *
 * checkEmptyDataWarning([], "homework", "Max", false)
 * // Returns: null (not expected, no warning)
 */
function checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData = true) {
  if (Array.isArray(dataArray) && dataArray.length === 0 && isExpectedData) {
    return `Student "${studentTitle}": No ${dataType} found in selected date range.`;
  }
  return null;
}

module.exports = {
  formatError,
  convertRestErrorToWarning,
  checkEmptyDataWarning,
};
