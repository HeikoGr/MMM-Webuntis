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
      const [nameValue] = cookieStr.split(";");
      // Split at the first "=" only: values may contain "=" themselves, e.g.
      // base64 padding in WebUntis' schoolname cookie ("_bXlzY2hvb2w=").
      const eq = nameValue.indexOf("=");
      if (eq <= 0) continue;
      const name = nameValue.slice(0, eq).trim();
      let value = nameValue.slice(eq + 1).trim();
      // Remove surrounding quotes from cookie value if present (WebUntis sometimes sends quoted values)
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      if (name && value) {
        this.cookies.set(`${domain}:${name}`, value);
      }
    }
  }

  /**
   * Get Cookie header string for a domain
   * @param {string} domain - Domain to get cookies for
   * @returns {string} Cookie header value
   */
  getCookieString(domain) {
    const cookieList = [];

    for (const [key, value] of this.cookies.entries()) {
      if (key.startsWith(`${domain}:`)) {
        const name = key.substring(domain.length + 1);
        cookieList.push(`${name}=${value}`);
      }
    }

    return cookieList.join("; ");
  }
}

module.exports = CookieJar;
