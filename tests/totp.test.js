const assert = require("node:assert/strict");
const test = require("node:test");
const { decodeBase32, generateTotp } = require("../lib/webuntis/totp");

// RFC 6238, appendix B: ASCII "12345678901234567890" as SHA1 key, 8-digit codes.
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const RFC_VECTORS = [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"],
];

test("generateTotp matches the RFC 6238 SHA1 test vectors", () => {
  for (const [seconds, expected] of RFC_VECTORS) {
    assert.equal(generateTotp(RFC_SECRET, { timestamp: seconds * 1000, digits: 8 }), expected);
  }
});

test("generateTotp defaults to 6 digits and 30-second steps", () => {
  assert.equal(generateTotp(RFC_SECRET, { timestamp: 59_000 }), "287082");
  // Same step, same code; next step, new code.
  assert.equal(generateTotp(RFC_SECRET, { timestamp: 30_000 }), "287082");
  assert.notEqual(generateTotp(RFC_SECRET, { timestamp: 60_000 }), "287082");
});

test("decodeBase32 ignores case, whitespace and padding, and rejects foreign characters", () => {
  assert.equal(decodeBase32("gezd gnbv\n").toString("ascii"), "12345");
  assert.equal(decodeBase32("GEZDGNBV===").toString("ascii"), "12345");
  assert.throws(() => decodeBase32("GEZ1"), /Invalid Base32 character "1"/);
});
