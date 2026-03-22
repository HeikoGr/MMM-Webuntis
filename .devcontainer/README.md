# Development Container

This devcontainer provides a complete development environment for MMM-Webuntis.

## Installed Tools

### Base Image
- **Node.js 22** (mcr.microsoft.com/devcontainers/javascript-node:22)
- MagicMirror² (bootstrapped automatically)

### APT Packages (Dockerfile)
- `git` - Version control
- `curl` / `wget` - HTTP utilities
- `python3` - Build dependencies
- `jq` - JSON parsing in shell scripts
- `httpie` - Modern REST API testing tool (better than curl for WebUntis API debugging)
- `procps` - Process tools including `watch` for monitoring
- `htop` - Interactive process viewer
- `netcat-openbsd` - Network debugging and port testing
- `build-essential` - Compiler toolchain (node-gyp dependencies)

### NPM Global Packages (Dockerfile)
- `pm2` - Process manager for MagicMirror²
- `prettier` - Code formatting
- `cspell` - Spell checker
- `jest` - Testing framework
- `diff-so-fancy` - Enhanced git diffs

### Playwright (postCreate.sh)
- **Chrome browser** - Installed via `npx playwright install chrome --with-deps`
- Controlled by `INSTALL_PLAYWRIGHT_BROWSERS` environment variable (default: `1`)
- Location: `/tmp/playwright-browsers` (see `PLAYWRIGHT_BROWSERS_PATH`)
- Used for frontend testing and Playwright MCP integration
- Playwright may print a generic `npx playwright install` warning during `postCreate.sh`; in this repo that is expected because the CLI is fetched on demand rather than installed as a project dependency

## Environment Variables

Configured in `devcontainer.json`:
- `PLAYWRIGHT_BROWSERS_PATH=/tmp/playwright-browsers`
- `PLAYWRIGHT_CHROMIUM_ARGS=--no-sandbox --disable-dev-shm-usage --disable-gpu`
- `INSTALL_PLAYWRIGHT_BROWSERS=1` - Set to `0` to skip browser installation
- `ENABLE_PLAYWRIGHT_MCP=1` - Set to `0` to disable Playwright MCP server

## Lifecycle Scripts

1. **postCreateCommand** (`postCreate.sh`):
   - Installs module dependencies (`npm install`)
   - Installs Playwright Chrome browser (if enabled)

2. **postStartCommand**:
   - Starts Playwright MCP server on port 8931 (if enabled)
   - MagicMirror available at http://localhost:8080

## Tool Rationale

### Why in Dockerfile?
Tools that are **always needed** and rarely change:
- Core build tools (git, curl, build-essential)
- Development utilities (jq, httpie, htop)
- NPM globals for linting/testing (jest, prettier, cspell)

### Why in postCreate.sh?
Tools that are:
- **Optional** (controllable via environment variables)
- **Large** (Playwright ~300MB)
- **Version-sensitive** (always installs latest Playwright)
- **Faster to rebuild** (no Docker image rebuild needed)

## Rebuilding

After changing `Dockerfile`:
```bash
# Rebuild container
docker compose build
# OR in Codespace: Command Palette → "Rebuild Container"
```

After changing `postCreate.sh`:
```bash
# Just run the script manually
/bin/sh .devcontainer/postCreate.sh
```

## Common Commands

See [CLI_COMPREHENSIVE_GUIDE.md](../docs/CLI_COMPREHENSIVE_GUIDE.md) for detailed command usage.

**Quick reference:**
- `node --run check` - Test config, auth, and data fetching
- `node --run lint` - Check code style
- `pm2 logs --lines 200` - View PM2 logs
- `http GET https://arche.webuntis.com/...` - Test REST API with HTTPie
