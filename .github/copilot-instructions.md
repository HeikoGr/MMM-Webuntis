# GitHub Copilot repository instructions (strict)

## Project overview

MMM-Webuntis is a MagicMirror² module that displays timetable, exams, homework, and absences from WebUntis for configured students. It uses a node helper for backend API communication and provides multiple widget views (list, grid, exams, homework, absences, messages of day).

## Scope and safety

- Only change code and files inside this repository.
- Keep changes minimal and directly related to the request/issue.
- Do not introduce new dependencies unless explicitly required; if you do, update `package.json` (and existing lockfiles).
- Never commit secrets (tokens, API keys, QR codes containing credentials, personal data).

## MagicMirror module conventions

- Preserve the standard MagicMirror module structure and naming (e.g., `MMM-*.js`, `node_helper.js`, `translations/`, `*.css`).
- Keep the public module API stable (`Module.register`, notification handling, config schema) unless the request requires a breaking change.
- Keep widgets and CLI behavior backward compatible unless explicitly requested.

## File organization

- `MMM-Webuntis.js` - Main module file (frontend, uses MagicMirror Module API)
- `node_helper.js` - Backend helper for WebUntis API communication
- `widgets/*.js` - Individual widget renderers (grid, lessons, exams, homework, absences, messagesofday, util)
- `config/*.template.*` - Template files for configuration and styling (do not modify user copies)
- `translations/*.json` - Internationalization files (currently: de, en)
- `cli/cli.js` - Interactive CLI tool for testing configuration

## Quality bar

- Follow the repository’s existing ESLint/Prettier configuration.
- Avoid broad refactors “for cleanliness”; do focused edits.
- Run `node --run lint`/`npm test` (or at least a smoke test) before finishing larger changes so regressions surface early.
- Align config/CLI changes with the matching templates and translations (`config.template.js`, `translations/*.json`, `custom.template.css` etc.) to avoid drift.

## How to build and test

- **Lint code**: `node --run lint` (or `node --run lint:fix` to auto-fix)
- **Test**: `npm test` (runs linting)
- **Spell check**: `node --run  test:spelling`
- **Test configuration**: `node --run check` (interactive CLI tool)

## Code Review Guidelines

### Review Philosophy

- Only comment when you have HIGH CONFIDENCE (>80%) that an issue exists
- Be concise: one sentence per comment when possible
- Focus on actionable feedback, not observations
- When reviewing text, only comment on clarity issues if the text is genuinely confusing or could lead to errors. "Could be clearer" is not the same as "is confusing" - stay silent unless HIGH confidence it will cause problems

### Priority Areas (Review These)

#### Security & Safety

- Unsafe code blocks without justification
- Command injection risks (shell commands, user input)
- Path traversal vulnerabilities
- Credential exposure or hardcoded secrets
- Missing input validation on external data
- Improper error handling that could leak sensitive info

#### Correctness Issues

- Logic errors that could cause panics or incorrect behavior
- Race conditions in async code
- Resource leaks (files, connections, memory)
- Off-by-one errors or boundary conditions
- Incorrect error propagation
- Optional types that don't need to be optional
- Booleans that should default to false but are set as optional
- Error context that doesn't add useful information
- Overly defensive code that adds unnecessary checks
- Unnecessary comments that just restate what the code already shows (remove them)

#### Architecture & Patterns

- Code that violates existing patterns in the codebase
- Missing error handling
- Async/await misuse or blocking operations in async contexts

### Response Format

When you identify an issue:
1. **State the problem** (1 sentence)
2. **Why it matters** (1 sentence, only if not obvious)
3. **Suggested fix** (code snippet or specific action)

### When to Stay Silent

If you're uncertain whether something is an issue, don't comment. False positives create noise and reduce trust in the review process.

## References

- GitHub Copilot repository instructions: https://docs.github.com/de/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- MagicMirror² documentation: https://docs.magicmirror.builders/
- MagicMirror² module development: https://docs.magicmirror.builders/development/module-development.html
- MagicMirror² configuration reference: https://docs.magicmirror.builders/configuration/introduction.html
- Node.js documentation: https://nodejs.org/en/docs
- npm CLI documentation: https://docs.npmjs.com/cli/
- WebUntis (vendor site): https://www.untis.at/
- WebUntis js library used: https://webuntis.noim.me/