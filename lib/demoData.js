/**
 * Demo mode (`demoDataFile`): serve fixture payloads instead of WebUntis data.
 *
 * Demo mode runs through the regular CONFIGURE / DATA path of the instance hub; only the WebUntis
 * fetch is replaced by reading the fixtures. Each fixture gets the normalized per-student config a
 * live payload carries in `context.config`, so the widgets follow the module config like live data.
 */
const fs = require("node:fs");
const path = require("node:path");
const { mergeModuleDefaultsIntoStudents, stripCredentials } = require("./studentDiscovery");

/**
 * @param {Object} config - Module config
 * @returns {boolean} True when `demoDataFile` names at least one fixture
 */
function isDemoMode(config) {
  return typeof config?.demoDataFile === "string" && config.demoDataFile.trim() !== "";
}

/**
 * Resolve the comma-separated fixture paths relative to the module folder. Only `.json` files in
 * `demo/` are accepted, checked on the real path (after symbolic links): the option names demo
 * data, and the config comes from the browser - it must not read back debug dumps, package.json
 * or files a link points to.
 *
 * @param {string} demoDataFile - One path or a comma-separated list
 * @param {string} moduleRoot - Absolute module folder
 * @returns {string[]} Absolute fixture paths
 */
function resolveFixturePaths(demoDataFile, moduleRoot) {
  const demoRoot = path.join(path.resolve(moduleRoot), "demo");
  const realDemoRoot = fs.existsSync(demoRoot) ? fs.realpathSync(demoRoot) : demoRoot;
  return String(demoDataFile)
    .split(",")
    .map((entry) => entry.trim().replace(/^\/+/, ""))
    .filter(Boolean)
    .map((relative) => {
      const rejected = new Error(`demoDataFile "${relative}" must point to a .json file inside the demo/ folder`);
      if (path.extname(relative).toLowerCase() !== ".json") throw rejected;
      const resolved = path.resolve(moduleRoot, relative);
      if (!resolved.startsWith(`${demoRoot}${path.sep}`)) throw rejected;
      // A missing file is reported by the reader; an existing one must really be in demo/.
      if (fs.existsSync(resolved) && !fs.realpathSync(resolved).startsWith(`${realDemoRoot}${path.sep}`)) {
        throw rejected;
      }
      return resolved;
    });
}

/**
 * Read the fixtures. A file holds one payload, an array of payloads or `{ payloads: [...] }`.
 * Files are read on every refresh, so edits to a fixture show up without a restart.
 *
 * @param {string} demoDataFile - One path or a comma-separated list
 * @param {string} moduleRoot - Absolute module folder
 * @returns {Object[]} Payloads, one per student
 */
function loadFixturePayloads(demoDataFile, moduleRoot) {
  const files = resolveFixturePaths(demoDataFile, moduleRoot);
  if (files.length === 0) throw new Error("demoDataFile must name at least one fixture");
  return files.flatMap((file) => {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const payloads = Array.isArray(json) ? json : Array.isArray(json?.payloads) ? json.payloads : [json];
    if (payloads.length === 0) throw new Error(`demo fixture ${path.basename(file)} contains no payloads`);
    return payloads;
  });
}

/**
 * Give configured students their module defaults. Demo mode skips the WebUntis student discovery
 * (it would log in), which otherwise does this merge.
 *
 * @param {Object} config - Normalized module config (modified in place)
 */
function prepareDemoStudents(config) {
  config.students = mergeModuleDefaultsIntoStudents(config, Array.isArray(config.students) ? config.students : []);
  config._moduleDefaultsMerged = true;
}

/**
 * Build the DATA_UPDATE payloads for demo mode: the fixtures in order, the n-th with the config of
 * the n-th configured student (or the first one). Without configured students every fixture gets a
 * student built from the module config and the fixture's student name.
 *
 * @param {Object} config - Normalized session config (students prepared by prepareDemoStudents)
 * @param {string} moduleRoot - Absolute module folder
 * @returns {Object[]} Payloads with `context.config` filled in
 */
function buildDemoPayloads(config, moduleRoot) {
  const fixtures = loadFixturePayloads(config.demoDataFile, moduleRoot);
  const students =
    Array.isArray(config.students) && config.students.length > 0
      ? config.students
      : mergeModuleDefaultsIntoStudents(
          config,
          fixtures.map((fixture) => ({ title: fixture?.context?.student?.title || "Demo" })),
        );

  return fixtures.map((fixture, index) => {
    const student = students[index] || students[0];
    return {
      ...fixture,
      context: {
        ...(fixture?.context || {}),
        // Like a live payload: no credentials, even if demo mode runs next to real ones.
        config: { ...stripCredentials(student), debugDate: student.debugDate ?? config.debugDate ?? null },
      },
    };
  });
}

module.exports = { isDemoMode, buildDemoPayloads, loadFixturePayloads, prepareDemoStudents, resolveFixturePaths };
