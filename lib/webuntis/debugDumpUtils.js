/**
 * Shared helper for the debug-dump writers in webuntisApiService.js and authService.js.
 * Both write raw_api_*.json files into debug_dumps/ but have no cleanup of their own -
 * unlike the backend-payload dumps (see node_helper.js's _cleanupOldDebugDumps), which are
 * capped. Left unattended (dumpRawApiResponses stays on after debugging), this directory
 * grows without bound - one write per endpoint per fetch, forever.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Keep only the newest `keepCount` raw_api_*.json files in dumpDir, deleting the rest.
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

module.exports = { cleanupOldRawDumps };
