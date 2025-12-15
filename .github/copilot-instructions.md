# GitHub Copilot repository instructions (strict)

## Scope and safety

- Only change code and files inside this repository.
- Keep changes minimal and directly related to the request/issue.
- Do not introduce new dependencies unless explicitly required; if you do, update `package.json` (and existing lockfiles).
- Never commit secrets (tokens, API keys, QR codes containing credentials, personal data).

## MagicMirror module conventions

- Preserve the standard MagicMirror module structure and naming (e.g., `MMM-*.js`, `node_helper.js`, `translations/`, `*.css`).
- Keep the public module API stable (`Module.register`, notification handling, config schema) unless the request requires a breaking change.
- Keep widgets and CLI behavior backward compatible unless explicitly requested.

## Quality bar

- Follow the repository’s existing ESLint/Prettier configuration.
- Avoid broad refactors “for cleanliness”; do focused edits.
- Run `npm run lint`/`npm test` (or at least a smoke test) before finishing larger changes so regressions surface early.
- Align config/CLI changes with the matching templates and translations (`config.template.js`, `translations/*.json`, `custom.template.css` etc.) to avoid drift.

## References

- GitHub Copilot repository instructions: https://docs.github.com/de/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- MagicMirror² documentation: https://docs.magicmirror.builders/
- MagicMirror² module development: https://docs.magicmirror.builders/development/module-development.html
- MagicMirror² configuration reference: https://docs.magicmirror.builders/configuration/introduction.html
- Node.js documentation: https://nodejs.org/en/docs
- npm CLI documentation: https://docs.npmjs.com/cli/
- WebUntis (vendor site): https://www.untis.at/
- WebUntis js library used: https://webuntis.noim.me/
