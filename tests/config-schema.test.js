"use strict";

/*
 * MMM-Config builds its form from MMM-Config.schema.json. An option missing there cannot be set
 * through MMM-Config, and a preset value there overrides the module default.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const schemaFile = JSON.parse(fs.readFileSync(path.join(root, "MMM-Config.schema.json"), "utf8"));

function moduleDefaults() {
  let definition = null;
  const context = { Module: { register: (_name, def) => (definition = def) }, Log: console };
  vm.runInNewContext(fs.readFileSync(path.join(root, "MMM-Webuntis.js"), "utf8"), context);
  return definition.defaults;
}

// Legacy per-widget namespaces, still read from config.js but configured through `plugins`.
const LEGACY_NAMESPACES = new Set(["lessons", "grid", "exams", "homework", "absences", "messagesofday"]);

test("every module default has an entry in the MMM-Config schema", () => {
  const schemaKeys = Object.keys(schemaFile.schema["MMM-Webuntis"].properties.config.properties);
  const missing = Object.keys(moduleDefaults()).filter(
    (key) => !LEGACY_NAMESPACES.has(key) && !schemaKeys.includes(key),
  );
  assert.deepEqual(missing, [], `add these options to MMM-Config.schema.json: ${missing.join(", ")}`);
});

test("the schema has no options the module does not know", () => {
  const defaults = moduleDefaults();
  // Credentials and students are commented out in the defaults, but real options.
  const known = new Set([...Object.keys(defaults), "username", "password", "school", "server", "students"]);
  const unknown = Object.keys(schemaFile.schema["MMM-Webuntis"].properties.config.properties).filter(
    (key) => !known.has(key),
  );
  assert.deepEqual(unknown, []);
});

test("schema presets do not override module defaults that are unset on purpose", () => {
  const defaults = moduleDefaults();
  const preset = schemaFile.value.config;
  // logLevel unset means "MagicMirror's global level"; a preset "none" switched the logs off.
  assert.equal(defaults.logLevel, null);
  assert.equal("logLevel" in preset, false);
  assert.equal("header" in preset, false, "header belongs to the module entry, not to config");
  for (const [key, value] of Object.entries(preset)) {
    if (key in defaults && typeof value !== "object" && defaults[key] !== null) {
      assert.equal(value, defaults[key], `preset for ${key} differs from the module default`);
    }
  }
});
