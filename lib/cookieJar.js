/**
 * Simple Cookie Jar for fetch API
 * Manages cookies for HTTP requests/responses
 */

class CookieJar {
    constructor() {
        this.cookies = new Map();
    }

    /**
     * Parse Set-Cookie headers and store cookies
     * @param {Headers} headers - Response headers
     * @param {string} domain - Domain for cookie storage
     */
    setCookies(headers, domain) {
        const setCookieHeaders = headers.getSetCookie?.() || [];

        for (const cookieStr of setCookieHeaders) {
            const [nameValue] = cookieStr.split(';');
            const [name, value] = nameValue.split('=');

            if (name && value) {
                const key = `${domain}:${name.trim()}`;
                this.cookies.set(key, value.trim());
            }
        }
    }

    /**
     * Get Cookie header string for a domain
     * @param {string} domain - Domain to get cookies for
     * @returns {string} Cookie header value
     */
    getCookieString(domain) {
        const cookies = [];

        for (const [key, value] of this.cookies.entries()) {
            if (key.startsWith(`${domain}:`)) {
                const name = key.substring(domain.length + 1);
                cookies.push(`${name}=${value}`);
            }
        }

        return cookies.join('; ');
    }

    /**
     * Clear all cookies for a domain
     * @param {string} domain - Domain to clear cookies for
     */
    clearCookies(domain) {
        for (const key of this.cookies.keys()) {
            if (key.startsWith(`${domain}:`)) {
                this.cookies.delete(key);
            }
        }
    }

    /**
     * Clear all cookies
     */
    clearAll() {
        this.cookies.clear();
    }
}

module.exports = CookieJar;
