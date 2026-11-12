const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const { validatePluginManifest } = require("../lib/pluginManifestValidator");
const { loadPluginRegistry } = require("../lib/pluginLoader");
const { buildFrontendPluginRegistry } = require("../lib/moduleConfig");

function manifest(entry) {
  return {
    id: "demo",
    version: "1.0.0",
    title: "Demo",
    type: "widget",
    entry,
    capabilities: ["lessons"],
    compatibility: { contractVersion: 3, hostApiVersion: 1 },
  };
}

test("entry.frontend takes one script or an ordered list, normalized to a list", () => {
  const single = validatePluginManifest(manifest({ frontend: "frontend.js" }), { pluginDirName: "demo" });
  assert.equal(single.valid, true, single.errors.join("; "));
  assert.deepEqual(single.manifest.entry.frontend, ["frontend.js"]);

  const several = validatePluginManifest(manifest({ frontend: ["layout.js", " frontend.js "] }), {
    pluginDirName: "demo",
  });
  assert.equal(several.valid, true, several.errors.join("; "));
  assert.deepEqual(several.manifest.entry.frontend, ["layout.js", "frontend.js"], "order kept, paths trimmed");
});

test("an empty, unsafe or repeated frontend entry is rejected", () => {
  for (const frontend of [undefined, "", [], ["ok.js", "../outside.js"], ["/abs.js"], ["a.js", 42], ["a.js", "a.js"]]) {
    const result = validatePluginManifest(manifest({ frontend }), { pluginDirName: "demo" });
    assert.equal(result.valid, false, JSON.stringify(frontend));
    assert.match(result.errors.join(" "), /entry\.frontend/);
  }
});

/** A plugins/ folder on disk with one plugin "demo" carrying these files and this frontend entry. */
function pluginFolder(t, files, frontend) {
  const moduleRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wu-plugins-"));
  t.after(() => fs.rmSync(moduleRoot, { recursive: true, force: true }));
  const pluginRoot = path.join(moduleRoot, "plugins", "demo");
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "manifest.json"), JSON.stringify(manifest({ frontend })));
  for (const file of files) fs.writeFileSync(path.join(pluginRoot, file), "");
  return moduleRoot;
}

test("the loader resolves every frontend script and the registry sends them in order", (t) => {
  const moduleRoot = pluginFolder(t, ["layout.js", "frontend.js"], ["layout.js", "frontend.js"]);
  const registry = loadPluginRegistry({ moduleRoot });
  assert.deepEqual(registry.warnings, []);
  assert.deepEqual(
    registry.plugins[0].entryPaths.frontend.map((file) => path.basename(file)),
    ["layout.js", "frontend.js"],
  );

  const [entry] = buildFrontendPluginRegistry({}, registry, moduleRoot);
  assert.deepEqual(entry.entry.frontend, ["plugins/demo/layout.js", "plugins/demo/frontend.js"]);
});

test("a plugin with a missing frontend script is skipped with a warning", (t) => {
  const moduleRoot = pluginFolder(t, ["frontend.js"], ["layout.js", "frontend.js"]);
  const registry = loadPluginRegistry({ moduleRoot });
  assert.deepEqual(registry.plugins, []);
  assert.match(registry.warnings.join(" "), /missing entry file "layout\.js"/);
});

test("the shipped grid plugin loads its layout before its renderer", () => {
  const registry = loadPluginRegistry({ moduleRoot: path.join(__dirname, "..") });
  const grid = registry.plugins.find((plugin) => plugin.id === "grid");
  assert.deepEqual(grid.manifest.entry.frontend, ["layout.js", "frontend.js"]);
  assert.deepEqual(registry.warnings, []);
});

test("the browser loads a plugin's scripts one after another, in manifest order", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "MMM-Webuntis.js"), "utf8");
  let definition = null;
  const appended = [];
  const document = {
    querySelector: () => null,
    createElement: () => {
      const listeners = {};
      return {
        dataset: {},
        addEventListener: (type, fn) => (listeners[type] = fn),
        fire: (type) => listeners[type]?.(),
      };
    },
    head: { appendChild: (script) => appended.push(script) },
  };
  const context = vm.createContext({ Module: { register: (_name, d) => (definition = d) }, document });
  vm.runInContext(source, context);
  const instance = { ...definition, file: (relative) => `/modules/MMM-Webuntis/${relative}` };

  const done = instance._loadPluginScripts({ id: "demo", entry: { frontend: ["a.js", "b.js"] } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    appended.map((script) => script.src),
    ["/modules/MMM-Webuntis/a.js"],
    "the second script waits for the first",
  );
  appended[0].fire("load");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    appended.map((script) => script.src),
    ["/modules/MMM-Webuntis/a.js", "/modules/MMM-Webuntis/b.js"],
  );
  appended[1].fire("load");
  await done;

  await assert.rejects(
    instance._loadPluginScripts({ id: "demo", entry: { frontend: [] } }),
    /missing a frontend entry/,
  );
});
