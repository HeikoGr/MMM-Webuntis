# Development Container

This devcontainer provides a complete development environment for MMM-Webuntis.

## Installed Tools

### Base Image
- Shared base image: `ghcr.io/heikogr/mmm-devcontainer-base:node24-trixie-slim`
- Node.js 24
- MagicMirror² preinstalled at `/opt/magic_mirror`
- Playwright, `playwright-mcp`, and Chrome preinstalled in the image

### APT Packages (Dockerfile)
- Shared image provides common tooling such as `git`, `curl`, `ripgrep`, `python3`, `jq`, `httpie`, `build-essential`, `pm2`, Playwright, and MagicMirror².
- This repo-specific Dockerfile only adds `procps`, `htop`, and `netcat-openbsd`.

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

See [CLI_COMPREHENSIVE_GUIDE.md](../docs/CLI_COMPREHENSIVE_GUIDE.md) for detailed command usage.

**Quick reference:**
- `node --run check` - Test config, auth, and data fetching
- `node --run lint` - Check code style
- `pm2 logs --lines 200` - View PM2 logs
- `http GET https://arche.webuntis.com/...` - Test REST API with HTTPie
