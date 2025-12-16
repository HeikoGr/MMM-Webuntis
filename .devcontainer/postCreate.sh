#!/bin/sh

set -eu

MAGICMIRROR_PATH="/opt/magic_mirror"
MODULE_DIR="$(pwd)"
MODULE_NAME="$(basename \"$MODULE_DIR\")"

# Some modules/tools assume the default MagicMirror path without underscore.
if [ ! -e "/opt/magicmirror" ]; then
  ln -s "/opt/magic_mirror" "/opt/magicmirror" || true
fi
