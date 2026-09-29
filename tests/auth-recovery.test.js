/**
 * Login behavior of one account under parallel requests, against a fake WebUntis that keeps
 * sessions server-side: a logged-out session answers 401, like the real one.
 */
const assert = require("node:assert/strict");
const test = require("node:test");
const AuthService = require("../lib/webuntis/authService");
const restClient = require("../lib/webuntis/restClient");
const { getMessagesOfDay } = require("../lib/webuntis/webuntisApiService");
const WebUntisClient = require("../lib/webuntis/webuntisClient");

const CREDENTIALS = { school: "s", username: "parent", password: "pw", server: "x.webuntis.com" };
const CACHE_KEY = "parent@x.webuntis.com/s";

function tokenFor(sessionId) {
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900, sid: sessionId }));
  return `h.${payload.toString("base64")}.s`;
}

function sessionOf(token) {
  return JSON.parse(Buffer.from(String(token).split(".")[1], "base64").toString()).sid;
}

/** Fake WebUntis: counts logins, kills logged-out sessions, lets a test hold requests. */
function createFakeServer() {
  const server = { logins: 0, live: new Set(), held: [] };
  server.httpClient = {
    authenticateWithCredentials: async () => {
      server.logins += 1;
      const sessionId = `S${server.logins}`;
      server.live.add(sessionId);
      return { cookies: `JSESSIONID=${sessionId}` };
    },
    getBearerToken: async (_server, cookies) => tokenFor(String(cookies).split("=")[1]),
    logout: async (_server, _school, cookies) => {
      server.live.delete(String(cookies).split("=")[1]);
    },
  };
  server.callRestAPI = async ({ token }) => {
    const sessionId = sessionOf(token);
    const hold = server.held.shift();
    if (hold) await hold;
    if (!server.live.has(sessionId)) {
      throw Object.assign(new Error("Unauthorized"), { status: 401 });
    }
    return { data: [], status: 200 };
  };
  return server;
}

function createAuthService(server) {
  const authService = new AuthService({ logger: () => {} });
  authService.httpClient = server.httpClient;
  authService._fetchAppData = async () => ({ appData: {}, tenantId: 1, schoolYearId: 2 });
  return authService;
}

function authContextFor(authService) {
  return WebUntisClient.prototype._buildRestAuthHandlers.call(
    { responseCache: null },
    {
      authService,
      effectiveCacheKey: CACHE_KEY,
      ...CREDENTIALS,
      authOptions: { cacheKey: CACHE_KEY },
      authRefreshTracker: { refreshed: false },
      responseMaxAgeMs: 0,
    },
  );
}

test("a request that outlives its session does not throw away the session that replaced it", async (t) => {
  const server = createFakeServer();
  const originalCall = restClient.callRestAPI;
  restClient.callRestAPI = server.callRestAPI;
  t.after(() => {
    restClient.callRestAPI = originalCall;
  });

  const authService = createAuthService(server);
  await authService.getAuth({ ...CREDENTIALS, options: { cacheKey: CACHE_KEY } });
  assert.equal(server.logins, 1);

  // Request A takes session S1 and is still in flight ...
  let releaseA;
  server.held.push(
    new Promise((resolve) => {
      releaseA = resolve;
    }),
  );
  const requestA = getMessagesOfDay({ authContext: authContextFor(authService), server: "x", date: new Date() });
  await new Promise((resolve) => setImmediate(resolve));

  // ... when the token is about to expire and the session is too old to renew: request B logs in
  // again (S2), and the replaced session S1 is logged out.
  const cached = authService._authCache.get(CACHE_KEY);
  cached.expiresAt = Date.now() + 1000;
  cached.sessionStartedAt = Date.now() - 7 * 60 * 60 * 1000;
  await getMessagesOfDay({ authContext: authContextFor(authService), server: "x", date: new Date() });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(server.logins, 2);
  assert.ok(!server.live.has("S1"), "the replaced session is logged out");

  // A now gets its 401. It must retry with S2, not discard S2 and log in a third time.
  releaseA();
  await requestA;
  assert.equal(server.logins, 2, "no third login");
  assert.equal(sessionOf(authService._authCache.get(CACHE_KEY).token), "S2");
});

test("several requests failing with the same dead session share one login", async (t) => {
  const server = createFakeServer();
  const originalCall = restClient.callRestAPI;
  restClient.callRestAPI = server.callRestAPI;
  t.after(() => {
    restClient.callRestAPI = originalCall;
  });

  const authService = createAuthService(server);
  await authService.getAuth({ ...CREDENTIALS, options: { cacheKey: CACHE_KEY } });
  server.live.delete("S1"); // the session idled out on the server

  await Promise.all(
    [1, 2, 3, 4].map(() =>
      getMessagesOfDay({ authContext: authContextFor(authService), server: "x", date: new Date() }),
    ),
  );
  assert.equal(server.logins, 2, "one login for all four");
});
