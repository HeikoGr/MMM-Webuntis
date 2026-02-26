#!/bin/sh

set -eu

MAGICMIRROR_PATH="/opt/magic_mirror"
MAGICMIRROR_REPO_URL="${MAGICMIRROR_REPO_URL:-https://github.com/MagicMirrorOrg/MagicMirror.git}"
MAGICMIRROR_REPO_REF="${MAGICMIRROR_REPO_REF:-master}"
MAGICMIRROR_INSTALL="${INSTALL_MAGICMIRROR:-1}"

if [ "$MAGICMIRROR_INSTALL" = "0" ]; then
  echo "Skipping MagicMirror bootstrap (INSTALL_MAGICMIRROR=0)"
  exit 0
fi

mkdir -p "$MAGICMIRROR_PATH"

if [ ! -d "$MAGICMIRROR_PATH/.git" ]; then
  echo "Cloning MagicMirror (${MAGICMIRROR_REPO_REF})..."
  # We use init + fetch + switch so it works even if the directory is not empty
  # (e.g. if a module is already mounted inside it)
  cd "$MAGICMIRROR_PATH"
  git init
  git remote add origin "$MAGICMIRROR_REPO_URL"
  git fetch --depth=1 origin "$MAGICMIRROR_REPO_REF"
  git switch --detach FETCH_HEAD
else
  echo "MagicMirror repository already present at $MAGICMIRROR_PATH"
fi

if [ ! -d "$MAGICMIRROR_PATH/node_modules" ] || [ -z "$(ls -A "$MAGICMIRROR_PATH/node_modules" 2>/dev/null)" ]; then
  echo "Installing MagicMirror npm dependencies..."
  npm --prefix "$MAGICMIRROR_PATH" install --omit=dev
else
  echo "MagicMirror dependencies already installed"
fi
