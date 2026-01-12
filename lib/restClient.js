/**
 * REST API Client for WebUntis
 * Centralized handling of REST requests, authentication, error mapping, and response transformation
 */
const fetchClient = require('./fetchClient');

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

  if (status === 401) {
    return new Error(`Authentication failed (HTTP 401): Check credentials or token expired`);
  }
  if (status === 403) {
    return new Error(`Access forbidden (HTTP 403): Endpoint not available or insufficient permissions`);
  }
  if (status === 404) {
    return new Error(`Resource not found (HTTP 404): Check school name or studentId`);
  }
  if (status === 503) {
    return new Error(`WebUntis API unavailable (HTTP 503): Server temporarily down`);
  }
  if (status === 429) {
    return new Error(`Rate limit exceeded (HTTP 429): Too many requests, try again later`);
  }

  const bodySnippet = data ? JSON.stringify(data).substring(0, 200) : '';
  return new Error(`${operation} returned HTTP ${status}${bodySnippet ? ': ' + bodySnippet : ''}`);
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
  if (!(date instanceof Date)) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  timeout = 15000,
  logger = null,
  debugApi = false,
}) {
  const headers = buildHeaders({ token, cookies, tenantId, schoolYearId });
  const url = `https://${server}${path}`;
  const startTime = Date.now();

  try {
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

    if (debugApi && logger) {
      logger('info', `✓ Response Status: ${response.status} (${elapsed}ms)`);
      const truncated = truncateJson(response.data, 2);
      logger('info', `   Response Data: ${JSON.stringify(truncated, null, 2)}`);
    } else if (logger) {
      logger('debug', `REST API response status: ${response.status} (${elapsed}ms)`);
    }

    // Warn if response took longer than 10 seconds
    if (elapsed > 10000 && logger) {
      logger('warn', `⚠ Slow API response: ${path} took ${elapsed}ms (timeout: ${timeout}ms)`);
    }

    return response.data;
  } catch (error) {
    // Handle fetch-level errors
    if (error.code === 'ECONNREFUSED' || error.message?.includes('fetch failed')) {
      const msg = `Cannot connect to WebUntis server "${server}": check server name and network`;
      if (logger) logger('error', msg);
      throw new Error(msg);
    }
    if (error.message?.includes('timeout')) {
      const timeoutMatch = error.message.match(/(\d+)ms/);
      const timeoutValue = timeoutMatch ? timeoutMatch[1] : '15000';
      const msg = `Connection timeout to WebUntis server "${server}" after ${timeoutValue}ms: check network or try again`;
      if (logger) {
        logger('error', msg);
        logger('error', `  - URL: ${url}`);
        logger('error', `  - Method: ${method}`);
      }
      throw new Error(msg);
    }

    // Map HTTP error responses
    if (error.response) {
      throw mapRestError(error.response);
    }

    // Re-throw with context
    if (logger) logger('error', `REST API call failed: ${error.message}`);
    throw error;
  }
}

module.exports = {
  mapRestError,
  buildHeaders,
  formatDateForAPI,
  callRestAPI,
};
