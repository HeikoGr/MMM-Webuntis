/**
 * Commit message rules (Conventional Commits).
 *
 * The types below are the ones release-please maps to changelog sections in
 * release-please-config.json - keep both lists in sync when adding a type.
 *
 * Bypass for a single commit: `SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // user-visible behavior added
        'fix', // user-visible defect corrected
        'perf', // faster or lighter, same behavior
        'refactor', // internal restructuring, same behavior
        'docs', // documentation only
        'test', // tests only
        'build', // dependencies, packaging, devcontainer
        'ci', // workflows and automation
        'chore', // housekeeping that touches no runtime source
        'revert',
      ],
    ],
    // Long enough to describe the change, short enough to stay readable in `git log --oneline`.
    'header-max-length': [2, 'always', 100],
    // Bodies wrap at the same width the rest of the repo uses.
    'body-max-line-length': [1, 'always', 140],
  },
};
