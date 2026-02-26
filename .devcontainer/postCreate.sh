#!/bin/sh

set -eu

MAGICMIRROR_PATH="/opt/magic_mirror"
MODULE_DIR="$(pwd)"
MODULE_NAME="$(basename "$MODULE_DIR")"

echo "Running postCreate setup for $MODULE_NAME..."

if command -v bootstrap-magicmirror.sh >/dev/null 2>&1; then
  bootstrap-magicmirror.sh
else
  echo "WARNING: bootstrap-magicmirror.sh not found; skipping MagicMirror setup"
fi

# Install module dependencies
if [ -f "$MODULE_DIR/package.json" ]; then
  echo "Installing $MODULE_NAME dependencies..."
  npm install || {
    echo "WARNING: npm install failed for $MODULE_NAME"
  }
fi

if [ "${INSTALL_PLAYWRIGHT_BROWSERS:-1}" = "1" ]; then
  echo "Installing Playwright Chrome browser..."
  npx playwright install chrome --with-deps || {
    echo "WARNING: Playwright browser install failed"
  }
else
  echo "Skipping Playwright browser install (INSTALL_PLAYWRIGHT_BROWSERS=0)"
fi

echo "postCreate setup complete!"