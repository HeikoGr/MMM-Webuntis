#!/usr/bin/env bash

set -euo pipefail

if [[ "${IN_DEVCONTAINER:-}" != "1" && "${REMOTE_CONTAINERS:-}" != "true" ]]; then
  echo "This task only works inside the MMM-Webuntis devcontainer." >&2
  echo "Reopen the workspace in the devcontainer and run the task again." >&2
  exit 1
fi

if [[ "$#" -eq 0 ]]; then
  echo "No command provided." >&2
  exit 1
fi

exec "$@"