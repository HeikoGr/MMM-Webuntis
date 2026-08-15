# Development Container

This devcontainer provides a complete development environment for MMM-Webuntis.

## Installed Tools

### Base Image
- Shared base image: `ghcr.io/heikogr/mmm-devcontainer-base:node24-trixie-slim`
- Node.js 24
- MagicMirror² preinstalled at `/opt/magic_mirror`
- Playwright, `playwright-mcp`, and Chrome preinstalled in the image

### Packages (Dockerfile)
- Shared image provides common tooling such as `git`, `curl`, `wget`, `gpg`, `ripgrep`, `python3`, `jq`, `httpie`, `build-essential`, `pm2`, `gh` (GitHub CLI), Playwright, and MagicMirror².
- This repo-specific Dockerfile only adds `npm-check-updates` (`ncu`) via npm.

### GitHub CLI

`gh` picks up the `GITHUB_TOKEN` that Codespaces/devcontainer injects, so `gh auth login` is not
needed:

```bash
gh auth status          # -> Logged in to github.com account <you> (GITHUB_TOKEN)
gh pr create --fill
gh run list --limit 5
gh run watch
```

That token belongs to a GitHub App installation, not to your account directly. It can read and
write repository content, pull requests, and workflow runs, but **cannot administer the repository**:

```bash
gh api repos/:owner/:repo/branches/master/protection
# 403 Resource not accessible by integration
```

Branch protection, rulesets, and other admin calls need a personal access token instead
(classic scope `repo`, or fine-grained `Administration: Read and write`):

```bash
GH_TOKEN=<your PAT> gh api --method PUT repos/:owner/:repo/branches/master/protection --input -
```

### Timezone

The base image runs in `Europe/Berlin` (`ENV TZ` plus `/etc/localtime`), since the base image
defaults to UTC otherwise, which is a poor fit for a timetable module: the mirror marks the wrong
lesson as current, and between 00:00 and 02:00 local time it still shows the previous day.

Override per container in `devcontainer.json` if needed:

```jsonc
"containerEnv": { "TZ": "Europe/Vienna" }
```

The module's own `timezone` config option is independent of this and stays authoritative for the
school's clock: `getCurrentDateContext()` resolves it via `Intl`, so a mirror in a different zone
than its school still renders the school's wall clock. CI runs the unit tests under both `UTC` and
`Europe/Berlin` to keep it that way.

### MagicMirror Modules In The Shared Image
- `MMM-Cursor`
- `MMM-Carousel`
- `MMM-KeyBindings`

## Environment Variables

Configured in `devcontainer.json`:
- `PLAYWRIGHT_CHROMIUM_ARGS=--no-sandbox --disable-dev-shm-usage --disable-gpu`
- `ENABLE_PLAYWRIGHT_MCP=1` - Set to `0` to disable Playwright MCP server

## Lifecycle Scripts

1. **postCreateCommand** (`postCreate.sh`):
   - Installs module dependencies if `node_modules` are still missing
   - Prepares `/tmp/playwright-mcp`

2. **postStartCommand**:
   - Starts Playwright MCP server on port 8931 (if enabled)
   - MagicMirror available at http://localhost:8080

3. **entrypoint.sh**:
   - Creates config symlinks into `/opt/magic_mirror`
   - Loads `.env`
   - Installs missing module-local dependencies
   - Starts MagicMirror via `pm2-runtime`

## Tool Rationale

### Why in Dockerfile?
The repo-local Dockerfile should stay thin and only contain Webuntis-specific additions on top of the shared base image.

### Why in postCreate.sh?
Only lightweight workspace initialization remains there. Heavy shared tooling belongs in the shared base image.

## Rebuilding

After changing `Dockerfile`:
```bash
# Rebuild the devcontainer image
docker build -f .devcontainer/Dockerfile -t mmm-webuntis-devcontainer .devcontainer
# OR in VS Code: Command Palette -> "Dev Containers: Rebuild Container"
```

After changing `postCreate.sh`:
```bash
# Run the workspace initialization manually
/bin/sh .devcontainer/postCreate.sh
```

## Common Commands

See [CLI.md](CLI.md) for detailed command usage.

**Quick reference:**
- `node --run check` - Test config, auth, and data fetching
- `node --run lint` - Check code style
- `pm2 logs --lines 200` - View PM2 logs
- `http GET https://arche.webuntis.com/...` - Test REST API with HTTPie
