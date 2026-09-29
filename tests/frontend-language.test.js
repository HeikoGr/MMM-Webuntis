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

test("instances in one window share the plugin translation requests and load the languages side by side", async () => {
  const requested = [];
  let inFlight = 0;
  let peakInFlight = 0;
  const answers = {
    "en.json": { greeting: "Hello", only_en: "en" },
    "de.json": { greeting: "Hallo" },
  };
  let definition = null;
  const context = vm.createContext({
    Module: {
      register(_name, moduleDefinition) {
        definition = moduleDefinition;
      },
    },
    navigator: { language: "de-DE" },
    fetch: async (url, options) => {
      requested.push({ url, options });
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight -= 1;
      const body = answers[/([a-z-]+\.json)/i.exec(url)?.[1]];
      return body ? { ok: true, status: 200, json: async () => body } : { ok: false, status: 404 };
    },
  });
  vm.runInContext('let config = { language: "de" };', context);
  vm.runInContext(source, context);

  const makeInstance = () => ({
    ...definition,
    file: (relativePath) => `/modules/MMM-Webuntis/${relativePath}`,
    _log() {},
    config: {},
    _pluginTranslationsById: new Map(),
  });
  const entry = { id: "demo", entry: { frontend: "plugins/demo/frontend.js" } };
  const first = makeInstance();
  const second = makeInstance();

  await Promise.all([first._loadPluginTranslations(entry), second._loadPluginTranslations(entry)]);

  assert.equal(requested.length, 2, "one request per language, not per instance");
  assert.equal(peakInFlight, 2, "the two languages are fetched side by side, not one after the other");
  assert.equal(requested[0].options, undefined, "the HTTP cache stays enabled");
  assert.match(requested[0].url, /\?v=/, "the module version keeps stale texts out");
  for (const instance of [first, second]) {
    assert.deepEqual({ ...instance._pluginTranslationsById.get("demo") }, { greeting: "Hallo", only_en: "en" });
    assert.equal(instance._getPluginTranslationEntry("demo", "greeting"), "Hallo");
  }
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
