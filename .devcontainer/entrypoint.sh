#!/bin/sh

set -e

MAGICMIRROR_PATH="/opt/magic_mirror"
MODULES_DIR="${MAGICMIRROR_PATH}/modules/"

# Provide a commonly used default path as an alias.
if [ ! -e "/opt/magicmirror" ]; then
    ln -s "${MAGICMIRROR_PATH}" "/opt/magicmirror" 2>/dev/null || true
fi

git config --global alias.pr '!f() { git fetch -fu ${2:-origin} refs/pull/$1/head:pr/$1 && git checkout pr/$1; }; f'

# Load environment variables from project .env (if present) so we can configure git
ENV_FILE="${MAGICMIRROR_PATH}/.env"
if [ -f "$ENV_FILE" ]; then
    echo "Loading environment variables from $ENV_FILE"
    set -a
    . "$ENV_FILE"
    set +a
fi

# Configure git global user from environment variables (if provided)
if command -v git >/dev/null 2>&1; then
    if [ -n "$GIT_USER_NAME" ] || [ -n "$GIT_USER" ]; then
        NAME="${GIT_USER_NAME:-$GIT_USER}"
        echo "Setting git user.name to '$NAME'"
        git config --global user.name "$NAME" || true
    fi
    if [ -n "$GIT_USER_EMAIL" ] || [ -n "$GIT_EMAIL" ]; then
        EMAIL="${GIT_USER_EMAIL:-$GIT_EMAIL}"
        echo "Setting git user.email to '$EMAIL'"
        git config --global user.email "$EMAIL" || true
    fi
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "${GREEN}=== MagicMirror Startup (module devcontainer) ===${NC}"

CONFIG_DIR="${MAGICMIRROR_PATH}/config"
mkdir -p "${CONFIG_DIR}"

if [ ! -f "${CONFIG_DIR}/config.js" ] && [ -f "${CONFIG_DIR}/config.template.js" ]; then
    echo "No config.js found; copying config.template.js to config.js"
    cp "${CONFIG_DIR}/config.template.js" "${CONFIG_DIR}/config.js"
fi

if [ ! -f "${CONFIG_DIR}/custom.css" ] && [ -f "${CONFIG_DIR}/custom.template.css" ]; then
    echo "No custom.css found; copying custom.template.css to custom.css"
    cp "${CONFIG_DIR}/custom.template.css" "${CONFIG_DIR}/custom.css"
fi

echo "MagicMirror config directory is mounted from the repo and templates are copied when missing"

if [ -f "${CONFIG_DIR}/custom.css" ]; then
    mkdir -p "${MAGICMIRROR_PATH}/css"
    cp "${CONFIG_DIR}/custom.css" "${MAGICMIRROR_PATH}/css/custom.css"
fi

if [ -d "${MODULES_DIR}" ]; then
    for MOD in "${MODULES_DIR}"/*; do
        if [ -f "$MOD/package.json" ]; then
            if [ ! -d "$MOD/node_modules" ] || [ -z "$(ls -A "$MOD/node_modules" 2>/dev/null)" ]; then
                echo "${YELLOW}Installing module dependencies in $(basename "$MOD")...${NC}"
                npm --prefix "$MOD" install --omit=dev || true
            fi
        fi
    done
fi

cd "$MAGICMIRROR_PATH"
echo "${GREEN}Starting MagicMirror under PM2...${NC}"
# Run pm2-runtime as PID 1 so the container stays alive and
# Dev Containers can attach reliably. If pm2-runtime isn't
# available, fall back to an interactive shell for debugging.
if command -v pm2-runtime >/dev/null 2>&1; then
    echo "Starting pm2-runtime as PID 1"
    
    exec pm2-runtime start /opt/magic_mirror/ecosystem.config.js
else
    echo "pm2-runtime not found, falling back to interactive shell"
    exec /bin/sh
fi
