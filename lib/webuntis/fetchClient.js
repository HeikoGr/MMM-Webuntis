/**
 * Fetch wrapper with timeout support and error handling
 * Provides interface using native Node.js fetch
 *
 * Redirects are never followed: WebUntis answers a dead session cookie on its classic
 * `/WebUntis/api/*` endpoints with `302 -> /WebUntis/index.do`. Following that redirect turns an
 * auth failure into a `200 {"state":"LOGIN_ERROR"}` (or an HTML login page) that looks like an
 * empty result. Instead the redirect is surfaced as a tagged SESSION_EXPIRED error.
 */

const { tryOrDefault } = require("./errorUtils");

const ERROR_BODY_SNIPPET_LENGTH = 300;

/**
 * Whether a redirect target is WebUntis' login/entry page.
 * @param {string|null} location - Location header
 * @returns {boolean}
 */
function isLoginRedirect(location) {
  const target = String(location || "").toLowerCase();
  return target.includes("/index.do") || target.includes("/login") || target.includes("/saml");
}

/**
 * Build the error raised when our own AbortController fires.
 *
 * Carries `code` so the consumers classify it structurally: errorHandler.convertRestErrorToWarning,
 * warningUtils.isNetworkError and restClient's retry logic all check `code` first and only fall
 * back to matching the message text.
 *
 * @param {number} timeout - Timeout in milliseconds that elapsed
 * @param {Error} cause - The underlying AbortError
 * @returns {Error} Timeout error with code ETIMEDOUT
 */
function createTimeoutError(timeout, cause) {
  const error = new Error(`Request timeout after ${timeout}ms`, { cause });
  error.code = "ETIMEDOUT";
  return error;
}

/**
 * Fetch with timeout
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default: 30000)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      redirect: "manual",
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw createTimeoutError(timeout, error);
    }
    throw error;
  }
}

/**
 * Check if response is successful
 * fetch doesn't throw on HTTP errors
 *
 * Non-2xx responses become errors carrying `status`, a short `body` snippet (for diagnostics)
 * and, for login redirects, the auth tags consumed by the retry logic.
 *
 * @param {Response} response - Fetch response
 * @param {string} context - Context for error message
 */
async function ensureSuccessResponse(response, context = "Request") {
  if (response.ok) return;

  const location = response.headers?.get?.("location") || null;
  const isRedirect = response.status >= 300 && response.status < 400;

  if (isRedirect && isLoginRedirect(location)) {
    const error = new Error(`${context} redirected to WebUntis login page (HTTP ${response.status}): session expired`);
    error.response = response;
    error.status = response.status;
    error.httpStatus = response.status;
    error.code = "SESSION_EXPIRED";
    error.isAuthError = true;
    error.location = location;
    throw error;
  }

  const error = new Error(`${context} failed with status ${response.status}`);
  error.response = response;
  error.status = response.status;
  if (location) error.location = location;
  try {
    error.body = (await response.text()).slice(0, ERROR_BODY_SNIPPET_LENGTH);
  } catch {
    error.body = "";
  }
  throw error;
}

/**
 * Parse JSON response
 * @param {Response} response - Fetch response
 * @returns {Promise<any>}
 */
async function parseJSON(response) {
  const text = await response.text();
  if (!text) return null;

  // Check if response is already a plain string (not JSON)
  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.includes("application/json")) {
    return text;
  }

  // Attempt JSON parsing with fallback to plain text
  return tryOrDefault(
    () => JSON.parse(text),
    text, // fallback: return as plain text if JSON parsing fails
  );
}

/**
 * POST request with JSON body
 *
 * @param {string} url - URL to post to
 * @param {any} data - Data to send (will be JSON.stringify'd)
 * @param {Object} config - Request configuration
 * @param {Object} [config.headers={}] - HTTP headers
 * @param {number} [config.timeout=30000] - Request timeout in milliseconds
 * @returns {Promise<Object>} Response object with {data, status, statusText, headers}
 * @throws {Error} Throws on network errors or non-2xx responses
 */
async function post(url, data, config = {}) {
  const { headers = {}, timeout = 30000, ...restConfig } = config;

  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...headers,
      },
      body: JSON.stringify(data),
      ...restConfig,
    },
    timeout,
  );

  await ensureSuccessResponse(response, "POST");

  return {
    data: await parseJSON(response),
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

/**
 * GET request
 * @param {string} url - URL to get
 * @param {Object} config - Request configuration
 * @returns {Promise<Object>} Response with data property
 */
async function get(url, config = {}) {
  const { headers = {}, timeout = 30000, ...restConfig } = config;

  const response = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers,
      ...restConfig,
    },
    timeout,
  );

  await ensureSuccessResponse(response, "GET");

  return {
    data: await parseJSON(response),
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  };
}

/**
 * Generic request function
 * @param {Object} config - Request configuration
 * @returns {Promise<Object>} Response with data property
 */
async function request(config) {
  const { url, method = "GET", data, headers = {}, timeout = 30000, ...restConfig } = config;

  // Use a single AbortController for the ENTIRE operation (headers + body reading)
  // fetchWithTimeout only covers until headers arrive; body reading can hang indefinitely
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const options = {
    method: method.toUpperCase(),
    headers,
    redirect: "manual",
    signal: controller.signal,
    ...restConfig,
  };

  if (data && ["POST", "PUT", "PATCH"].includes(options.method)) {
    options.headers["Content-Type"] = options.headers["Content-Type"] || "application/json; charset=utf-8";
    options.body = JSON.stringify(data);
  }

  try {
    const response = await fetch(url, options);

    await ensureSuccessResponse(response, method.toUpperCase());

    const parsed = await parseJSON(response);
    clearTimeout(timeoutId);

    return {
      data: parsed,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === "AbortError") {
      throw createTimeoutError(timeout, error);
    }
    throw error;
  }
}

module.exports = {
  get,
  post,
  request,
  isLoginRedirect,
};
