/**
 * Error Handler Service for MMM-Webuntis
 *
 * Centralizes error handling and user-friendly error message conversion.
 * Provides utilities to convert technical errors into actionable warnings
 * for users and logs.
 *
 * @module lib/errorHandler
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
    return String(err?.message || err);
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
    const { studentTitle = 'Student', school = 'school', server = 'server' } = context;

    if (!error) return null;

    const msg = (error.message || '').toLowerCase();
    const status = error.response?.status;

    // Authentication errors (401, 403)
    if (status === 401 || status === 403 || msg.includes('401') || msg.includes('403')) {
        return `Authentication failed for "${studentTitle}": Invalid credentials or insufficient permissions.`;
    }

    // Network/Connection errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT' || msg.includes('timeout')) {
        return `Cannot connect to WebUntis server "${server}". Check server name and network connection.`;
    }

    // Service unavailable (503)
    if (status === 503 || msg.includes('503')) {
        return `WebUntis API temporarily unavailable (HTTP 503). Retrying on next fetch...`;
    }

    // School not found
    if (msg.includes('school') || msg.includes('not found')) {
        return `School "${school}" not found or invalid credentials. Check school name and spelling.`;
    }

    // Generic network error (no HTTP response)
    if (!error.response) {
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
 * // Returns: 'Student "Max": No homework found in selected date range. Check if student is enrolled.'
 *
 * checkEmptyDataWarning([{...}], "homework", "Max", true)
 * // Returns: null (data exists)
 *
 * checkEmptyDataWarning([], "homework", "Max", false)
 * // Returns: null (not expected, no warning)
 */
function checkEmptyDataWarning(dataArray, dataType, studentTitle, isExpectedData = true) {
    if (Array.isArray(dataArray) && dataArray.length === 0 && isExpectedData) {
        return `Student "${studentTitle}": No ${dataType} found in selected date range. Check if student is enrolled.`;
    }
    return null;
}

/**
 * Classify error severity based on error characteristics
 *
 * @param {Error} error - Error object
 * @returns {'critical'|'warning'|'info'} Severity level
 *
 * @example
 * classifyErrorSeverity(new Error("401 Unauthorized")) // "warning"
 * classifyErrorSeverity(new Error("ECONNREFUSED")) // "critical"
 */
function classifyErrorSeverity(error) {
    if (!error) return 'info';

    const msg = (error.message || '').toLowerCase();
    const status = error.response?.status;

    // Critical: Network failures, service unavailable
    if (
        error.code === 'ECONNREFUSED' ||
        error.code === 'ETIMEDOUT' ||
        status === 503 ||
        msg.includes('timeout') ||
        msg.includes('econnrefused')
    ) {
        return 'critical';
    }

    // Warning: Authentication, client errors
    if (status === 401 || status === 403 || (status && status >= 400 && status < 500)) {
        return 'warning';
    }

    // Info: Everything else
    return 'info';
}

/**
 * Extract retry-after value from error response headers
 *
 * @param {Error} error - Error with response headers
 * @returns {number|null} Retry-after seconds or null if not specified
 */
function getRetryAfter(error) {
    const retryAfter = error.response?.headers?.['retry-after'];
    if (!retryAfter) return null;

    const seconds = parseInt(retryAfter, 10);
    return isNaN(seconds) ? null : seconds;
}

/**
 * Check if error is retryable (temporary network/server issues)
 *
 * @param {Error} error - Error object
 * @returns {boolean} True if error is likely temporary and retryable
 */
function isRetryableError(error) {
    if (!error) return false;

    const status = error.response?.status;
    const code = error.code;

    // Retryable: Timeout, connection refused, 503, 429 (rate limit)
    return code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || status === 503 || status === 429 || status === 502 || status === 504;
}

/**
 * Create error context object from multiple sources
 *
 * @param {Object} student - Student config object
 * @param {Object} moduleConfig - Module config object
 * @returns {Object} Context for error messages
 */
function createErrorContext(student, moduleConfig = {}) {
    return {
        studentTitle: student?.title || 'Unknown Student',
        school: student?.school || moduleConfig?.school || 'unknown school',
        server: student?.server || moduleConfig?.server || 'webuntis.com',
    };
}

module.exports = {
    formatError,
    convertRestErrorToWarning,
    checkEmptyDataWarning,
    classifyErrorSeverity,
    getRetryAfter,
    isRetryableError,
    createErrorContext,
};
