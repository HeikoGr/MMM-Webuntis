const test = require("node:test");
const assert = require("node:assert/strict");

const { tryOrDefault, tryOrNull, tryOrThrow } = require("../lib/webuntis/errorUtils");
const fetchClient = require("../lib/webuntis/fetchClient");
const HttpClient = require("../lib/webuntis/httpClient");

test("the sync helpers refuse an async function instead of letting its rejection slip past", () => {
  const failing = async () => {
    throw new Error("boom");
  };
  for (const run of [() => tryOrDefault(failing, 7), () => tryOrNull(failing), () => tryOrThrow(failing)]) {
    assert.throws(run, { name: "TypeError", message: /use wrapAsync/ });
  }
  assert.equal(
    tryOrDefault(() => JSON.parse("{"), "fallback"),
    "fallback",
  );
});

test("a failed credential login is logged by the HTTP client and still rejects", async (t) => {
  t.mock.method(fetchClient, "post", async () => {
    throw new Error("ECONNRESET");
  });
  const lines = [];
  const client = new HttpClient({ logger: (level, message) => lines.push(`${level} ${message}`) });

  await assert.rejects(
    client.authenticateWithCredentials({ school: "s", username: "u", password: "p", server: "x.webuntis.com" }),
    /ECONNRESET/,
  );
  assert.deepEqual(lines, ["error [HttpClient] Credential auth: ECONNRESET"]);
});
