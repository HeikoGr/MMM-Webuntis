"use strict";

/*
 * Debug dumps hold children's personal data. They must stay out of the folder MagicMirror
 * serves, be readable by the owner only, and carry no credentials.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  DEBUG_DUMP_DIR,
  LEGACY_DEBUG_DUMP_DIR,
  migrateLegacyDumpDir,
  redactDumpFields,
  writeDumpFile,
} = require("../lib/webuntis/debugDumpUtils");
const { redactSensitiveFields } = require("../lib/mmm-adapter/mmmPayloadMapper");

const mode = (file) => fs.statSync(file).mode & 0o777;

function tmpDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mmm-webuntis-dumps-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("dumps live in a dot folder, which MagicMirror does not serve", () => {
  const moduleRoot = path.resolve(__dirname, "..");
  assert.equal(path.dirname(DEBUG_DUMP_DIR), moduleRoot);
  assert.ok(path.basename(DEBUG_DUMP_DIR).startsWith("."));
  assert.equal(path.basename(LEGACY_DEBUG_DUMP_DIR), "debug_dumps");
});

test("writeDumpFile writes owner-only files into an owner-only folder", (t) => {
  const dir = path.join(tmpDir(t), ".debug_dumps");
  const file = writeDumpFile("123_Student_api.json", { a: 1 }, dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { a: 1 });
  assert.equal(mode(file), 0o600);
  assert.equal(mode(dir), 0o700);

  // A name with a path is reduced to its file name: nothing lands outside the folder.
  const escaped = writeDumpFile("../outside.json", {}, dir);
  assert.equal(path.dirname(escaped), dir);
});

test("old dumps move out of debug_dumps/ once", (t) => {
  const root = tmpDir(t);
  const from = path.join(root, "debug_dumps");
  const to = path.join(root, ".debug_dumps");
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, "1_Student_api.json"), "{}", { mode: 0o644 });

  assert.equal(migrateLegacyDumpDir({ from, to }), true);
  assert.equal(fs.existsSync(from), false);
  assert.equal(mode(to), 0o700);
  assert.equal(mode(path.join(to, "1_Student_api.json")), 0o600);
  assert.equal(migrateLegacyDumpDir({ from, to }), false);

  // With both folders present the old one is only removed.
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, "old.json"), "{}");
  assert.equal(migrateLegacyDumpDir({ from, to }), true);
  assert.equal(fs.existsSync(from), false);
  assert.deepEqual(fs.readdirSync(to), ["1_Student_api.json"]);
});

function credentialShapedPayload() {
  return {
    context: {
      config: { username: "parent", password: "pw", qrcode: "untis://setschool?key=ABC", school: "s" },
    },
    session: { cookieString: "JSESSIONID=1", sessionId: "s1", token: "jwt", otp: "123456", key: "K" },
    nested: [{ accessToken: "a", refresh_token: "r", apiKey: "k", Cookie: "c" }],
    data: { lessons: [{ subject: "Math", keyword: "stays", passengers: "stays" }] },
  };
}

function assertNoCredentials(value) {
  assert.equal(value.context.config.password, "<REDACTED>");
  assert.equal(value.context.config.qrcode, "<REDACTED>");
  assert.equal(value.context.config.username, "parent");
  for (const key of ["cookieString", "sessionId", "token", "otp", "key"]) {
    assert.equal(value.session[key], "<REDACTED>", key);
  }
  for (const key of ["accessToken", "refresh_token", "apiKey", "Cookie"]) {
    assert.equal(value.nested[0][key], "<REDACTED>", key);
  }
  assert.deepEqual(value.data.lessons[0], { subject: "Math", keyword: "stays", passengers: "stays" });
}

test("raw API dumps and backend-payload dumps redact the same credential fields", () => {
  const raw = credentialShapedPayload();
  redactDumpFields(raw);
  assertNoCredentials(raw);

  const payload = credentialShapedPayload();
  redactSensitiveFields(payload);
  assertNoCredentials(payload);
});
