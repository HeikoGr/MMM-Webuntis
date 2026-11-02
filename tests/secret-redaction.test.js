/**
 * Issue #147: a QR-code login timeout showed the QR URL with its `key=` OTP secret on the mirror.
 * Covers the redaction itself, every path a message takes from the backend to the screen and the
 * log, and the bounded warning display.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const Module = require("node:module");
const { collectConfigSecrets, redactSecrets, registerSecrets } = require("../lib/secretRedaction");
const { describeCredentialKey, getCredentialKey, resolveServerName } = require("../lib/authSession");
const { createFakeDocument } = require("./helpers/fake-dom");

const OTP_KEY = "JBSWY3DPEHPK3PXPQRSTUVWX";
const QR = `untis://setschool?url=demo.webuntis.com&school=demo-school&user=max.muster&key=${OTP_KEY}`;
const PASSWORD = "Pa55word-147!";

/** node_helper with stubbed MagicMirror modules; returns the helper and its captured log lines. */
function loadNodeHelper() {
  const lines = [];
  const originalLoad = Module._load;
  const helperPath = require.resolve("../node_helper");
  delete require.cache[helperPath];
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "node_helper") return { create: (definition) => definition };
    if (request === "logger") {
      const capture = (level) => (message) => lines.push({ level, message });
      return { debug: capture("debug"), info: capture("info"), warn: capture("warn"), error: capture("error") };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return { helper: require("../node_helper"), lines };
  } finally {
    Module._load = originalLoad;
  }
}

/** Frontend module definition, as Module.register() receives it. */
function loadFrontendModule() {
  const previousModule = global.Module;
  let definition = null;
  global.Module = { register: (_name, def) => (definition = def) };
  const modulePath = require.resolve("../MMM-Webuntis");
  delete require.cache[modulePath];
  try {
    require(modulePath);
  } finally {
    global.Module = previousModule;
  }
  return definition;
}

const timeoutError = () =>
  // The worst case: an error that carries the whole QR URL in its message.
  Object.assign(new Error(`Request timeout after 10000ms for ${QR}`), { code: "ETIMEDOUT" });

test("redactSecrets removes secret-shaped values and keeps the rest of the text", () => {
  // The value ends at a separator; a ":" belongs to it, so a password containing one does not leak.
  assert.equal(
    redactSecrets(`Authentication failed for qrcode:${QR}: timeout`),
    "Authentication failed for qrcode:untis://setschool?url=demo.webuntis.com&school=demo-school&user=max.muster&key=*** timeout",
  );
  assert.equal(redactSecrets("GET /x?user=a&password=hunter2&b=1"), "GET /x?user=a&password=***&b=1");
  assert.equal(redactSecrets('body {"user":"a","password":"hunter2"}'), 'body {"user":"a","password":"***"}');
  assert.equal(redactSecrets("Authorization: Bearer abc.def-ghi"), "Authorization: Bearer ***");
  assert.equal(redactSecrets("token eyJhbGciOi.eyJzdWIiOjF9.c2ln end"), "token *** end");
  assert.equal(redactSecrets("Cookie: JSESSIONID=ABCDEF; schoolname=x"), "Cookie: JSESSIONID=***; schoolname=x");
  // Longer names that only end in a secret name stay readable.
  assert.equal(redactSecrets("waiting for credKey=parent:a@b/c"), "waiting for credKey=parent:a@b/c");
  assert.equal(redactSecrets(undefined), "");
});

test("registered config secrets are removed wherever they appear, also URL-encoded", () => {
  const config = {
    password: PASSWORD,
    students: [
      { title: "Max", qrcode: QR },
      { title: "Short", password: "abc" },
    ],
  };
  const secrets = collectConfigSecrets(config);
  assert.ok(secrets.includes(PASSWORD) && secrets.includes(QR) && secrets.includes(OTP_KEY));
  registerSecrets(secrets);

  assert.equal(redactSecrets(`login with ${PASSWORD} failed`), "login with *** failed");
  assert.ok(!redactSecrets(`qr=${encodeURIComponent(QR)}`).includes(OTP_KEY));
  assert.equal(redactSecrets(`secret ${OTP_KEY} somewhere`), "secret *** somewhere");
  // Too short to be replaced safely: "abc" would hit ordinary words.
  assert.equal(redactSecrets("abc def"), "abc def");
});

test("describeCredentialKey names the account without the QR-code secret", () => {
  assert.equal(
    describeCredentialKey(getCredentialKey({ qrcode: QR }, {})),
    "qrcode:max.muster@demo.webuntis.com/demo-school",
  );
  assert.equal(describeCredentialKey("qrcode:not a url"), "qrcode:(malformed)");
  assert.equal(describeCredentialKey("parent:p@s.webuntis.com/school"), "parent:p@s.webuntis.com/school");
  assert.equal(describeCredentialKey("user:u@s/school"), "user:u@s/school");
});

