#!/bin/sh

set -e

# Configuration
MAGICMIRROR_PATH="/opt/magic_mirror"
MODULES_DIR="${MAGICMIRROR_PATH}/modules/"
MODULE_DIR="${MAGICMIRROR_PATH}/modules/MMM-Webuntis"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

if command -v bootstrap-magicmirror.sh >/dev/null 2>&1; then
  echo "Ensuring MagicMirror is installed..."
  bootstrap-magicmirror.sh
else
  echo "${YELLOW}WARNING:${NC} bootstrap-magicmirror.sh missing; MagicMirror may not be installed"
fi

# Helper function to create/update symlinks
create_symlink() {
  local source=$1
  local target=$2
  local name=$3

  if [ -f "$source" ]; then
    [ -L "$target" ] && rm -f "$target"
    ln -s "$source" "$target" || true
    echo "✓ Symlink: $name"
  fi
}

# Helper function to copy from template if missing
copy_from_template() {
  local target=$1
  local template=$2
  local name=$3

  if [ ! -f "$target" ] && [ -f "$template" ]; then
    cp "$template" "$target"
    # Convert CRLF to LF (Windows -> Unix line endings)
    sed -i 's/\r$//' "$target" 2>/dev/null || true
    echo "✓ Created: $name (from template)"
  fi
}

# Setup paths
ln -s "$MAGICMIRROR_PATH" "/opt/magicmirror" 2>/dev/null || true
git config --global alias.pr '!f() { git fetch -fu ${2:-origin} refs/pull/$1/head:pr/$1 && git switch pr/$1; }; f'

# Copy templates if missing
copy_from_template "${MODULE_DIR}/config/config.js" "${MODULE_DIR}/config/config.template.js" "config.js"
copy_from_template "${MODULE_DIR}/config/custom.css" "${MODULE_DIR}/config/custom.template.css" "custom.css"
copy_from_template "${MODULE_DIR}/config/.env" "${MODULE_DIR}/config/.env.template" ".env"

# Create required directories
mkdir -p "${MAGICMIRROR_PATH}/config" "${MAGICMIRROR_PATH}/css"

# Create symlinks (BEFORE loading .env)
create_symlink "${MODULE_DIR}/config/config.js" "${MAGICMIRROR_PATH}/config/config.js" "config.js"
create_symlink "${MODULE_DIR}/config/custom.css" "${MAGICMIRROR_PATH}/css/custom.css" "custom.css"
create_symlink "${MODULE_DIR}/config/.env" "${MAGICMIRROR_PATH}/.env" ".env"

# Load environment variables from .env
ENV_FILE="${MAGICMIRROR_PATH}/.env"
if [ -f "$ENV_FILE" ]; then
  echo "Loading environment variables from $ENV_FILE"
  # Fix line endings (CRLF -> LF) before sourcing
  sed -i 's/\r$//' "$ENV_FILE" 2>/dev/null || true
  set -a
  . "$ENV_FILE"
  set +a
fi

# Configure git if environment variables are set
if command -v git >/dev/null 2>&1; then
  GIT_NAME="${GIT_USER_NAME:-$GIT_USER}"
  GIT_EMAIL="${GIT_USER_EMAIL:-$GIT_EMAIL}"

  if [ -n "$GIT_NAME" ]; then
    echo "Setting git user.name to '$GIT_NAME'"
    git config --global user.name "$GIT_NAME" || true
  fi

  if [ -n "$GIT_EMAIL" ]; then
    echo "Setting git user.email to '$GIT_EMAIL'"
    git config --global user.email "$GIT_EMAIL" || true
  fi
fi

# Install MMM-Carousel module if not present
CAROUSEL_MODULE="${MODULES_DIR}/MMM-Carousel"
if [ ! -d "$CAROUSEL_MODULE" ]; then
  echo "${GREEN}Installing MMM-Carousel module...${NC}"
  git clone https://github.com/shbatm/MMM-Carousel.git "$CAROUSEL_MODULE" || true
fi

# Install MMM-KeyBindings module if not present
KEYBINDINGS_MODULE="${MODULES_DIR}/MMM-KeyBindings"
if [ ! -d "$KEYBINDINGS_MODULE" ]; then
  echo "${GREEN}Installing MMM-KeyBindings module...${NC}"
  git clone https://github.com/shbatm/MMM-KeyBindings.git "$KEYBINDINGS_MODULE" || true
fi


# Install MMM-Cursor module if not present
CURSOR_MODULE="${MODULES_DIR}/MMM-Cursor"
if [ ! -d "$CURSOR_MODULE" ]; then
  echo "${GREEN}Installing MMM-Cursor module...${NC}"
  git clone https://github.com/uxigene/MMM-Cursor.git "$CURSOR_MODULE" || true
fi

# Install module dependencies if needed
echo "${GREEN}=== MagicMirror Startup (module devcontainer) ===${NC}"
if [ -d "${MODULES_DIR}" ]; then
  for MOD in "${MODULES_DIR}"/*; do
    if [ -f "$MOD/package.json" ]; then
      if [ ! -d "$MOD/node_modules" ] || [ -z "$(ls -A "$MOD/node_modules" 2>/dev/null)" ]; then
        echo "${YELLOW}Installing dependencies: $(basename "$MOD")${NC}"
        npm --prefix "$MOD" install || true
      fi
    fi
  done
fi

# Validate config file before starting PM2
echo "${GREEN}Validating MagicMirror configuration...${NC}"
CONFIG_FILE="${MAGICMIRROR_PATH}/config/config.js"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "${RED}ERROR: Config file not found: $CONFIG_FILE${NC}"
  echo "${YELLOW}Please create a config.js file. You can copy from config.template.js${NC}"
  echo "Dropping to shell for debugging..."
  exec /bin/sh
fi

# Try to validate config by requiring it in Node.js
node -e "try { require('$CONFIG_FILE'); console.log('Config OK'); } catch(e) { console.error('CONFIG ERROR:', e.message); process.exit(1); }" 2>&1 || {
  CONFIG_EXIT=$?
  echo "${RED}ERROR: Configuration validation failed (exit code: $CONFIG_EXIT)${NC}"
  echo "${YELLOW}Check your config.js file for syntax errors.${NC}"
  echo "Dropping to shell for debugging..."
  exec /bin/sh
}

# Start MagicMirror
cd "$MAGICMIRROR_PATH"
echo "${GREEN}Starting MagicMirror under PM2...${NC}"

if command -v pm2-runtime >/dev/null 2>&1; then
  # Use exec to replace this shell process with pm2-runtime
  # Add error handling to catch pm2-runtime startup failures
  exec pm2-runtime start /opt/magic_mirror/ecosystem.config.js --error /tmp/pm2-error.log || {
    PM2_EXIT=$?
    echo "${RED}ERROR: PM2 failed to start (exit code: $PM2_EXIT)${NC}"
    if [ -f /tmp/pm2-error.log ]; then
      echo "${RED}PM2 Error Log:${NC}"
      cat /tmp/pm2-error.log
    fi
    echo "Dropping to shell for debugging..."
    exec /bin/sh
  }
else
  echo "${RED}Error: pm2-runtime not found${NC}"
  exec /bin/sh
fi