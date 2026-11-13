const assert = require("node:assert/strict");
const test = require("node:test");
const fetchClient = require("../lib/webuntis/fetchClient");
const AuthService = require("../lib/webuntis/authService");
const { createAuthSession } = require("../lib/authSession");

const APP_DATA = {
  tenant: { id: 1 },
  currentSchoolYear: { id: 2 },
  user: { roles: ["STUDENT"], person: { id: 3 }, students: [] },
};

/** An AuthService whose network calls are stubbed; counts logins and raw app/data dumps. */
function createService(t) {
  const service = new AuthService({ logger: () => {} });
  const calls = { logins: 0, dumps: [] };
  service.httpClient.authenticateWithCredentials = async () => {
    calls.logins += 1;
    return { cookies: `c${calls.logins}` };
  };
  service.httpClient.authenticateWithQRCode = async () => {
    calls.logins += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return { cookies: `q${calls.logins}`, personId: 3, school: "s", server: "srv" };
  };
  service.httpClient.getBearerToken = async () => "token";
  service.httpClient.logout = async () => {};
  service._writeDebugDump = (_server, suffix) => calls.dumps.push(suffix);
  const originalGet = fetchClient.get;
  fetchClient.get = async () => ({ status: 200, data: structuredClone(APP_DATA) });
  t.after(() => {
    fetchClient.get = originalGet;
  });
  return { service, calls };
}

test("dumpRawApiResponses dumps the raw app/data of a login and keeps using the cached session", async (t) => {
  const { service, calls } = createService(t);
  const login = () =>
    service.getAuth({
      school: "s",
      username: "u",
      password: "p",
      server: "srv",
      options: { cacheKey: "k", dumpRawApiResponses: true },
    });

  const first = await login();
  const second = await login();

  assert.equal(calls.logins, 1, "the dump option does not force a login per request");
  assert.deepEqual(calls.dumps, ["appdata"]);
  assert.equal(first.tenantId, 1);
  assert.equal(second.token, "token");
  assert.equal("rawAppData" in service._authCache.get("k"), false, "the raw app/data is not cached");
});

test("without dumpRawApiResponses a login writes no dump", async (t) => {
  const { service, calls } = createService(t);
  await service.getAuth({ school: "s", username: "u", password: "p", server: "srv", options: { cacheKey: "k" } });
  assert.deepEqual(calls.dumps, []);
});

test("createAuthSession hands dumpRawApiResponses to the login", async () => {
  const seen = [];
  const authService = {
    getAuth: async ({ options }) => {
      seen.push(options);
      return { token: "t", cookieString: "c", appData: {} };
    },
    getAuthFromQRCode: async (_qr, options) => {
      seen.push(options);
      return { token: "t", cookieString: "c", appData: {} };
    },
  };
  const config = { username: "parent", password: "secret", school: "s", server: "srv", dumpRawApiResponses: true };

  await createAuthSession(authService, { studentId: 5, title: "A" }, config, "parent:x");
  await createAuthSession(authService, { qrcode: "untis://setschool?user=a", title: "B" }, config, "qr:x");

  assert.deepEqual(
    seen.map((options) => options.dumpRawApiResponses),
    [true, true],
  );
  assert.deepEqual(
    seen.map((options) => options.cacheKey),
    ["parent:x", "qr:x"],
  );
});

test("after invalidateCache, simultaneous QR requests share one login", async (t) => {
  const { service, calls } = createService(t);
  const qr = "untis://setschool?user=a";
  await service.getAuthFromQRCode(qr, { cacheKey: "q" });
  assert.equal(service.invalidateCache("q"), true);

  const results = await Promise.all([1, 2, 3].map(() => service.getAuthFromQRCode(qr, { cacheKey: "q" })));

  assert.equal(calls.logins, 2, "one login before, one after the invalidation");
  assert.equal(new Set(results.map((result) => result.cookieString)).size, 1);
  assert.ok(Number.isFinite(service._authCache.get("q").sessionStartedAt), "a QR login is cached like any other");
});
