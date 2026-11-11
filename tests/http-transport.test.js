"use strict";

/*
 * The HTTP layer under the WebUntis client: cookies as WebUntis sends them, and
 * timeouts that cover a response whose body never arrives.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const CookieJar = require("../lib/webuntis/cookieJar");
const fetchClient = require("../lib/webuntis/fetchClient");

function headersWithCookies(cookies) {
  return { getSetCookie: () => cookies };
}

test("cookieJar keeps '=' inside a cookie value", () => {
  const jar = new CookieJar();
  jar.setCookies(
    headersWithCookies([
      "tok=YWJj==; Path=/; HttpOnly",
      'schoolname="_bXlzY2hvb2w="; Path=/WebUntis',
      "JSESSIONID=ABC123; Path=/WebUntis; Secure",
    ]),
    "srv.webuntis.com",
  );
  assert.equal(jar.getCookieString("srv.webuntis.com"), "tok=YWJj==; schoolname=_bXlzY2hvb2w=; JSESSIONID=ABC123");
});

test("cookieJar skips cookies without a name or value and keeps domains apart", () => {
  const jar = new CookieJar();
  jar.setCookies(headersWithCookies(["empty=; Path=/", "=nameless", "novalue", 'quoted=""', "a=1"]), "one");
  jar.setCookies(headersWithCookies(["b=2"]), "two");
  assert.equal(jar.getCookieString("one"), "a=1");
  assert.equal(jar.getCookieString("two"), "b=2");

  // A later Set-Cookie replaces the value of the same name.
  jar.setCookies(headersWithCookies(["a=3=4"]), "one");
  assert.equal(jar.getCookieString("one"), "a=3=4");

  // Responses without getSetCookie (or without cookies) change nothing.
  jar.setCookies({}, "one");
  assert.equal(jar.getCookieString("one"), "a=3=4");
});

// A server that sends status and headers, then never finishes the body.
async function withStallingServer(fn) {
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json" });
    res.write('{"partial":');
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    await fn(url);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const [label, call] of [
  ["get", (url) => fetchClient.get(url, { timeout: 200 })],
  ["post", (url) => fetchClient.post(url, { user: "x" }, { timeout: 200 })],
  ["request", (url) => fetchClient.request({ url, method: "POST", data: { a: 1 }, timeout: 200 })],
]) {
  test(`fetchClient.${label} times out while the body stalls`, { timeout: 5000 }, async () => {
    await withStallingServer(async (url) => {
      const started = Date.now();
      await assert.rejects(call(url), (err) => {
        assert.equal(err.code, "ETIMEDOUT");
        return true;
      });
      assert.ok(Date.now() - started < 5000, "gave up after its timeout, not when the server did");
    });
  });
}

test("a request after a timed-out one runs normally", { timeout: 5000 }, async () => {
  await withStallingServer(async (url) => {
    await assert.rejects(fetchClient.get(url, { timeout: 100 }));
  });
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await fetchClient.get(`http://127.0.0.1:${server.address().port}/`, { timeout: 1000 });
    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.status, 200);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
