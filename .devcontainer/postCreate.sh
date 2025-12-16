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

# Create symlink from module's config directory to MagicMirror config location
# This replaces the bind mount approach for better GitHub Codespaces compatibility
CONFIG_TARGET="${MAGICMIRROR_PATH}/config"
CONFIG_SOURCE="${MODULE_DIR}/config"

if [ -d "$CONFIG_SOURCE" ]; then
  # Validate CONFIG_SOURCE doesn't contain path traversal patterns
  case "$CONFIG_SOURCE" in
    */../*|*/..| ../*|..)
      echo "Error: CONFIG_SOURCE contains path traversal components"
      exit 1
      ;;
  esac
  
  # Remove existing config directory/symlink if present
  # Only remove if it's a symlink or within the expected MagicMirror path
  if [ -L "$CONFIG_TARGET" ]; then
    rm -f "$CONFIG_TARGET"
  elif [ -e "$CONFIG_TARGET" ]; then
    # Validate path is within expected MagicMirror directory
    case "$CONFIG_TARGET" in
      "$MAGICMIRROR_PATH"/*)
        rm -r "$CONFIG_TARGET" || {
          echo "Error: Failed to remove existing directory at $CONFIG_TARGET"
          exit 1
        }
        ;;
      *)
        echo "Error: CONFIG_TARGET is outside expected MagicMirror path"
        exit 1
        ;;
    esac
  fi
  # Create symlink with error handling
  if ! ERROR_MSG=$(ln -s "$CONFIG_SOURCE" "$CONFIG_TARGET" 2>&1); then
    echo "Failed to create symlink: $CONFIG_TARGET -> $CONFIG_SOURCE"
    echo "Error: $ERROR_MSG"
    exit 1
  fi
  echo "Created symlink: $CONFIG_TARGET -> $CONFIG_SOURCE"
fi
