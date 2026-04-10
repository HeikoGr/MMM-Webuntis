/**
 * REST API Client for WebUntis
 * Centralized handling of REST requests, authentication, error mapping, and response transformation
 */
const fetchClient = require('./fetchClient');
const { formatDateFromDate } = require('./dateUtils');

// API timeout constant (15 seconds)
const API_TIMEOUT_MS = 15000;
const API_RETRY_MAX_ATTEMPTS = 3;
const API_RETRY_BACKOFF_SCHEDULE_MS = [5000, 15000];

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
 * Map HTTP error responses to user-friendly messages
 */
function mapRestError(response, operation = 'REST API') {
  const status = response?.status;
  const data = response?.data;
  const buildError = (message, extra = {}) => {
    const err = new Error(message);
    err.httpStatus = status;
    Object.assign(err, extra);
    return err;
  };

  if (status === 401) {
    return buildError(`Authentication failed (HTTP 401): Check credentials or token expired`, {
      code: 'AUTH_FAILED',
      isAuthError: true,
    });
  }
  if (status === 403) {
    return buildError(`Access forbidden (HTTP 403): Endpoint not available or insufficient permissions`, {
      code: 'ACCESS_FORBIDDEN',
    });
  }
  if (status === 404) {
    return buildError(`Resource not found (HTTP 404): Check school name or studentId`, {
      code: 'RESOURCE_NOT_FOUND',
    });
  }
  if (status === 503) {
    return buildError(`WebUntis API unavailable (HTTP 503): Server temporarily down`, {
      code: 'API_UNAVAILABLE',
    });
  }
  if (status === 429) {
    return buildError(`Rate limit exceeded (HTTP 429): Too many requests, try again later`, {
      code: 'RATE_LIMITED',
    });
  }

  const bodySnippet = data ? JSON.stringify(data).substring(0, 200) : '';
  return buildError(`${operation} returned HTTP ${status}${bodySnippet ? `: ${bodySnippet}` : ''}`);
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

function isRetryableRestError(error) {
  const statusRaw = error?.status ?? error?.httpStatus ?? error?.response?.status ?? error?.cause?.status ?? error?.cause?.httpStatus;
  const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
  const code = String(error?.code || error?.cause?.code || '').toUpperCase();
  const name = String(error?.name || error?.cause?.name || '').toUpperCase();
  const msg = String(error?.message || error?.cause?.message || '').toLowerCase();

  if (status === 429 || status >= 500) return true;

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

  if (networkCodes.has(code) || name === 'ABORTERROR') return true;

  return (
    status === null &&
    (msg.includes('fetch failed') ||
      msg.includes('network error') ||
      msg.includes('timeout') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('ehostunreach'))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryBackoffMs(attempt) {
  return API_RETRY_BACKOFF_SCHEDULE_MS[Math.max(0, attempt - 1)] || API_RETRY_BACKOFF_SCHEDULE_MS.at(-1) || 0;
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
    const statusRaw = error?.status ?? error?.httpStatus ?? error?.response?.status ?? error?.cause?.status ?? error?.cause?.httpStatus;
    const status = Number.isFinite(Number(statusRaw)) ? Number(statusRaw) : null;
    const code = String(error?.code || error?.cause?.code || '').toUpperCase();
    const name = String(error?.name || error?.cause?.name || '').toUpperCase();
    const msg = String(error?.message || error?.cause?.message || '').toLowerCase();

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
  mapRestError,
  buildHeaders,
  formatDateForAPI,
  callRestAPI,
};
