/**
 * REST API Client for WebUntis
 * Centralized handling of REST requests, authentication, error mapping, and response transformation
 */
const fetchClient = require('./fetchClient');
const { formatDateFromDate } = require('./dateUtils');

// API timeout constant
// Increased from 15s to 25s to handle sporadically failing servers
const API_TIMEOUT_MS = 25000;

// Retry configuration for handling transient failures
const API_RETRY_MAX_ATTEMPTS = 4; // Allow one extra attempt for unstable servers
const API_RETRY_BASE_MS = 1000; // Base delay: 1 second
const API_RETRY_MAX_MS = 32000; // Cap at 32 seconds
const API_RETRY_JITTER_RATIO = 0.25; // ±25% randomization to avoid thundering herd

const STATUS_TEXTS = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function getStatusText(status) {
  return STATUS_TEXTS[status] || '';
}

/**
 * Truncate JSON arrays to show only first N items for debugging
 */
function truncateJson(obj, maxItems = 3) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    if (obj.length <= maxItems) return obj;
    return [...obj.slice(0, maxItems), `... ${obj.length - maxItems} more items`];
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = truncateJson(value, maxItems);
  }
  return result;
}

/**
 * Build standard headers for REST requests
 */
function buildHeaders({ token, cookies, tenantId, schoolYearId }) {
  const headers = {
    Cookie: cookies || '',
    Accept: 'application/json',
  };

  if (tenantId) headers['Tenant-Id'] = String(tenantId);
  if (schoolYearId) headers['X-Webuntis-Api-School-Year-Id'] = String(schoolYearId);
  if (token) headers.Authorization = `Bearer ${token}`;

  return headers;
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDateForAPI(date) {
  return formatDateFromDate(date, 'YYYY-MM-DD');
}

/**
 * Determine if a request should be retried
 * Retries are safe for:
 * - Rate limits (429)
 * - Server errors (5xx) - except 501 Not Implemented (permanent)
 * - Network timeouts and connection resets
 * - Temporary DNS failures
 *
 * Does NOT retry:
 * - Client errors (400, 401, 403, 404) - these are permanent
 * - 501 Not Implemented
 *
 * @param {Error} error - The error that occurred
 * @returns {boolean} True if request should be retried
 */
function isRetryableRestError(error) {
  const { status, code, name, msg } = extractErrorProperties(error);

  // Rate limiting and service unavailable errors are always retryable
  if (status === 429 || status === 503 || status === 502 || status === 500) return true;

  // 504 Gateway Timeout is retryable (server is overloaded)
  if (status === 504) return true;

  // 5xx errors (except 501 Not Implemented) are retryable
  if (status >= 500 && status !== 501) return true;

  const networkCodes = new Set([
    'ECONNREFUSED', // Connection refused - server may be restarting
    'ETIMEDOUT', // Connection timeout - network issue or slow server
    'ECONNRESET', // Connection reset by peer - network issue
    'EHOSTUNREACH', // Host unreachable - temporary network issue
    'ENOTFOUND', // DNS lookup failed - temporary DNS issue
    'EAI_AGAIN', // Temporary failure in name resolution
    'ERR_NETWORK', // Generic network error
    'ERR_SOCKET_CONNECTION_TIMEOUT', // Socket timeout
    'ERR_CONNECTION_REFUSED', // Connection refused
    'ERR_HTTP_REQUEST_TIMEOUT', // HTTP request timeout
    'ABORT_ERR', // Request aborted (timeout)
  ]);

  if (networkCodes.has(code) || name === 'ABORTERROR') return true;

  // Fallback: check message text for network-related keywords
  if (
    status === null &&
    (msg.includes('fetch failed') ||
      msg.includes('network error') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('ehostunreach') ||
      (msg.includes('connection') && msg.includes('refused')))
  ) {
    return true;
  }

  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract error properties from an error object with fallback chains
 * Handles nested cause properties and multiple property name variations
 *
 * @param {Error} error - Error object to extract properties from
 * @returns {{status: number|null, code: string, name: string, msg: string}} Extracted error properties
 */
function extractErrorProperties(error) {
  const statusRaw = error?.status ?? error?.httpStatus ?? error?.response?.status ?? error?.cause?.status ?? error?.cause?.httpStatus;
  const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const name = String(error?.name || error?.cause?.name || '').toUpperCase();
  const msg = String(error?.message || error?.cause?.message || '').toLowerCase();

  return { status, code, name, msg };
}

/**
 * Calculate exponential backoff with jitter for retry delays
 * Helps avoid thundering herd problem and spreads load on recovering servers
 *
 * Formula:
 * - Base delay: 2^(attempt-1) * 1000ms
 * - With jitter: delay ± (delay * 25%)
 * - Capped at 32 seconds
 *
 * Progression (clamped at attempt 5): ~1s, ~2s, ~4s, ~8s, ~16s (with ±25% random variation)
 *
 * @param {number} attempt - Current retry attempt number (1-based, max 5 to prevent unbounded exponential)
 * @returns {number} Delay in milliseconds with jitter
 */
function getRetryBackoffMs(attempt) {
  // Clamp attempt to prevent unbounded exponential growth; max exponent is 5 (16s before jitter)
  const safeAttempt = Math.min(Math.max(1, attempt), 5);
  // Exponential: 2^(n-1) * 1000 = 1000ms, 2000ms, 4000ms, 8000ms, 16000ms (then capped at 32s)
  const exponentialMs = 2 ** (safeAttempt - 1) * API_RETRY_BASE_MS;
  const cappedMs = Math.min(exponentialMs, API_RETRY_MAX_MS);

  // Add jitter: ±25% randomization
  const jitterRange = cappedMs * API_RETRY_JITTER_RATIO;
  const jitter = (Math.random() * 2 - 1) * jitterRange; // Random value in [-jitterRange, +jitterRange]
  const finalMs = Math.max(0, cappedMs + jitter);

  return Math.round(finalMs);
}

/**
 * Make a REST API call with unified error handling
 */
async function callRestAPI({
  server,
  path,
  method = 'GET',
  params = {},
  token,
  cookies,
  tenantId,
  schoolYearId,
  timeout = API_TIMEOUT_MS,
  logger = null,
  debugApi = false,
}) {
  const headers = buildHeaders({ token, cookies, tenantId, schoolYearId });
  const url = `https://${server}${path}`;

  const performRequest = async () => {
    const startTime = Date.now();
    const urlWithParams = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        urlWithParams.searchParams.append(key, String(value));
      }
    });

    if (debugApi && logger) {
      const safeHeaders = { ...headers };
      if (safeHeaders.Cookie) safeHeaders.Cookie = '[REDACTED]';
      if (safeHeaders.Authorization) safeHeaders.Authorization = '[REDACTED]';
      logger('info', `\n📡 API Request: ${method} ${urlWithParams.toString()}`);
      logger('info', `   Headers: ${JSON.stringify(safeHeaders, null, 2)}`);
    }

    const response = await fetchClient.request({
      method,
      url: urlWithParams.toString(),
      headers,
      timeout,
    });

    const elapsed = Date.now() - startTime;

    // Extract endpoint name from path for cleaner logs
    const endpointName = path.split('/').pop() || path;

    const statusText = getStatusText(response.status);
    const statusWithText = statusText ? `${response.status} (${statusText})` : response.status;

    if (debugApi && logger) {
      logger('info', `✓ ${endpointName}: ${statusWithText} (${elapsed}ms)`);
      const truncated = truncateJson(response.data, 2);
      logger('info', `   Response Data: ${JSON.stringify(truncated, null, 2)}`);
    } else if (logger) {
      // disabled to reduce noise
      // logger('debug', `REST API response: ${endpointName} ${statusWithText} (${elapsed}ms)`);
    }

    // Warn if response took longer than 10 seconds
    if (elapsed > 10000 && logger) {
      logger('warn', `⚠ Slow API response: ${path} took ${elapsed}ms (timeout: ${timeout}ms)`);
    }

    return { data: response.data, status: response.status };
  };

  let lastError = null;
  for (let attempt = 1; attempt <= API_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      return await performRequest();
    } catch (error) {
      lastError = error;
      const shouldRetry = isRetryableRestError(error) && attempt < API_RETRY_MAX_ATTEMPTS;
      if (!shouldRetry) break;

      const backoffMs = getRetryBackoffMs(attempt);
      if (logger) {
        logger(
          'warn',
          `[REST] ${method} ${path} failed on attempt ${attempt}/${API_RETRY_MAX_ATTEMPTS} (${error?.message || String(error)}), retrying in ${backoffMs}ms`
        );
      }
      await sleep(backoffMs);
    }
  }

  const error = lastError;
  if (error) {
    const { status, code, name, msg } = extractErrorProperties(error);

    const networkCodes = new Set([
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ECONNRESET',
      'EHOSTUNREACH',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ERR_NETWORK',
      'ERR_SOCKET_CONNECTION_TIMEOUT',
      'ERR_CONNECTION_REFUSED',
      'ABORT_ERR',
    ]);

    const isNetworkFromCode = networkCodes.has(code) || name === 'ABORTERROR';
    // Allowed fallback: some lower-level fetch errors only provide textual details.
    const isNetworkFromText =
      status === null &&
      (msg.includes('fetch failed') ||
        msg.includes('network error') ||
        msg.includes('timeout') ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('ehostunreach'));

    if (isNetworkFromCode || isNetworkFromText) {
      const isTimeout = code === 'ETIMEDOUT' || name === 'ABORTERROR' || msg.includes('timeout');
      if (isTimeout) {
        const contextMsg = `Connection timeout to WebUntis server "${server}" after ${timeout}ms: check network or try again`;
        if (logger) {
          logger('error', contextMsg);
          logger('error', `  - URL: ${url}`);
          logger('error', `  - Method: ${method}`);
        }
      } else {
        const contextMsg = `Cannot connect to WebUntis server "${server}": check server name and network`;
        if (logger) logger('error', contextMsg);
      }
    } else if (logger) {
      logger('error', `REST API call failed: ${error?.message || String(error)}`);
    }

    throw error;
  }

  throw new Error('REST request failed without an error object');
}

module.exports = {
  formatDateForAPI,
  callRestAPI,
};
