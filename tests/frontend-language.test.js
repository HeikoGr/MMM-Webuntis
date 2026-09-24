const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "MMM-Webuntis.js"), "utf8");

// Load the frontend the way the browser does: MagicMirror declares its config with a
// top-level `let`, which every script sees but globalThis does not carry.
function loadFrontend(configScript) {
  let definition = null;
  const context = vm.createContext({
    Module: {
      register(_name, moduleDefinition) {
        definition = moduleDefinition;
      },
    },
    navigator: { language: "en-US" },
  });
  vm.runInContext(configScript, context);
  vm.runInContext(source, context);
  return definition;
}

test("plugin translations follow MagicMirror's language, not the browser's", () => {
  const definition = loadFrontend('let config = { language: "de" };');

  assert.deepEqual([...definition._getPluginTranslationLoadOrder.call({ config: {} })], ["en", "de"]);
});

test("without a MagicMirror config the browser language is used", () => {
  const definition = loadFrontend("");

  assert.deepEqual([...definition._getPluginTranslationLoadOrder.call({ config: {} })], ["en", "en-US"]);
});
