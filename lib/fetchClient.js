/**
 * Fetch wrapper with timeout support and error handling
 * Provides axios-like interface using native Node.js fetch
 */

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
            ...options,
            signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeout}ms`);
        }
        throw error;
    }
}

/**
 * Check if response is successful
 * Unlike axios, fetch doesn't throw on HTTP errors
 * @param {Response} response - Fetch response
 * @param {string} context - Context for error message
 */
function ensureSuccessResponse(response, context = 'Request') {
    if (!response.ok) {
        const error = new Error(`${context} failed with status ${response.status}`);
        error.response = response;
        error.status = response.status;
        throw error;
    }
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
    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('application/json')) {
        return text;
    }

    try {
        return JSON.parse(text);
    } catch (error) {
        // If JSON parsing fails, return as plain text
        return text;
    }
}

/**
 * Axios-compatible POST request
 * @param {string} url - URL to post to
 * @param {any} data - Data to send
 * @param {Object} config - Request configuration
 * @returns {Promise<Object>} Response with data property
 */
async function post(url, data, config = {}) {
    const { headers = {}, timeout = 30000, ...restConfig } = config;

    const response = await fetchWithTimeout(
        url,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(data),
            ...restConfig,
        },
        timeout
    );

    ensureSuccessResponse(response, 'POST');

    return {
        data: await parseJSON(response),
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    };
}

/**
 * Axios-compatible GET request
 * @param {string} url - URL to get
 * @param {Object} config - Request configuration
 * @returns {Promise<Object>} Response with data property
 */
async function get(url, config = {}) {
    const { headers = {}, timeout = 30000, ...restConfig } = config;

    const response = await fetchWithTimeout(
        url,
        {
            method: 'GET',
            headers,
            ...restConfig,
        },
        timeout
    );

    ensureSuccessResponse(response, 'GET');

    return {
        data: await parseJSON(response),
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    };
}

/**
 * Generic request function (axios-like)
 * @param {Object} config - Request configuration
 * @returns {Promise<Object>} Response with data property
 */
async function request(config) {
    const { url, method = 'GET', data, headers = {}, timeout = 30000, ...restConfig } = config;

    const options = {
        method: method.toUpperCase(),
        headers,
        ...restConfig,
    };

    if (data && ['POST', 'PUT', 'PATCH'].includes(options.method)) {
        options.headers['Content-Type'] = options.headers['Content-Type'] || 'application/json';
        options.body = JSON.stringify(data);
    }

    const response = await fetchWithTimeout(url, options, timeout);

    ensureSuccessResponse(response, method.toUpperCase());

    return {
        data: await parseJSON(response),
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    };
}

module.exports = {
    get,
    post,
    request,
    fetchWithTimeout,
    ensureSuccessResponse,
    parseJSON,
};
