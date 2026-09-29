const test = require("node:test");
const assert = require("node:assert/strict");
const { richTextToPlainText, sanitizeRichText } = require("../lib/webuntis/dataOrchestration");
const { FakeElement, FakeText, loadFrontendShared, loadPlugin } = require("./helpers/fake-dom");

/**
 * Renders messages with the real frontendShared.js and the real plugin. DOMParser does not exist in
 * Node: the stub records what the plugin hands to the rich-text parser and returns it as one text
 * node, so the test sees exactly which string would be parsed and nothing else is.
 */
function renderMessages(messages) {
  const parsed = [];
  class DOMParser {
    parseFromString(html) {
      parsed.push(html);
      return { body: { childNodes: [new FakeText(html)] } };
    }
  }
  const context = loadFrontendShared({ DOMParser });
  const plugin = loadPlugin(context, "messagesofday");
  const section = plugin.create({ translate: (_key, fallback) => fallback }).render({
    students: [{ student: { title: "Kind" }, data: { messages } }],
  });
  return { section, parsed };
}

test("an encoded tag in a message of the day stays text, formatting stays formatting", () => {
  const text = sanitizeRichText("&lt;img src=x onerror=alert(1)&gt;<p><b>fett</b> &amp; normal</p>", true);
  const { section, parsed } = renderMessages([
    { subject: richTextToPlainText("Info &amp; <b>Termine</b>", true), text },
  ]);

  // The only string that reaches an HTML parser is the sanitized text (line breaks as <br>): its
  // entities are still encoded, so the parser turns "&lt;img …&gt;" into text, never into an element.
  assert.deepEqual(parsed, [text.replace(/\n/g, "<br>")]);
  assert.ok(!text.includes("<img"), `sanitizer let a live tag through: ${text}`);
  assert.ok(text.includes("<b>fett</b> &amp; normal"));

  // The subject is plain text: no element inside, entities decoded once by the backend.
  const [subject] = section.findAll("span").filter((span) => span.className.includes("message-subject"));
  assert.equal(subject.textContent, "Info & Termine");
  assert.equal(subject.childElementCount, 0);
});

test("line breaks of a message of the day are rendered", () => {
  const { parsed } = renderMessages([{ subject: "", text: sanitizeRichText("Zeile 1<br>Zeile 2\nZeile 3", true) }]);

  assert.equal(parsed.length, 1);
  assert.ok(parsed[0].startsWith("Zeile 1"));
  assert.ok(parsed[0].endsWith("<br>Zeile 3"), parsed[0]);
});

test("a message without text shows the placeholder, parsed by nobody", () => {
  const { section, parsed } = renderMessages([{ subject: "Leer", text: "" }]);

  assert.deepEqual(parsed, []);
  assert.ok(section.textContent.includes("No text"));
});

test("the rich-text whitelist drops everything but formatting tags, and every attribute", () => {
  const context = loadFrontendShared();
  const { rebuildRichTextNodes } = context.MMMWebuntisFrontendShared.testing;

  // What a parser would make of markup that slipped past the backend sanitizer.
  const element = (tag, attributes, ...children) => {
    const node = new FakeElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  };
  const source = [
    element("b", { onclick: "alert(1)", class: "x" }, "fett"),
    element("img", { src: "x", onerror: "alert(1)" }),
    element("script", {}, "alert(1)"),
    { nodeType: 8, nodeName: "#comment", data: "<b>no</b>", childNodes: [] },
    element("span", { style: "color:red" }, "ausgepackt ", element("i", {}, "kursiv")),
    element("p", { id: "p" }, element("li", {}, "eins"), element("iframe", { src: "https://example.org" }, "weg")),
    element("a", { href: "javascript:alert(1)" }, "Linktext"),
    new FakeText("<img src=x> bleibt Text"),
  ];

  const html = rebuildRichTextNodes(source)
    .map((node) => (node.nodeType === 3 ? node.data : node.outerHTML))
    .join("|");

  assert.equal(html, "<b>fett</b>|ausgepackt |<i>kursiv</i>|<p><li>eins</li></p>|Linktext|<img src=x> bleibt Text");
});
