/**
 * The WebUntis server as it may appear in a URL: `https://${server}/WebUntis/...`.
 *
 * `server` comes from config.js or from the `url` parameter of a QR code. A value with a scheme,
 * a path or an `@` turns that template into a different address - and username and password go
 * there. Only a host name (with an optional port) is accepted; a leading `https://` and trailing
 * slashes, the common copy-paste from the browser, are removed.
 */

const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i;

/**
 * @param {*} value - Configured server
 * @returns {{host: string|null, cleaned: boolean, error: string|null}} The host, whether a scheme
 *   or slash was removed, or why the value is no host name
 */
function normalizeServerHost(value) {
  if (typeof value !== "string") return { host: null, cleaned: false, error: "must be a string" };
  const trimmed = value.trim();
  const host = trimmed.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!HOST_PATTERN.test(host)) {
    return {
      host: null,
      cleaned: false,
      error: `"${value}" is not a host name like "school.webuntis.com" (no path, user or query)`,
    };
  }
  return { host, cleaned: host !== trimmed, error: null };
}

module.exports = { normalizeServerHost };
