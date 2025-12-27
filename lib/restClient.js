/**
 * REST API Client for WebUntis
 * Centralized handling of REST requests, authentication, error mapping, and response transformation
 */
const axios = require('axios');

/**
 * Map HTTP error responses to user-friendly messages
 */
function mapRestError(response, operation = 'REST API') {
  const status = response?.status;
  const data = response?.data;

  if (status === 401 || status === 403) {
    return new Error(`Authentication failed (HTTP ${status}): Check credentials`);
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
}) {
  const headers = buildHeaders({ token, cookies, tenantId, schoolYearId });
  const url = `https://${server}${path}`;

  try {
    const response = await axios({
      method,
      url,
      params,
      headers,
      validateStatus: () => true,
      timeout,
    });

    if (logger) logger('debug', `REST API response status: ${response.status}`);
    if (response.status === 200) {
      return response.data;
    }

    throw mapRestError(response);
  } catch (error) {
    // Handle network-level errors
    if (error.code === 'ECONNREFUSED') {
      const msg = `Cannot connect to WebUntis server "${server}": check server name and network`;
      if (logger) logger('error', msg);
      throw new Error(msg);
    }
    if (error.code === 'ETIMEDOUT' || error.message?.includes('timeout')) {
      const msg = `Connection timeout to WebUntis server "${server}": check network or try again`;
      if (logger) logger('error', msg);
      throw new Error(msg);
    }

    // Re-throw with context if not already mapped
    if (!error.message?.includes('HTTP')) {
      if (logger) logger('error', `REST API call failed: ${error.message}`);
    }
    throw error;
  }
}

module.exports = {
  mapRestError,
  buildHeaders,
  formatDateForAPI,
  callRestAPI,
};
