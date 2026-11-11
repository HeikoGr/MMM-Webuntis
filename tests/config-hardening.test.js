"use strict";

/*
 * Config values that end up in URLs, file paths or browser payloads: the WebUntis server must be
 * a host name, demo fixtures come from demo/ only, and no payload carries credentials.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeServerHost } = require("../lib/webuntis/serverHost");
const { validateConfig } = require("../lib/configValidator");
const { buildDemoPayloads, resolveFixturePaths } = require("../lib/demoData");
const HttpClient = require("../lib/webuntis/httpClient");

const moduleRoot = path.join(__dirname, "..");
const FIXTURE = "demo/fixtures/single-student-week.json";

test("server: a pasted https:// or trailing slash is cleaned", () => {
  assert.deepEqual(normalizeServerHost("https://x.webuntis.com/"), {
    host: "x.webuntis.com",
    cleaned: true,
    error: null,
  });
  // Surrounding blanks go silently.
  assert.deepEqual(normalizeServerHost(" x.webuntis.com "), { host: "x.webuntis.com", cleaned: false, error: null });
  assert.deepEqual(normalizeServerHost("x.webuntis.com:8443"), {
    host: "x.webuntis.com:8443",
    cleaned: false,
    error: null,
  });
});

test("server: paths, users, queries and other schemes are rejected", () => {
  for (const value of [
    "x.webuntis.com/pfad",
    "user@x.webuntis.com",
    "x.webuntis.com?a=1",
    "ftp://x.webuntis.com",
    "",
    42,
  ]) {
    assert.ok(normalizeServerHost(value).error, `${value} must be rejected`);
  }
});

test("validateConfig cleans server values and names the broken ones", () => {
  const config = {
    server: "https://school.webuntis.com/",
    students: [
      { title: "A", username: "u", password: "p", school: "s", server: "user@evil.example" },
      { title: "B", username: "u", password: "p", school: "s" },
    ],
  };
  const { errors, warnings } = validateConfig(config, { log() {} });
  assert.equal(config.server, "school.webuntis.com");
  assert.ok(warnings.some((w) => w.includes('"server": using "school.webuntis.com"')));
  assert.ok(errors.some((e) => e.includes('"students[0].server"') && e.includes("not a host name")));
});

test("a QR code whose url parameter is no host name is refused before any request", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error("must not be called");
  };
  try {
    const client = new HttpClient();
    const qr = "untis://setschool?url=evil.example/x%3F&school=s&user=u&key=JBSWY3DPEHPK3PXP";
    await assert.rejects(client.authenticateWithQRCode(qr), /not a WebUntis host name/);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("demoDataFile only reads .json files inside demo/", (t) => {
  assert.equal(resolveFixturePaths(FIXTURE, moduleRoot).length, 1);
  for (const value of [
    "package.json",
    "debug_dumps/x.json",
    ".debug_dumps/x.json",
    "demo/fixtures/README.md",
    "demo/../package.json",
  ]) {
    assert.throws(() => resolveFixturePaths(value, moduleRoot), /inside the demo\/ folder/, value);
  }

  // A link inside demo/ that points outside is followed and refused.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-webuntis-demo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "demo"));
  fs.writeFileSync(path.join(root, "secret.json"), "{}");
  fs.symlinkSync(path.join(root, "secret.json"), path.join(root, "demo", "link.json"));
  fs.writeFileSync(path.join(root, "demo", "ok.json"), "{}");
  assert.throws(() => resolveFixturePaths("demo/link.json", root), /inside the demo\/ folder/);
  assert.equal(resolveFixturePaths("demo/ok.json", root).length, 1);
});

test("demo payloads carry no credentials, like live payloads", () => {
  const withStudents = buildDemoPayloads(
    {
      demoDataFile: FIXTURE,
      qrcode: "untis://setschool?url=x.webuntis.com&school=s&user=u&key=SECRETKEY",
      students: [{ title: "Avery", username: "u", password: "hunter22", qrcode: "untis://own" }],
    },
    moduleRoot,
  );
  const autoStudents = buildDemoPayloads(
    { demoDataFile: FIXTURE, qrcode: "untis://setschool?key=SECRETKEY", password: "pw" },
    moduleRoot,
  );
  for (const payload of [...withStudents, ...autoStudents]) {
    assert.equal("password" in payload.context.config, false);
    assert.equal("qrcode" in payload.context.config, false);
    assert.equal(JSON.stringify(payload).includes("SECRETKEY"), false);
  }
});
