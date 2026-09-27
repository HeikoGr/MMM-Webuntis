/**
 * Time-based one-time passwords (RFC 6238) for the WebUntis QR login.
 *
 * WebUntis uses the common authenticator profile: HMAC-SHA1, 6 digits, 30-second steps, secret
 * encoded as Base32 (RFC 4648). node:crypto covers all of it, so no OTP library is needed.
 */

const { createHmac } = require("node:crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode a Base32 secret. Case, whitespace and "=" padding are ignored, as authenticator apps do.
 *
 * @param {string} secret - Base32-encoded secret
 * @returns {Buffer} Decoded key bytes
 */
function decodeBase32(secret) {
  const clean = String(secret).toUpperCase().replace(/[\s=]/g, "");
  const bytes = [];
  let buffer = 0;
  let bits = 0;

  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid Base32 character "${char}" in OTP secret`);
    }
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

/**
 * Generate the TOTP for a point in time.
 *
 * @param {string} secret - Base32-encoded secret (the `key` parameter of the WebUntis QR code)
 * @param {Object} [options]
 * @param {number} [options.timestamp=Date.now()] - Epoch ms
 * @param {number} [options.period=30] - Step length in seconds
 * @param {number} [options.digits=6] - Length of the code
 * @returns {string} Zero-padded code
 */
function generateTotp(secret, { timestamp = Date.now(), period = 30, digits = 6 } = {}) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestamp / 1000 / period)));

  const hmac = createHmac("sha1", decodeBase32(secret)).update(counter).digest();

  // Dynamic truncation (RFC 4226, section 5.3)
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = hmac.readUInt32BE(offset) & 0x7fffffff;

  return String(code % 10 ** digits).padStart(digits, "0");
}

module.exports = { decodeBase32, generateTotp };
