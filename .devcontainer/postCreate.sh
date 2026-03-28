#!/bin/sh

set -eu

MODULE_DIR="$(pwd)"
MODULE_NAME="$(basename "$MODULE_DIR")"

echo "Running postCreate setup for $MODULE_NAME..."

# Install module dependencies
if [ -f "$MODULE_DIR/package.json" ]; then
  if [ ! -d "$MODULE_DIR/node_modules" ] || [ -z "$(ls -A "$MODULE_DIR/node_modules" 2>/dev/null)" ]; then
    echo "Installing $MODULE_NAME dependencies..."
    npm install --no-audit --no-fund || {
      echo "WARNING: npm install failed for $MODULE_NAME"
    }
  else
    echo "$MODULE_NAME dependencies already installed"
  fi
fi

mkdir -p /tmp/playwright-mcp

if command -v playwright-mcp >/dev/null 2>&1; then
  playwright-mcp --version >/dev/null 2>&1 || true
fi

echo "postCreate setup complete!"