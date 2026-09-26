const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadFrontendShared } = require("./helpers/fake-dom");

const ROOT = path.join(__dirname, "..");
const FRONTEND_FILES = [
  "MMM-Webuntis.js",
  "lib/frontendShared.js",
  "lib/pluginHostFrontend.js",
  "lib/runtime-utils.js",
  ...fs.readdirSync(path.join(ROOT, "plugins")).map((plugin) => `plugins/${plugin}/frontend.js`),
].filter((file) => fs.existsSync(path.join(ROOT, file)));

// Comments may name the old sinks; only code counts.
const codeOf = (file) =>
  fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("the frontend builds its markup as DOM nodes, never from HTML strings", () => {
  assert.ok(FRONTEND_FILES.length >= 8, `too few frontend files found: ${FRONTEND_FILES.join(", ")}`);
  for (const file of FRONTEND_FILES) {
    const code = codeOf(file);
    for (const sink of [/\.innerHTML\s*=/, /\.outerHTML\s*=/, /insertAdjacentHTML\s*\(/, /document\.write\s*\(/]) {
      assert.doesNotMatch(code, sink, `HTML sink ${sink} in ${file} - build nodes with dom.el() instead`);
    }
    assert.doesNotMatch(code, /\bescapeHtml\b/, `${file} escapes by hand; strings given to dom.el() are text already`);
  }
});

test("only richTextNodes() parses markup, for the sanitized messages of the day", () => {
  const parsers = FRONTEND_FILES.filter((file) =>
    /\bDOMParser\b|createContextualFragment|parseHTMLUnsafe/.test(codeOf(file)),
  );
  assert.deepEqual(parsers, ["lib/frontendShared.js"]);
  assert.equal(codeOf("lib/frontendShared.js").match(/new DOMParser\(\)/g)?.length, 1);
});

test("strings handed to the row helpers stay text, whatever they contain", () => {
  const { dom } = loadFrontendShared().MMMWebuntisFrontendShared;
  const container = dom.createContainer();
  // A student name as WebUntis or config.js may deliver it (issue found 2026-09-26: lessons in
  // compact mode rendered it as markup).
  const name = "A & <b>B</b> <img src=x onerror=alert(1)>";

  dom.addHeader(container, name);
  dom.addRow(container, "lessonRow", name, "Mo 28.09.", [dom.el("span", "wu-lesson__subject", name), " "]);
  dom.addFullRow(container, "messageRow", name);

  assert.deepEqual(container.findAll("b").concat(container.findAll("img")), [], "markup in a string became an element");
  assert.equal(container.textContent.split(name).length - 1, 4);
  assert.ok(container.outerHTML.includes("A &amp; &lt;b&gt;B&lt;/b&gt;"));
});

test("dom.el() turns non-node values into text instead of failing", () => {
  const { dom } = loadFrontendShared().MMMWebuntisFrontendShared;
  const span = dom.el("span", "x", 0, null, undefined, false, "", { name: "Obj" }, ["a", ["b"]]);

  assert.equal(span.textContent, "0[object Object]ab");
});
