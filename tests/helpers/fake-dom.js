/**
 * Just enough DOM to run the frontend's node builders in Node: elements, text nodes, append and a
 * serializer that escapes like a browser's innerHTML. Deliberately without any HTML parser, so a
 * test fails loudly if code under test tries to parse markup.
 */
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const VOID_TAGS = new Set(["br", "img", "hr", "input"]);

class FakeText {
  constructor(data) {
    this.nodeType = 3;
    this.nodeName = "#text";
    this.data = String(data);
  }
}

class FakeElement {
  constructor(tag) {
    this.nodeType = 1;
    this.nodeName = String(tag).toUpperCase();
    this.tagName = this.nodeName;
    this.childNodes = [];
    this.attributes = new Map();
    this.style = {};
  }

  get className() {
    return this.attributes.get("class") ?? "";
  }

  set className(value) {
    this.attributes.set("class", String(value));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...items) {
    for (const item of items) this.childNodes.push(typeof item === "string" ? new FakeText(item) : item);
  }

  appendChild(node) {
    // Like the DOM: appending a fragment moves its children, not the fragment itself.
    if (node?.nodeType === 11) {
      this.childNodes.push(...node.childNodes);
      node.childNodes = [];
      return node;
    }
    this.childNodes.push(node);
    return node;
  }

  replaceChildren(...items) {
    this.childNodes = [];
    this.append(...items);
  }

  hasChildNodes() {
    return this.childNodes.length > 0;
  }

  get childElementCount() {
    return this.childNodes.filter((node) => node.nodeType === 1).length;
  }

  get textContent() {
    return this.childNodes.map((node) => (node.nodeType === 3 ? node.data : node.textContent)).join("");
  }

  set textContent(value) {
    this.childNodes = [new FakeText(value ?? "")];
  }

  /** All descendant elements with the given tag name (lower case). */
  findAll(tag) {
    const found = [];
    for (const node of this.childNodes) {
      if (node.nodeType !== 1) continue;
      if (node.nodeName.toLowerCase() === tag) found.push(node);
      found.push(...node.findAll(tag));
    }
    return found;
  }

  get outerHTML() {
    const tag = this.nodeName.toLowerCase();
    const attrs = [...this.attributes].map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join("");
    if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${this.innerHTMLString}</${tag}>`;
  }

  get innerHTMLString() {
    return this.childNodes.map((node) => (node.nodeType === 3 ? escapeText(node.data) : node.outerHTML)).join("");
  }
}

function escapeText(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\u00A0/g, "&nbsp;");
}

function escapeAttribute(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/\u00A0/g, "&nbsp;");
}

function createFakeDocument() {
  return {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (data) => new FakeText(data),
    createDocumentFragment: () => Object.assign(new FakeElement("#document-fragment"), { nodeType: 11 }),
  };
}

/**
 * Loads lib/frontendShared.js against a fake document. Returns the context (its globalThis), so
 * plugins can be run in it too.
 */
function loadFrontendShared(extraGlobals = {}) {
  const context = { console, document: createFakeDocument(), ...extraGlobals };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  const source = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "frontendShared.js"), "utf8");
  vm.runInContext(source, context);
  return context;
}

/** Runs a frontend plugin file in a context from loadFrontendShared() and returns its definition. */
/** Run a plugin's frontend scripts in manifest order, as the host does, and return what it registered. */
function loadPlugin(context, pluginId) {
  let definition = null;
  context.MMMWebuntisPluginHost = { registerFrontendPlugin: (plugin) => (definition = plugin) };
  const pluginRoot = path.join(__dirname, "..", "..", "plugins", pluginId);
  const { frontend } = JSON.parse(fs.readFileSync(path.join(pluginRoot, "manifest.json"), "utf8")).entry;
  for (const script of [].concat(frontend)) {
    vm.runInContext(fs.readFileSync(path.join(pluginRoot, script), "utf8"), context);
  }
  return definition;
}

/**
 * The pluginContext a plugin gets from the host (MMM-Webuntis.js, _createFrontendPluginContext): the shared
 * namespaces of the given context plus whatever the test sets (translate, log, ...).
 */
function pluginContextFor(context, extra = {}) {
  const shared = context.MMMWebuntisFrontendShared || {};
  return {
    dom: shared.dom || {},
    time: shared.time || {},
    formatting: shared.formatting || {},
    widget: shared.widget || {},
    shared,
    ...extra,
  };
}

module.exports = { FakeElement, FakeText, createFakeDocument, loadFrontendShared, loadPlugin, pluginContextFor };
