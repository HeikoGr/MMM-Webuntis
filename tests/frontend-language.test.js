const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadFrontendShared, loadPlugin } = require("./helpers/fake-dom");

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

// Render a list plugin's header with the real shared helpers, a fake DOM and its real English translations.
function renderHeader(pluginId) {
  const context = loadFrontendShared();
  const plugin = loadPlugin(context, pluginId);
  const english = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "plugins", pluginId, "translations", "en.json"), "utf8"),
  );

  const section = plugin
    .create({ translate: (key, fallback) => english[key] ?? fallback })
    .render({ students: [{ student: { title: "Avery" }, context: { config: { mode: "verbose" } }, data: {} }] });
  return section.findAll("div").find((div) => div.className.includes("wu-row-header")).textContent;
}

test("a translation that equals its key is kept instead of replaced by the fallback", () => {
  assert.match(renderHeader("homework"), /^homework /);
  assert.match(renderHeader("absences"), /^absences /);
});

test("without a MagicMirror config the browser language is used", () => {
  const definition = loadFrontend("");

  assert.deepEqual([...definition._getPluginTranslationLoadOrder.call({ config: {} })], ["en", "en-US"]);
});

test("the host keeps a MagicMirror translation that equals its key and falls back only for missing keys", () => {
  const definition = loadFrontend(
    'const Translator = { translations: { "MMM-Webuntis": { homework: "homework" } }, coreTranslations: {} };',
  );
  const moduleInstance = {
    ...definition,
    name: "MMM-Webuntis",
    translate: (key) => ({ homework: "homework" })[key] ?? key,
  };

  assert.equal(moduleInstance._translatePluginKey("homework", "homework", "Homework"), "homework");
  assert.equal(moduleInstance._translatePluginKey("homework", "missing_key", "Fallback"), "Fallback");
});
