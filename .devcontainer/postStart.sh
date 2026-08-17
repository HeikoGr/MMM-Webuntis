#!/bin/sh
#
# Runs on every container start (postStartCommand).
#
# Both blocks below copy host credentials *out of a read-only bind mount* into the
# container's own HOME instead of mounting them writable. The container runs as root
# while the host files belong to uid 1000, so a writable mount would leave root-owned
# files behind in the host's ~/.ssh and ~/.claude.

set -eu

mkdir -p /tmp/playwright-mcp

# --- Claude Code login ------------------------------------------------------
mkdir -p /root/.claude
if [ -f /tmp/host-claude/.credentials.json ]; then
  cp /tmp/host-claude/.credentials.json /root/.claude/.credentials.json
  chmod 600 /root/.claude/.credentials.json
  echo "✓ Claude Code credentials inherited from host"
else
  echo "· No host Claude Code credentials found - run: claude login"
fi

# --- Git over SSH -----------------------------------------------------------
# Needs openssh-client in the image; git only *recommends* it, so the base image
# installs it explicitly.
if [ -d /tmp/host-ssh ]; then
  mkdir -p /root/.ssh
  chmod 700 /root/.ssh
  # -L dereferences symlinks; some hosts keep keys behind links.
  cp -rL /tmp/host-ssh/. /root/.ssh/ 2>/dev/null || true
  find /root/.ssh -type f -exec chmod 600 {} +
  echo "✓ SSH keys inherited from host"
else
  echo "· No host SSH directory mounted - git over SSH will not authenticate"
fi

# GitHub's host keys, so a fetch does not stall on host verification.
if command -v ssh-keyscan >/dev/null 2>&1; then
  if ! grep -q "^github.com " /root/.ssh/known_hosts 2>/dev/null; then
    ssh-keyscan -t rsa,ecdsa,ed25519 github.com >> /root/.ssh/known_hosts 2>/dev/null || true
  fi
fi

echo "Devcontainer started. MagicMirror at http://localhost:8080"
echo "Playwright MCP: .mcp.json (Claude Code) and .vscode/mcp.json (Copilot Chat)"
