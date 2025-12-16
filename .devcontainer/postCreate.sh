#!/bin/sh

set -eu

MAGICMIRROR_PATH="/opt/magic_mirror"
MODULE_DIR="$(pwd)"
MODULE_NAME="$(basename \"$MODULE_DIR\")"

# Validate required paths are set
if [ -z "$MAGICMIRROR_PATH" ] || [ -z "$MODULE_DIR" ]; then
  echo "Error: Required paths not properly initialized"
  exit 1
fi

# Some modules/tools assume the default MagicMirror path without underscore.
if [ ! -e "/opt/magicmirror" ]; then
  ln -s "/opt/magic_mirror" "/opt/magicmirror" || true
fi

# Copy template files if they don't exist yet (before creating symlink)
if [ ! -f "${MODULE_DIR}/config/config.js" ] && [ -f "${MODULE_DIR}/config/config.template.js" ]; then
  echo "No config.js found; copying config.template.js to config.js"
  cp "${MODULE_DIR}/config/config.template.js" "${MODULE_DIR}/config/config.js"
fi

if [ ! -f "${MODULE_DIR}/config/custom.css" ] && [ -f "${MODULE_DIR}/config/custom.template.css" ]; then
  echo "No custom.css found; copying custom.template.css to custom.css"
  cp "${MODULE_DIR}/config/custom.template.css" "${MODULE_DIR}/config/custom.css"
fi

if [ ! -f "${MODULE_DIR}/config/.env" ] && [ -f "${MODULE_DIR}/config/.env.template" ]; then
  echo "No .env found; copying .env.template to .env"
  cp "${MODULE_DIR}/config/.env.template" "${MODULE_DIR}/config/.env"
fi

# Create symlink for config.js to MagicMirror config directory
CONFIG_JS_SOURCE="${MODULE_DIR}/config/config.js"
CONFIG_JS_TARGET="${MAGICMIRROR_PATH}/config/config.js"

if [ -f "$CONFIG_JS_SOURCE" ]; then
  # Ensure config directory exists
  if [ ! -d "${MAGICMIRROR_PATH}/config" ]; then
    mkdir -p "${MAGICMIRROR_PATH}/config"
  fi

  # Remove existing symlink if present
  if [ -L "$CONFIG_JS_TARGET" ]; then
    rm -f "$CONFIG_JS_TARGET"
  fi

  # Create symlink with error handling
  if ! ERROR_MSG=$(ln -s "$CONFIG_JS_SOURCE" "$CONFIG_JS_TARGET" 2>&1); then
    echo "Failed to create symlink: $CONFIG_JS_TARGET -> $CONFIG_JS_SOURCE"
    echo "Error: $ERROR_MSG"
    exit 1
  fi
  echo "Created symlink: $CONFIG_JS_TARGET -> $CONFIG_JS_SOURCE"
fi
# Create symlink for .env file to MagicMirror root
ENV_SOURCE="${MODULE_DIR}/config/.env"
ENV_TARGET="${MAGICMIRROR_PATH}/.env"

if [ -f "$ENV_SOURCE" ]; then
  # Remove existing .env symlink if present
  if [ -L "$ENV_TARGET" ]; then
    rm -f "$ENV_TARGET"
  fi

  # Create symlink with error handling
  if ! ERROR_MSG=$(ln -s "$ENV_SOURCE" "$ENV_TARGET" 2>&1); then
    echo "Failed to create symlink: $ENV_TARGET -> $ENV_SOURCE"
    echo "Error: $ERROR_MSG"
    exit 1
  fi
  echo "Created symlink: $ENV_TARGET -> $ENV_SOURCE"
fi

# Create symlink for custom.css to MagicMirror css directory
CSS_SOURCE="${MODULE_DIR}/config/custom.css"
CSS_TARGET="${MAGICMIRROR_PATH}/css/custom.css"

if [ -f "$CSS_SOURCE" ]; then
  # Remove existing custom.css symlink if present
  if [ -L "$CSS_TARGET" ]; then
    rm -f "$CSS_TARGET"
  fi

  # Create symlink with error handling
  if ! ERROR_MSG=$(ln -s "$CSS_SOURCE" "$CSS_TARGET" 2>&1); then
    echo "Failed to create symlink: $CSS_TARGET -> $CSS_SOURCE"
    echo "Error: $ERROR_MSG"
    exit 1
  fi
  echo "Created symlink: $CSS_TARGET -> $CSS_SOURCE"
fi