#!/usr/bin/env node
/**
 * Conventional Commits check for PR titles.
 *
 * Replaces commitlint with @commitlint/config-conventional: same rules, same levels, same
 * messages that are exempt (merges, reverts, fixup!), without its ~80 packages. A PR is squash-merged
 * and its title becomes the commit release-please reads, so the title is the only message checked.
 * Whether the type matches what the diff touches is a separate question, answered by
 * check-commit-scope.js.
 *
 * The types below are the ones release-please maps to changelog sections in
 * release-please-config.json - keep both lists in sync when adding a type.
 *
 * Usage: printf '%s\n' "$TITLE" | node scripts/check-commit-msg.js --stdin
 */

const fs = require("node:fs");

const TYPES = [
  "feat", // user-visible behavior added
  "fix", // user-visible defect corrected
  "perf", // faster or lighter, same behavior
  "refactor", // internal restructuring, same behavior
  "docs", // documentation only
  "test", // tests only
  "build", // dependencies, packaging, devcontainer
  "ci", // workflows and automation
  "chore", // housekeeping that touches no runtime source
  "revert",
];

// Long enough to describe the change, short enough to stay readable in `git log --oneline`.
const HEADER_MAX_LENGTH = 100;
// Bodies wrap at the same width the rest of the repo uses.
const BODY_MAX_LINE_LENGTH = 140;
const FOOTER_MAX_LINE_LENGTH = 100;

const ERROR = 2;
const WARNING = 1;

const HEADER_PATTERN = /^(\w*)(?:\((.*)\))?!?: (.*)$/;
// A footer starts at the first git-trailer-like line after the header ("Token: value",
// "Token #123", "BREAKING CHANGE: ..."); everything from there on belongs to it.
const FOOTER_TOKEN_PATTERN = /^(?:BREAKING CHANGE|[\w-]+)(?::\s+|\s+#).+/i;
const NOTE_PATTERN = /^(?:\*\s+)?(?:BREAKING CHANGE|BREAKING-CHANGE):\s*/i;
// Long lines that carry a URL are exempt from the line-length rules.
const URL_PATTERN = /\bhttps?:\/\/\S+/;

// Messages git or GitHub generate, which are not held to the format.
const IGNORED_PATTERNS = [
  /^((Merge pull request)|(Merge (.*?) into (.*?)|(Merge branch (.*?)))(?:\r?\n)*$)/m,
  /^(Merge tag (.*?))(?:\r?\n)*$/m,
  /^(R|r)evert (.*)/,
  /^(R|r)eapply (.*)/,
  /^(amend|fixup|squash)!/,
  /^(Merged (.*?)(in|into) (.*)|Merged PR (.*): (.*))/,
  /^Merge remote-tracking branch(\s*)(.*)/,
  /^Automatic merge(.*)/,
  /^Auto-merged (.*?) into (.*)/,
];
const SEMVER_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Version-only headers such as "1.2.3" or "chore: v1.2.3" (release tooling).
 *
 * @param {string} message - Raw commit message
 * @returns {boolean} True when the header is just a version
 */
function isVersionHeader(message) {
  const header = message
    .split("\n")[0]
    .replace(/^chore(\([^)]+\))?:/, "")
    .replace(/\[(skip|ci)(-|\s)(ci|skip)\]/i, "")
    .replace(/\((skip|ci)(-|\s)(ci|skip)\)/i, "")
    .trim();
  return SEMVER_PATTERN.test(header);
}

/**
 * The message split into lines, surrounding blank lines trimmed.
 *
 * @param {string} raw - Message
 * @returns {string[]} Lines of the message
 */
function cleanLines(raw) {
  const kept = String(raw).split(/\r?\n/);
  while (kept.length && !kept[0].trim()) kept.shift();
  while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
  return kept;
}

function exceedsLineLength(lines, max) {
  return lines.some((line) => line.length > max && !URL_PATTERN.test(line));
}

/**
 * Check one PR title (or commit message).
 *
 * @param {string} raw - Message
 * @returns {{ ignored: boolean, problems: Array<{ level: number, name: string, message: string }> }}
 */
