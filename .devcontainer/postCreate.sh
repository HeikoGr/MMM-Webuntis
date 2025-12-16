#!/bin/sh

set -eu

MAGICMIRROR_PATH="/opt/magic_mirror"
MODULE_DIR="$(pwd)"
MODULE_NAME="$(basename \"$MODULE_DIR\")"

# Note: Symlinks are now created in entrypoint.sh before the .env is loaded,
# ensuring they exist during container startup. This postCreate.sh only copies
# template files if they don't exist yet.