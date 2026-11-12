/**
 * Redaction of credentials in text that leaves the backend: log lines and every warning or error
 * message sent to the frontend (issue #147: a QR-code login timeout showed the QR URL with its
 * `key=` OTP secret on the mirror).
 *
 * Two layers, because neither alone is enough:
 * - patterns for secret-shaped substrings (`key=…`, `password=…`, `"password":"…"`, bearer tokens,
 *   JWTs, session cookies), whatever produced them;
 * - the literal secrets of the running configs (passwords, QR-code OTP keys), registered by
 *   node_helper.prepareConfig(), for texts that carry a secret without a recognizable name around
 *   it (an error echoing a value, an URL-encoded QR code).
 */

const REDACTED = "***";

const SECRET_NAMES = [
  "key",
  "password",
  "passwd",
  "pwd",
  "pass",
  "secret",
  "otp",
  "token",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "jsessionid",
].join("|");

// `name=value` in URLs, query strings and cookies; not part of a longer name (`credKey=` stays).
const PARAM_PATTERN = new RegExp(`(?<![\\w-])(${SECRET_NAMES})=[^&\\s"'<>,;)]+`, "gi");
// `"name": "value"` in JSON snippets (error bodies, serialized objects).
const JSON_PATTERN = new RegExp(`("(?:${SECRET_NAMES})"\\s*:\\s*)"[^"]*"`, "gi");
const BEARER_PATTERN = /\bBearer\s+[\w.~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[\w-]+\.[\w-]+\.[\w-]*/g;

// Short values would also replace ordinary words and numbers in unrelated text.
const MIN_LITERAL_LENGTH = 6;
const knownSecrets = new Set();

/**
 * Remember literal secrets so redactSecrets() removes them wherever they appear.
 * @param {Iterable<string>} values - Passwords, OTP keys
 */
function registerSecrets(values) {
  for (const value of values || []) {
    if (typeof value === "string" && value.length >= MIN_LITERAL_LENGTH) knownSecrets.add(value);
  }
}

/**
 * The secrets of one module config: module-level and per-student passwords and QR codes (the
 * QR-code URL itself and its `key` parameter).
 * @param {Object} config - Normalized module config
 * @returns {string[]} Secret values
 */
function collectConfigSecrets(config) {
  const entries = [config, ...(Array.isArray(config?.students) ? config.students : [])];
  const secrets = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.password === "string") secrets.push(entry.password);
    if (typeof entry.qrcode === "string" && entry.qrcode) {
      secrets.push(entry.qrcode);
      try {
        const key = new URL(entry.qrcode).searchParams.get("key");
        if (key) secrets.push(key, encodeURIComponent(key));
      } catch {
        // malformed QR codes are reported by the config validation
      }
    }
  }
  return secrets;
}

/**
 * Replace credentials in a text.
 * @param {*} text - Text to clean (non-strings are converted)
 * @returns {string} Text without secrets
 */
function redactSecrets(text) {
  let result = String(text ?? "");
  for (const secret of knownSecrets) {
    if (result.includes(secret)) result = result.split(secret).join(REDACTED);
  }
  return result
    .replace(PARAM_PATTERN, `$1=${REDACTED}`)
    .replace(JSON_PATTERN, `$1"${REDACTED}"`)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(JWT_PATTERN, REDACTED);
}

/**
 * Field names whose value is a credential, in structured data that is written to disk or logged.
 * The one definition: the payload dumps (mmmPayloadMapper), the raw API dumps
 * (webuntis/debugDumpUtils), the normalized-config log (moduleConfig) and the request-header log
 * (webuntis/restClient) all use redactSecretFields(). Matched at the end of the name, so
 * `accessToken`, `cookieString` or `sessionId` are covered too; `key` only as the whole name.
 */
const SECRET_FIELD_PATTERN =
  /^key$|password$|passwd$|pwd$|pass$|secret$|otp$|token$|api_?key$|auth$|authorization$|bearer$|jsessionid$|sessionid$|cookies?$|cookiestring$|qrcode$/i;

const REDACTED_FIELD = "<REDACTED>";

/**
 * Replace the value of every credential-named field in place, at any depth.
 * @param {*} value - Object or array to clean (other values are left alone)
 */
function redactSecretFields(value) {
  if (!value || typeof value !== "object") return;
  for (const key of Object.keys(value)) {
    try {
      if (SECRET_FIELD_PATTERN.test(key)) {
        value[key] = REDACTED_FIELD;
      } else {
        redactSecretFields(value[key]);
      }
    } catch {
      // ignore individual redact errors (getters, frozen objects)
    }
  }
}

module.exports = {
  REDACTED,
  REDACTED_FIELD,
  SECRET_FIELD_PATTERN,
  collectConfigSecrets,
  redactSecretFields,
  redactSecrets,
  registerSecrets,
};
