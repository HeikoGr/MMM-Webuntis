# Contributing

Short guide to contribute:

1. Open an issue

- Describe the problem, steps to reproduce and include logs if possible.

2. Develop locally

- `cd modules/MMM-Webuntis`
- `npm ci`
- `node --run lint` and `node --run test` (includes `node --run test:spelling`).

3. Create a PR

- Make a branch, commit clearly, and open a PR with testing steps.

4. Style

- Use ESLint and Prettier. Run `node --run lint:fix` to auto-fix style issues.

Thanks for contributing — we review PRs promptly.
