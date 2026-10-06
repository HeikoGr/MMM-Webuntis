const assert = require("node:assert/strict");
const test = require("node:test");
const { lintMessage } = require("../scripts/check-commit-msg");

function ruleNames(message, options) {
  return lintMessage(message, options)
    .problems.map((problem) => `${problem.level}:${problem.name}`)
    .sort();
}

test("check-commit-msg accepts well-formed Conventional Commits", () => {
  for (const message of [
    "feat: add a thing",
    "fix(config): keep the default when the value is empty",
    "feat(config)!: require an api key\n\nBREAKING CHANGE: set apiKey in config.js",
    "docs: explain `Foo` handling",
    "fix: handle 3 states...",
    "fix: x\n\nbody\n\nCo-Authored-By: Someone <someone@example.com>",
  ]) {
    assert.deepEqual(ruleNames(message), [], message);
  }
});

test("check-commit-msg rejects headers that break the format", () => {
  assert.deepEqual(ruleNames("wip: add x"), ["2:type-enum"]);
  assert.deepEqual(ruleNames("Feat: add x"), ["2:type-case", "2:type-enum"]);
  assert.deepEqual(ruleNames("feat: Add x"), ["2:subject-case"]);
  assert.deepEqual(ruleNames("feat: add x."), ["2:subject-full-stop"]);
  assert.deepEqual(ruleNames("add x"), ["2:subject-empty", "2:type-empty"]);
  assert.deepEqual(ruleNames("feat:add x"), ["2:subject-empty", "2:type-empty"]);
  assert.deepEqual(ruleNames(` feat: ${"a".repeat(100)}`), [
    "2:header-max-length",
    "2:header-trim",
    "2:subject-empty",
    "2:type-empty",
  ]);
});

test("check-commit-msg applies the body and footer rules", () => {
  assert.deepEqual(ruleNames("fix: x\nbody right below"), ["1:body-leading-blank"]);
  assert.deepEqual(ruleNames(`fix: x\n\n${"b".repeat(141)}`), ["1:body-max-line-length"]);
  assert.deepEqual(ruleNames(`fix: x\n\nsee https://example.com/${"u".repeat(200)}`), []);
  assert.deepEqual(ruleNames(`fix: x\n\nRefs: ${"r".repeat(100)}`), ["2:footer-max-line-length"]);
  assert.deepEqual(ruleNames("fix: x\n\nbody\nCloses #12"), ["1:footer-leading-blank"]);
});

test("check-commit-msg skips messages git and GitHub generate", () => {
  for (const message of [
    "Merge branch 'develop' into main",
    "Merge pull request #3 from someone/branch",
    'Revert "feat: add x"',
    "fixup! feat: add x",
    "chore(release): 1.2.3",
  ]) {
    assert.equal(lintMessage(message).ignored, true, message);
  }
});

test('check-commit-msg treats a "#" line as content', () => {
  // A squash message may carry a Markdown heading.
  assert.deepEqual(ruleNames(`fix: x\n\n# ${"h".repeat(150)}`), ["1:body-max-line-length"]);
});
