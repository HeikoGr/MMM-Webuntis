#!/bin/sh
#
# Runs on every container start (postStartCommand).
#
# The blocks below copy host credentials *out of read-only bind mounts* into the
# container's own HOME instead of mounting them writable. The container runs as root
# while the host files belong to uid 1000, so a writable mount would leave root-owned
# files behind in the host's ~/.ssh, ~/.claude and ~/.gitconfig.

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

# --- Git identity -----------------------------------------------------------
# Until now this was left entirely to VS Code (dev.containers.copyGitConfig).
# That copy is absent whenever the container is started without VS Code, and it
# has been observed to drop the [user] section when a second window attaches to a
# running container - `git commit` then dies with "Please tell me who you are".
# So fill name and email in from the mounted host config whenever they are empty.
# Single values are merged in rather than the file being copied, so VS Code's own
# credential-helper entry in /root/.gitconfig survives.
#
# Deliberately NOT inherited: the host's url."https://github.com/".insteadOf
# rewrite. Inside the container git authenticates with the SSH key copied above,
# so the git@github.com: remotes must stay SSH.
if [ -f /tmp/host-gitconfig ]; then
  for key in user.name user.email; do
    current="$(git config --global --get "$key" 2>/dev/null || true)"
    if [ -z "$current" ]; then
      value="$(git config --file /tmp/host-gitconfig --get "$key" 2>/dev/null || true)"
      if [ -n "$value" ]; then
        git config --global "$key" "$value"
      fi
    fi
  done
fi

if [ -n "$(git config --global --get user.email 2>/dev/null || true)" ]; then
  echo "✓ Git identity: $(git config --global --get user.name 2>/dev/null || true) <$(git config --global --get user.email)>"
else
  echo "· No git identity - commits will fail; run: git config --global user.email <you>"
fi

echo "Devcontainer started. MagicMirror at http://localhost:8080"
echo "Playwright MCP: .mcp.json (Claude Code) and .vscode/mcp.json (Copilot Chat)"
