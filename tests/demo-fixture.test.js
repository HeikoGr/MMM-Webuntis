const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { initializeBackendPluginHost } = require("../lib/pluginHostBackend");
const { buildCanonicalPluginsConfig } = require("../lib/moduleConfig");
const { parseDisplayModeTokens } = require("../lib/runtime-utils");

const moduleRoot = path.join(__dirname, "..");
const fixture = require("../demo/fixtures/single-student-week.json");

// Demo mode skips the backend, so the fixture has to carry the plugin config the
// backend would build: the plugins read context.config.plugins.<id>.config, not
// the legacy namespaces (grid: {...}) that only the backend normalizes.
test("the demo fixture carries the plugin config the backend would build from its options", () => {
  const pluginHost = initializeBackendPluginHost({ moduleRoot, logger: () => {} });
  const { plugins, ...legacyConfig } = fixture.context.config;

  assert.deepEqual(plugins, buildCanonicalPluginsConfig(legacyConfig, pluginHost));
});

test("the demo fixture enables every widget its displayMode names and has data for each", () => {
  const { config } = fixture.context;
  for (const token of parseDisplayModeTokens(config.displayMode)) {
    assert.equal(config.plugins[token]?.enabled, true, `plugin "${token}" must be enabled`);
  }
  for (const collection of ["lessons", "exams", "homework", "absences", "messages"]) {
    assert.ok(fixture.data[collection].length > 0, `fixture needs ${collection}`);
  }
});