function lintMessage(raw) {
  const lines = cleanLines(raw);
  const message = lines.join("\n");
  const problems = [];
  const report = (level, name, text) => problems.push({ level, name, message: text });

  // git refuses an empty message on its own.
  if (!message) {
    return { ignored: false, problems };
  }

  if (IGNORED_PATTERNS.some((pattern) => pattern.test(message)) || isVersionHeader(message)) {
    return { ignored: true, problems };
  }

  const header = lines[0] ?? "";
  const match = header.match(HEADER_PATTERN);
  const [, type = "", , subject = ""] = match ?? [];

  if (header !== header.trim()) {
    report(ERROR, "header-trim", "header must not be surrounded by whitespace");
  }
  if (header.length > HEADER_MAX_LENGTH) {
    report(
      ERROR,
      "header-max-length",
      `header must not be longer than ${HEADER_MAX_LENGTH} characters, current length is ${header.length}`,
    );
  }

  if (!subject) {
    report(ERROR, "subject-empty", "subject may not be empty");
  } else {
    // Mirrors commitlint's "never sentence-case, start-case, pascal-case, upper-case": all four
    // come down to a subject that starts with a capital letter.
    if (/^[\p{Lu}\p{Lt}]/u.test(subject)) {
      report(ERROR, "subject-case", "subject must not be sentence-case, start-case, pascal-case, upper-case");
    }
  }
  // Checked on the whole header, so a malformed one ending in "." is reported too; "..." is fine.
  if (header.endsWith(".") && !header.endsWith("...") && !header.endsWith(":")) {
    report(ERROR, "subject-full-stop", "subject may not end with full stop");
  }

  if (!type) {
    report(ERROR, "type-empty", "type may not be empty");
  } else {
    if (type !== type.toLowerCase()) {
      report(ERROR, "type-case", "type must be lower-case");
    }
    if (!TYPES.includes(type)) {
      report(ERROR, "type-enum", `type must be one of [${TYPES.join(", ")}]`);
    }
  }

  const rest = lines.slice(1);
  let footerStart = rest.findIndex((line) => FOOTER_TOKEN_PATTERN.test(line) || NOTE_PATTERN.test(line));
  if (footerStart === -1) footerStart = rest.length;
  const body = rest.slice(0, footerStart);
  const footer = rest.slice(footerStart);

  if (body.some((line) => line.trim())) {
    if (body[0] !== "") {
      report(WARNING, "body-leading-blank", "body must have leading blank line");
    }
    if (exceedsLineLength(body, BODY_MAX_LINE_LENGTH)) {
      report(
        WARNING,
        "body-max-line-length",
        `body's lines must not be longer than ${BODY_MAX_LINE_LENGTH} characters`,
      );
    }
  }

  if (footer.length) {
    if (footerStart === 0 || rest[footerStart - 1] !== "") {
      report(WARNING, "footer-leading-blank", "footer must have leading blank line");
    }
    if (exceedsLineLength(footer, FOOTER_MAX_LINE_LENGTH)) {
      report(
        ERROR,
        "footer-max-line-length",
        `footer's lines must not be longer than ${FOOTER_MAX_LINE_LENGTH} characters`,
      );
    }
  }

  return { ignored: false, problems };
}

function main() {
  if (!process.argv.includes("--stdin")) {
    console.error("Usage: printf '%s\\n' \"$TITLE\" | node scripts/check-commit-msg.js --stdin");
    process.exit(2);
  }

  const message = fs.readFileSync(0, "utf8");
  const { ignored, problems } = lintMessage(message);
  if (ignored || problems.length === 0) return;

  console.error(`⧗ input: ${cleanLines(message)[0] ?? ""}`);
  for (const problem of problems) {
    console.error(`${problem.level === ERROR ? "✖" : "⚠"}   ${problem.message} [${problem.name}]`);
  }
  console.error("");

  const errors = problems.filter((problem) => problem.level === ERROR).length;
  if (errors > 0) {
    console.error(`✖ ${errors} problem(s) found. Format: type(scope): subject - see .github/commit-instructions.md`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { lintMessage, TYPES };
