const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// A plugin looks a key up in its own table first, then in the module table (MMM-Webuntis.js
// _translatePluginKey). A missing key does not fail at runtime, it silently shows the English
// fallback, so the tables are checked here.

const root = path.join(__dirname, "..");
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
const plugins = fs.readdirSync(path.join(root, "plugins")).filter((name) => {
  return fs.existsSync(path.join(root, "plugins", name, "frontend.js"));
});
const tables = {
  module: { dir: path.join(root, "translations") },
  ...Object.fromEntries(plugins.map((name) => [name, { dir: path.join(root, "plugins", name, "translations") }])),
};
for (const table of Object.values(tables)) {
  table.en = readJson(path.join(table.dir, "en.json"));
  table.de = readJson(path.join(table.dir, "de.json"));
}

// First string literal of a translate call, also after a context argument:
// translate(ctx, "key", …), ctx.translate("key"), t("key", …), translateDayState(ctx, "key", …).
const KEY_CALL = /(?:translate\w*|\bt)\??\.?\(\s*(?:[A-Za-z_$][\w.?$]*\s*,\s*)?["'`]([A-Za-z0-9_-]+)["'`]/g;
const literalKeys = (file) => [...fs.readFileSync(path.join(root, file), "utf8").matchAll(KEY_CALL)].map((m) => m[1]);

// Keys built at runtime, which the pattern above cannot see.
const DYNAMIC_KEYS = {
  grid: [
    "lesson_status_regular",
    "lesson_status_changed",
    "lesson_status_cancelled",
    "lesson_status_additional",
    "lesson_status_substitution",
    "hidden_lessons",
    "hidden_lessons_plural",
  ],
  homework: ["no_homework"],
  absences: ["no_absences"],
};

test("every translation table has the same keys in English and German", () => {
  for (const [name, table] of Object.entries(tables)) {
    assert.deepEqual(Object.keys(table.de).sort(), Object.keys(table.en).sort(), name);
  }
});

test("every key a plugin asks for exists in its own table or the module table", () => {
  for (const name of plugins) {
    const keys = [...literalKeys(`plugins/${name}/frontend.js`), ...(DYNAMIC_KEYS[name] || [])];
    const missing = keys.filter((key) => !(key in tables[name].en) && !(key in tables.module.en));
    assert.deepEqual(missing, [], name);
  }
});

test("every key the shared frontend code asks for exists in some table", () => {
  const known = new Set(Object.values(tables).flatMap((table) => Object.keys(table.en)));
  for (const file of ["MMM-Webuntis.js", "lib/frontendShared.js"]) {
    assert.deepEqual(
      literalKeys(file).filter((key) => !known.has(key)),
      [],
      file,
    );
  }
});

test("no table carries keys that no code asks for", () => {
  const used = new Set(
    ["MMM-Webuntis.js", "lib/frontendShared.js", ...plugins.map((name) => `plugins/${name}/frontend.js`)].flatMap(
      literalKeys,
    ),
  );
  for (const keys of Object.values(DYNAMIC_KEYS)) for (const key of keys) used.add(key);
  for (const [name, table] of Object.entries(tables)) {
    assert.deepEqual(
      Object.keys(table.en).filter((key) => !used.has(key)),
      [],
      name,
    );
  }
});