test("resolveServerName finds the server of a QR-code login", () => {
  assert.equal(resolveServerName({ qrcode: QR }, {}), "demo.webuntis.com");
  assert.equal(resolveServerName({ studentId: 1 }, { qrcode: QR }), "demo.webuntis.com");
  assert.equal(resolveServerName({ server: "own.webuntis.com", qrcode: QR }, {}), "own.webuntis.com");
  assert.equal(resolveServerName({}, {}), "webuntis.com");
});

test("a failed QR-code login reaches the mirror and the log without the key", async () => {
  const { helper, lines } = loadNodeHelper();
  try {
    const config = helper.prepareConfig({ id: "qr", displayMode: "lessons", students: [{ title: "Max", qrcode: QR }] });
    helper._authService.getAuthFromQRCode = async () => {
      throw timeoutError();
    };

    const result = await helper.fetchInstance({ identifier: "qr", config, reason: "test" });

    const [payload] = result.students;
    assert.deepEqual(payload.state.warnings, [
      'WebUntis connection timeout for "Max". Server is slow or overloaded. Will retry automatically.',
    ]);
    assert.equal(payload.state.warningMeta[0].kind, "network");
    assert.equal(payload.context.config.qrcode, undefined, "the student's own QR code is not sent back");
    assert.ok(!JSON.stringify(result).includes(OTP_KEY));

    const errorLine = lines.find((line) => line.level === "error" && line.message.includes("Cannot reach"));
    assert.ok(errorLine, "the technical detail stays in the log");
    assert.match(errorLine.message, /qrcode:max\.muster@demo\.webuntis\.com\/demo-school/);
    const logText = lines.map((line) => line.message).join("\n");
    assert.ok(!logText.includes(OTP_KEY));
  } finally {
    helper.stop();
  }
});

test("a rejected password login warns with the server's message, never with the password", async () => {
  const { helper, lines } = loadNodeHelper();
  try {
    const config = helper.prepareConfig({
      id: "pw",
      displayMode: "lessons",
      students: [{ title: "Lea", username: "lea", password: PASSWORD, school: "s", server: "x.webuntis.com" }],
    });
    helper._authService.getAuth = async () => {
      throw Object.assign(
        new Error(`Credentials authentication failed: 200 - bad credentials (password=${PASSWORD})`),
        {
          code: "AUTH_FAILED",
          isAuthError: true,
          httpStatus: 200,
        },
      );
    };

    const result = await helper.fetchInstance({ identifier: "pw", config, reason: "test" });

    const [warning] = result.students[0].state.warnings;
    assert.match(warning, /^Authentication failed for "Lea": Credentials authentication failed: 200 - bad credentials/);
    assert.ok(!JSON.stringify(result).includes(PASSWORD));
    assert.doesNotMatch(lines.map((line) => line.message).join("\n"), /Pa55word/);
  } finally {
    helper.stop();
  }
});

test("a QR code with a malformed key is reported as a login problem, not as a network error", async () => {
  const { helper } = loadNodeHelper();
  try {
    const badQr = QR.replace(OTP_KEY, "NOT-BASE32-1890");
    const config = helper.prepareConfig({
      id: "bad",
      displayMode: "lessons",
      students: [{ title: "Max", qrcode: badQr }],
    });

    const result = await helper.fetchInstance({ identifier: "bad", config, reason: "test" });

    assert.deepEqual(result.students[0].state.warnings, [
      'Authentication failed for "Max": Invalid Base32 character at position 4 in OTP secret',
    ]);
  } finally {
    helper.stop();
  }
});

test("a fetch that fails as a whole sends FETCH_FAILED without secrets", async () => {
  const { helper } = loadNodeHelper();
  try {
    helper._ensureRuntime();
    helper._fetchInstanceData = async () => {
      throw new Error(`unexpected failure for ${QR}`);
    };
    await assert.rejects(helper.fetchInstance({ identifier: "x", config: {} }), (error) => {
      assert.match(error.message, /^unexpected failure for /);
      assert.ok(!error.message.includes(OTP_KEY));
      return true;
    });
  } finally {
    helper.stop();
  }
});

test("the mirror shows at most three warnings, critical ones first, the rest as one line", () => {
  const view = loadFrontendModule();
  const previousDocument = global.document;
  global.document = createFakeDocument();
  try {
    view.translate = (key, vars) => (key === "more_warnings" ? `+${vars.count} more` : key);
    view._getDisplayWidgets = () => [];
    view._getSortedStudentTitles = () => [];
    view._createWidgetRenderers = () => ({});
    view.moduleWarningsSet = new Set(["config 1", "config 2"]);
    view.moduleWarningMetaByMessage = new Map([["config 2", { message: "config 2", severity: "critical" }]]);
    view.runtimeWarningsByStudent = { Max: new Set(["runtime 1", "runtime 2", "runtime 3"]) };

    const boxes = view.getDom().childNodes.filter((node) => node.className.includes("mmm-webuntis-warning"));

    assert.deepEqual(
      boxes.map((box) => box.textContent.trim()),
      ["config 2", "config 1", "runtime 1", "+2 more"],
    );
    assert.match(boxes[0].className, /\bcritical\b/);
    assert.match(boxes[3].className, /\bmore\b/);
  } finally {
    global.document = previousDocument;
  }
});
