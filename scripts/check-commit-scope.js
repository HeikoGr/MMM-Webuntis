#!/usr/bin/env node
/**
 * Guard against PR types that understate what the PR actually changes.
 *
 * Why this exists: check-commit-msg.js only validates the *format* of a PR title, not whether the
 * chosen type matches what the diff actually does. A PR typed `chore` but containing a real
 * behavior fix in runtime source still passes the format check - and because the type is low-signal,
 * release-please files it under Maintenance instead of Fixes, and the version bump misses it.
 *
 * So: if a low-signal type touches runtime source, ask for a better type.
 *
 * Usage: TITLE="chore: x" node scripts/check-commit-scope.js <base-sha> <head-sha>
 * Deliberate exception: put `[allow-scope-mismatch]` in the PR title.
 */

const { execFileSync } = require("node:child_process");

// Types that promise "nothing user-visible changed".
const LOW_SIGNAL_TYPES = new Set(["chore", "docs", "style", "ci", "build", "test"]);

// Paths whose content ends up running on a user's mirror.
const RUNTIME_PATHS = [
  /^lib\//,
  /^plugins\//,
  /^translations\//,
  /^node_helper\.js$/,
  /^MMM-Webuntis\.js$/,
  /^MMM-Webuntis\.css$/,
];

// Carve-outs inside those trees that are not runtime behavior. The submodule shows up in the
// staged list as the bare `lib/mmm-shared`, without a trailing slash.
const RUNTIME_EXCEPTIONS = [/^lib\/mmm-shared(\/|$)/, /\/README\.md$/, /\.md$/];

function isRuntimePath(file) {
  if (RUNTIME_EXCEPTIONS.some((pattern) => pattern.test(file))) return false;
  return RUNTIME_PATHS.some((pattern) => pattern.test(file));
}

function getChangedFiles(base, head) {
  try {
    return execFileSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Count changed lines that are not pure formatting.
 *
 * A dependency bump followed by `lint:fix` legitimately reformats runtime files under a `chore`
 * type. Comparing with whitespace ignored keeps those out of the way, so the guard fires on
 * changes that actually alter code.
 *
 * @param {string} base - Base revision
 * @param {string} head - Head revision
 * @param {string[]} files - Changed runtime files
 * @returns {number} Number of substantive added/removed lines
 */
function countSubstantiveChanges(base, head, files) {
  try {
    const diff = execFileSync(
      "git",
      ["diff", "--ignore-all-space", "--ignore-blank-lines", "--unified=0", `${base}...${head}`, "--", ...files],
      {
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    return diff
      .split("\n")
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
      .filter((line) => {
        const content = line.slice(1).trim();
        if (!content) return false;
        // Comment-only churn is not behavior either.
        return !(content.startsWith("//") || content.startsWith("*") || content.startsWith("/*"));
      }).length;
  } catch {
    // If the diff cannot be read, do not block the PR.
    return 0;
  }
}

function main() {
  const [base, head] = process.argv.slice(2);
  const title = (process.env.TITLE ?? "").split("\n")[0].trim();
  if (!base || !head || /\[allow-scope-mismatch\]/.test(title)) return;

  const match = title.match(/^([a-z]+)(\([^)]*\))?(!)?:/);
  if (!match) return; // check-commit-msg.js reports malformed titles; not this guard's job.

  const [, type, , breaking] = match;
  if (breaking || !LOW_SIGNAL_TYPES.has(type)) return;

  const runtimeFiles = getChangedFiles(base, head).filter(isRuntimePath);
  if (runtimeFiles.length === 0) return;

  const substantiveChanges = countSubstantiveChanges(base, head, runtimeFiles);
  if (substantiveChanges === 0) return; // formatting/comments only - fine under any type.

  const shown = runtimeFiles.slice(0, 8);
  const more = runtimeFiles.length - shown.length;

  console.error(`
✖ PR type "${type}" changes runtime source.

  ${substantiveChanges} non-formatting line(s) in:
${shown.map((file) => `    - ${file}`).join("\n")}${more > 0 ? `\n    ... and ${more} more` : ""}

  "${type}" tells the changelog that nothing user-visible changed, so this PR would be
  released silently. If the behavior really did change, use "feat" or "fix" instead.

  If the change is genuinely invisible to users, pick "refactor" or "perf" - both keep the
  runtime-source signal without promising a new feature or a bugfix.

  Deliberate exception:
    add [allow-scope-mismatch] to the PR title
`);
  process.exit(1);
}

main();
