# Commit message instructions

Write the commit message as a Conventional Commit. The repository enforces these rules with
commitlint and `scripts/check-commit-scope.js`, so a message that ignores them is rejected by the
`commit-msg` hook.

## Format

```
type(scope): subject

body

footer
```

- `type` is required and must come from the list below.
- `scope` is optional. Use it when the change is confined to one area, omit it for repo-wide
  changes. Never invent a scope that is not in the list.
- `subject` is required: imperative mood ("add", not "added" or "adds"), lowercase first letter,
  no trailing period.
- The whole first line must be at most 100 characters.
- Leave one blank line before the body and before the footer.
- Wrap body lines at 140 characters.

## Types

| Type       | Use when                                                        |
| ---------- | --------------------------------------------------------------- |
| `feat`     | user-visible behavior was added                                   |
| `fix`      | a user-visible defect was corrected                               |
| `perf`     | same behavior, but faster or lighter                              |
| `refactor` | internal restructuring with no behavior change                    |
| `docs`     | documentation only                                                |
| `test`     | tests only                                                        |
| `build`    | dependencies, packaging, devcontainer                             |
| `ci`       | workflows and automation                                          |
| `chore`    | housekeeping that touches no runtime source                       |
| `revert`   | reverting an earlier commit                                       |

## Choosing the type from the diff

`chore`, `docs`, `style`, `ci`, `build` and `test` promise that nothing user-visible changed. They
are rejected when the diff contains non-formatting changes to runtime source:

- `lib/` (except `lib/mmm-shared/`), `plugins/`, `translations/`
- `node_helper.js`, `MMM-Webuntis.js`, `MMM-Webuntis.css`

If the diff changes those files, pick `feat` or `fix` when the behavior changed, or `refactor` or
`perf` when it genuinely did not. Markdown files inside those trees do not count as runtime source.

Judge the type from what the code actually does after the change, not from which files were
touched. A dependency bump that also fixes a bug is a `fix`, not a `build`.

## Scopes

`grid`, `lessons`, `exams`, `homework`, `absences`, `messagesofday`, `auth`, `api`, `config`,
`plugins`, `cli`, `deps`, `node_helper`, `i18n`, `demo`, `devcontainer`

## Subject content

Describe the effect of the change, not the editing process. The reader wants to know what is
different now.

- Good: `fix(cli): stop mistaking flag values for the positional config path`
- Bad: `fix(cli): update node_helper_wrapper.js`
- Bad: `fix(cli): various fixes and improvements`

Do not enumerate the changed files, do not mention line counts, and do not write "update X, update
Y, update Z". One commit describes one change; summarize it in a single clause.

## Body

Add a body only when the subject leaves an obvious question open. Explain **why** the change was
made and what the previous behavior was — the diff already shows what changed. Skip the body for
self-explanatory changes such as dependency bumps.

## Breaking changes

Mark them with `!` after the type or scope and add a `BREAKING CHANGE:` footer explaining what
users must do:

```
feat(config)!: require an explicit students array

BREAKING CHANGE: the top-level `username`/`password` keys are gone. Move each login into an entry
of the `students` array.
```

## Examples from this repository

```
fix(node_helper): release stale session state and back off from failing endpoints
refactor(plugins): move duplicated frontend helpers into frontendShared
feat(demo): build the demo plugin registry from plugin manifests
fix(i18n): use literal umlauts in the German absences translation
build(devcontainer): install the GitHub CLI
docs: correct architecture, plugin and changelog documentation
```
