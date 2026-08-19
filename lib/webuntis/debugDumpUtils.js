/**
 * Shared helpers for the raw-dump writers in webuntisApiService.js and authService.js.
 * Both write raw_api_*.json files into debug_dumps/ - unlike the backend-payload dumps
 * (see lib/mmm-adapter/mmmPayloadMapper.js and node_helper.js's _cleanupOldDebugDumps),
 * which are both capped and redacted before hitting disk.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Keep only the newest `keepCount` raw_api_*.json files in dumpDir, deleting the rest.
 *
 * Left unattended (dumpRawApiResponses stays on after debugging), this directory grows
 * without bound - one write per endpoint per fetch, forever.
 *
 * @param {string} dumpDir - Directory containing the dumps
 * @param {number} [keepCount=50] - Number of newest files to retain
 */
function cleanupOldRawDumps(dumpDir, keepCount = 50) {
  try {
    const files = fs
      .readdirSync(dumpDir)
      .filter((f) => f.startsWith('raw_api_') && f.endsWith('.json'))
      .map((f) => ({
        path: path.join(dumpDir, f),
        mtime: fs.statSync(path.join(dumpDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length > keepCount) {
      files.slice(keepCount).forEach((f) => {
        try {
          fs.unlinkSync(f.path);
        } catch {
          // Ignore deletion errors
        }
      });
    }
  } catch {
    // Ignore cleanup errors (directory might not exist yet)
  }
}

// Same credential-shaped-key rule as mmmPayloadMapper.js's redactSensitiveFields(), kept
// local here rather than imported so lib/webuntis/ doesn't reach into lib/mmm-adapter/.
const REDACT_KEY_PATTERN =
  /password$|pass(word)?$|token$|auth$|authToken$|cookie$|jsessionid$|bearer$|accessToken$|refreshToken$|qrcode$|secret$|apikey$/i;

/**
 * Recursively redact credential-shaped fields (password, token, qrcode, ...) in place.
 * Raw API/appData dumps go out unmodified otherwise - these are meant for API-shape
 * debugging, not for carrying live credentials into a support thread.
 *
 * @param {*} value - Value to redact in place (mutated if it is an object/array)
 */
function redactDumpFields(value) {
  if (!value || typeof value !== 'object') return;
  for (const key of Object.keys(value)) {
    try {
      if (REDACT_KEY_PATTERN.test(key)) {
        value[key] = '<REDACTED>';
      } else {
        redactDumpFields(value[key]);
      }
    } catch {
      // ignore individual redact errors
    }
  }
}

module.exports = { cleanupOldRawDumps, redactDumpFields };
