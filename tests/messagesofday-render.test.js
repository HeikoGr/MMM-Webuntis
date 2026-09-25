const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { richTextToPlainText, sanitizeRichText } = require("../lib/webuntis/dataOrchestration");

const source = fs.readFileSync(path.join(__dirname, "..", "plugins", "messagesofday", "frontend.js"), "utf8");

/**
 * Load the plugin against a stub host and collect the HTML it hands to addFullRow(), which the
 * real frontend assigns to innerHTML.
 */
function renderMessages(messages) {
  let plugin = null;
  const rows = [];
  const element = () => ({ appendChild() {}, className: "" });
  const dom = {
    addFullRow: (_container, _type, content) => rows.push(content),
    addHeader() {},
    createContainer: element,
    createElement: element,
    escapeHtml: (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;"),
  };
  // The plugin registers itself on globalThis, which inside the context is this object.
  vm.runInNewContext(source, {
    MMMWebuntisPluginHost: { registerFrontendPlugin: (definition) => (plugin = definition) },
    MMMWebuntisFrontendShared: { dom },
  });
  plugin.create({ translate: (_key, fallback) => fallback }).render({
    students: [{ student: { title: "Kind" }, data: { messages } }],
  });
  return rows;
}

test("an encoded tag in a message of the day stays text, formatting stays formatting", () => {
  const [row] = renderMessages([
    {
      subject: richTextToPlainText("Info &amp; Termine", true),
      text: sanitizeRichText("&lt;img src=x onerror=alert(1)&gt;<p><b>fett</b> &amp; normal</p>", true),
    },
  ]);

  assert.ok(!row.includes("<img"), `live markup reached innerHTML: ${row}`);
  assert.ok(row.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.ok(row.includes("<b>fett</b> &amp; normal"));
  assert.ok(row.includes("Info &amp; Termine"));
});

test("line breaks of a message of the day are rendered", () => {
  const [row] = renderMessages([{ subject: "", text: sanitizeRichText("Zeile 1<br>Zeile 2", true) }]);

  assert.ok(row.includes("Zeile 1<br>Zeile 2"));
});
