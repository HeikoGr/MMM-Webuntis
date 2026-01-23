#!/bin/sh

set -eu

MAGICMIRROR_PATH="/opt/magic_mirror"
MODULE_DIR="$(pwd)"
MODULE_NAME="$(basename \"$MODULE_DIR\")"

echo "Running postCreate setup for $MODULE_NAME..."

# Install module dependencies
if [ -f "$MODULE_DIR/package.json" ]; then
  echo "Installing $MODULE_NAME dependencies..."
  npm install || {
    echo "WARNING: npm install failed for $MODULE_NAME"
  }
fi

echo "postCreate setup complete!"