const test = require("node:test");
const assert = require("node:assert/strict");

const { isNetworkError, convertRestErrorToWarning } = require("../lib/webuntis/errorHandler");
const { classifyWarningMetaFromError } = require("../lib/warningUtils");

const network = [
  ["DNS failure", Object.assign(new Error("getaddrinfo EAI_AGAIN srv"), { code: "EAI_AGAIN" })],
  ["unknown host", Object.assign(new Error("x"), { code: "ENOTFOUND" })],
  ["reset (code on the cause)", Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } })],
  ["abort", Object.assign(new Error("This operation was aborted"), { name: "AbortError" })],
  ["text only", new Error("connect ECONNRESET 1.2.3.4:443")],
];
const notNetwork = [
  ["HTTP 404", Object.assign(new Error("Not Found"), { status: 404 })],
  ["auth", Object.assign(new Error("Invalid credentials"), { code: "AUTH_FAILED" })],
];

test("one classification of network errors for warnings and their texts", () => {
  for (const [label, error] of network) {
    assert.equal(isNetworkError(error), true, label);
    assert.equal(classifyWarningMetaFromError(error).kind, "network", label);
    assert.match(
      convertRestErrorToWarning(error, { server: "srv", studentTitle: "A" }) || "",
      /srv|timeout|reset/i,
      label,
    );
  }
  for (const [label, error] of notNetwork) {
    assert.equal(isNetworkError(error), false, label);
    assert.notEqual(classifyWarningMetaFromError(error).kind, "network", label);
  }
});
