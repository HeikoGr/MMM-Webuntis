#!/usr/bin/env node
/**
 * Guard against commit types that understate what the commit actually changes.
 *
 * Why this exists: `0.7.14` shipped as "chore: update biome schema version to 2.5.0" but also
 * contained a real behavior fix (`lessons.nextDays: 0` was treated as "not configured" and the
 * widget was silently skipped). commitlint accepted it - the *format* was fine. Because the type
 * was `chore`, the change never reached the changelog and had to be reconstructed from diffs
 * months later.
 *
 * So: if a low-signal commit type touches runtime source, ask for a better type.
 *
 * Usage: node scripts/check-commit-scope.js <commit-msg-file>
 */

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

// Types that promise "nothing user-visible changed".
const LOW_SIGNAL_TYPES = new Set(['chore', 'docs', 'style', 'ci', 'build', 'test']);

// Paths whose content ends up running on a user's mirror.
const RUNTIME_PATHS = [/^lib\//, /^plugins\//, /^translations\//, /^node_helper\.js$/, /^MMM-Webuntis\.js$/, /^MMM-Webuntis\.css$/];

// Carve-outs inside those trees that are not runtime behavior.
const RUNTIME_EXCEPTIONS = [/^lib\/mmm-shared\//, /\/README\.md$/, /\.md$/];

function isRuntimePath(file) {
  if (RUNTIME_EXCEPTIONS.some((pattern) => pattern.test(file))) return false;
  return RUNTIME_PATHS.some((pattern) => pattern.test(file));
}

function getStagedFiles() {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
      .split('\n')
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
 * @param {string[]} files - Staged runtime files
 * @returns {number} Number of substantive added/removed lines
 */
function countSubstantiveChanges(files) {
  try {
    const diff = execFileSync('git', ['diff', '--cached', '--ignore-all-space', '--ignore-blank-lines', '--unified=0', '--', ...files], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });

    return diff
      .split('\n')
      .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---)/.test(line))
      .filter((line) => {
        const content = line.slice(1).trim();
        if (!content) return false;
        // Comment-only churn is not behavior either.
        return !(content.startsWith('//') || content.startsWith('*') || content.startsWith('/*'));
      }).length;
  } catch {
    // If the diff cannot be read, do not block the commit.
    return 0;
  }
}

function main() {
  if (process.env.WEBUNTIS_ALLOW_SCOPE_MISMATCH === '1') return;

  const messageFile = process.argv[2];
  if (!messageFile || !fs.existsSync(messageFile)) return;

  const subject = fs.readFileSync(messageFile, 'utf8').split('\n')[0].trim();
  const match = subject.match(/^([a-z]+)(\([^)]*\))?(!)?:/);
  if (!match) return; // commitlint reports malformed subjects; not this guard's job.

  const [, type, , breaking] = match;
  if (breaking || !LOW_SIGNAL_TYPES.has(type)) return;

  const runtimeFiles = getStagedFiles().filter(isRuntimePath);
  if (runtimeFiles.length === 0) return;

  const substantiveChanges = countSubstantiveChanges(runtimeFiles);
  if (substantiveChanges === 0) return; // formatting/comments only - fine under any type.

  const shown = runtimeFiles.slice(0, 8);
  const more = runtimeFiles.length - shown.length;

  console.error(`
✖ Commit type "${type}" changes runtime source.

  ${substantiveChanges} non-formatting line(s) in:
${shown.map((file) => `    - ${file}`).join('\n')}${more > 0 ? `\n    ... and ${more} more` : ''}

  "${type}" tells the changelog that nothing user-visible changed, so this commit would be
  released silently. If the behavior really did change, use "feat" or "fix" instead.

  If the change is genuinely invisible to users, pick "refactor" or "perf" - both keep the
  runtime-source signal without promising a new feature or a bugfix.

  Deliberate exception:
    WEBUNTIS_ALLOW_SCOPE_MISMATCH=1 git commit ...
`);
  process.exit(1);
}

main();
