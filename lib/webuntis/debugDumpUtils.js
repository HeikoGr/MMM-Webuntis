/**
 * Where and how debug dumps are written - for every writer: the raw API dumps
 * (webuntisApiService.js, authService.js), the backend-payload dumps
 * (lib/mmm-adapter/mmmPayloadMapper.js) and scripts/test_api_endpoint.js.
 *
 * Dumps hold children's names, timetables, absences and messages. MagicMirror serves the
 * whole modules/ folder over HTTP but skips paths that start with a dot, so they go to
 * `.debug_dumps/`, owner-only (folder 0700, files 0600).
 */

const fs = require("node:fs");
const path = require("node:path");
const { redactSecretFields } = require("../secretRedaction");

const MODULE_ROOT = path.resolve(__dirname, "..", "..");
const DEBUG_DUMP_DIR = path.join(MODULE_ROOT, ".debug_dumps");
// Up to 0.15.9 the dumps lay here, where MagicMirror served them.
const LEGACY_DEBUG_DUMP_DIR = path.join(MODULE_ROOT, "debug_dumps");

/**
 * Create the dump folder (owner-only) if needed.
 * @param {string} [dir] - Folder, DEBUG_DUMP_DIR by default
 * @returns {string} The folder
 */
function ensureDumpDir(dir = DEBUG_DUMP_DIR) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode only applies to a new folder.
  fs.chmodSync(dir, 0o700);
  return dir;
}

/**
 * Write one dump file, readable by the owner only. Throws like writeFileSync.
 * @param {string} fileName - File name inside the dump folder
 * @param {*} data - Serialized as pretty JSON
 * @param {string} [dir] - Folder, DEBUG_DUMP_DIR by default
 * @returns {string} Path of the written file
 */
function writeDumpFile(fileName, data, dir = DEBUG_DUMP_DIR) {
  ensureDumpDir(dir);
  const filePath = path.join(dir, path.basename(fileName));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 });
  return filePath;
}

/**
 * Move the dumps of an older version out of the served `debug_dumps/` folder. Never throws.
 * @param {{from?: string, to?: string}} [paths] - For tests
 * @returns {boolean} Whether a folder was moved or removed
 */
function migrateLegacyDumpDir({ from = LEGACY_DEBUG_DUMP_DIR, to = DEBUG_DUMP_DIR } = {}) {
  try {
    if (!fs.existsSync(from)) return false;
    if (fs.existsSync(to)) {
      // Both exist: the old files are older than anything in the new folder.
      fs.rmSync(from, { recursive: true, force: true });
    } else {
      fs.renameSync(from, to);
      fs.chmodSync(to, 0o700);
      for (const name of fs.readdirSync(to)) fs.chmodSync(path.join(to, name), 0o600);
    }
    return true;
  } catch {
    return false;
  }
}

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
  cleanupOldDumps(dumpDir, keepCount, (f) => f.startsWith("raw_api_") && f.endsWith(".json"));
}

/**
 * Keep only the newest `keepCount` files matching `matches` in dumpDir, deleting the rest.
 * Errors (missing directory, unlinkable file) are ignored.
 *
 * @param {string} dumpDir - Directory containing the dumps
 * @param {number} keepCount - Number of newest files to retain
 * @param {Function} matches - (fileName) => boolean
 */
function cleanupOldDumps(dumpDir, keepCount, matches) {
  try {
    const files = fs
      .readdirSync(dumpDir)
      .filter(matches)
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

/**
 * Recursively redact credential-named fields (password, token, qrcode, cookieString, ...) in
 * place: dumps are meant for API-shape debugging, not for carrying live credentials into a
 * support thread. The field names are defined once, in lib/secretRedaction.js.
 *
 * @param {*} value - Value to redact in place (mutated if it is an object/array)
 */
const redactDumpFields = redactSecretFields;

module.exports = {
  DEBUG_DUMP_DIR,
  LEGACY_DEBUG_DUMP_DIR,
  cleanupOldDumps,
  cleanupOldRawDumps,
  ensureDumpDir,
  migrateLegacyDumpDir,
  redactDumpFields,
  writeDumpFile,
};
