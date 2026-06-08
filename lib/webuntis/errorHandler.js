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

function formatDataTypeLabel(dataType) {
  const normalized = String(dataType || '')
    .trim()
    .toLowerCase();

  if (!normalized) return '';
  if (normalized === 'messagesofday') return 'messages of day';
  return normalized;
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
  const { studentTitle = 'Student', server = 'server', dataType = '' } = context;

  if (!error) return null;

  const dataTypeLabel = formatDataTypeLabel(dataType);
  const dataTypeContext = dataTypeLabel ? ` while fetching ${dataTypeLabel}` : '';

  const statusRaw = error?.response?.status ?? error?.status ?? error?.httpStatus ?? error?.cause?.status ?? error?.cause?.httpStatus;
  const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();

  // Access forbidden (403) - endpoint not available (school licensing)
  if (status === 403) {
    return `Endpoint not available${dataTypeContext} for "${studentTitle}": your school may not have licensed this feature.`;
  }

  // Authentication errors (401)
  if (status === 401) {
    return `Authentication failed${dataTypeContext} for "${studentTitle}": Invalid credentials or insufficient permissions.`;
  }

  // Connection timeout — network issue or slow server
  if (code === 'ETIMEDOUT' || code === 'ERR_HTTP_REQUEST_TIMEOUT') {
    return `WebUntis connection timeout${dataTypeContext} for "${studentTitle}". Server is slow or overloaded. Will retry automatically.`;
  }

  // Connection reset by peer — temporary network issue
  if (code === 'ECONNRESET') {
    return `WebUntis connection reset${dataTypeContext} for "${studentTitle}". Will retry automatically.`;
  }

  // Connection refused
  if (code === 'ECONNREFUSED') {
    return `Cannot connect to WebUntis server "${server}": Connection refused. Check server name and network.`;
  }

  // Host unreachable or DNS failures
  if (code === 'EHOSTUNREACH' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return `Cannot reach WebUntis server "${server}". Check server name and DNS resolution.`;
  }

  // Allowed fallback: sometimes lower-level fetch surfaces only network text.
  const msg = String(error?.message || error?.cause?.message || '').toLowerCase();
  if (msg.includes('timeout')) {
    return `WebUntis connection timeout${dataTypeContext} for "${studentTitle}". Will retry automatically on next fetch.`;
  }
  if (
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('ehostunreach')
  ) {
    return `Network error connecting to WebUntis server "${server}"${dataTypeContext}. Will retry automatically on next fetch.`;
  }

  // Service unavailable (5xx errors) — temporary server issues
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return `WebUntis server error (HTTP ${status})${dataTypeContext} for "${studentTitle}". This is temporary. Retrying automatically...`;
  }

  // Generic network error (no HTTP response)
  if (!error.response && status === null) {
    return `Network error connecting to WebUntis: ${error.message || 'Unknown error'}. Will retry on next fetch.`;
  }

  // Client errors (4xx)
  if (status && status >= 400 && status < 500) {
    return `HTTP ${status} error${dataTypeContext} for "${studentTitle}": ${error.message || 'Client error'}`;
  }

  // Server errors (5xx)
  if (status && status >= 500) {
    return `Server error (HTTP ${status})${dataTypeContext}: ${error.message || 'Server error'}`;
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
