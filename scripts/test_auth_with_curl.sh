#!/bin/bash

###############################################################################
# WebUntis Authentication Test Script (curl-based)
#
# Purpose: Test WebUntis JSON-RPC authentication with curl to verify that
#          credentials work correctly.
#
# Usage:
#   1. Direct parameters:
#      ./scripts/test_auth_with_curl.sh "schulexyz" "schulexyz.webuntis.com" "username" "password"
#
#   2. Read from config.js (if available):
#      ./scripts/test_auth_with_curl.sh --from-config
#
# Requirements:
#   - curl (for HTTP request)
#   - python3 (for JSON formatting, optional)
#   - jq (alternative for JSON formatting, optional)
#
# Exit codes:
#   0 - Authentication successful
#   1 - Invalid parameters or missing dependencies
#   2 - Authentication failed (HTTP error or invalid response)
#
###############################################################################

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

###############################################################################
# Helper Functions
###############################################################################

print_usage() {
  cat <<EOF
Usage:
  $0 <school> <server> <username> <password>
  $0 --from-config

Examples:
  # Test with direct parameters
  $0 "schulexyz" "schulexyz.webuntis.com" "Kai Uwe.Müller" "mypassword"

  # Test with config.js credentials
  $0 --from-config

Parameters:
  school      School identifier (e.g., "schulexyz")
  server      Server hostname (e.g., "schulexyz.webuntis.com")
  username    Username (supports spaces and umlauts, e.g., "P. Müller")
  password    Password

Options:
  --from-config   Read credentials from config/config.js
  --help          Show this help message

EOF
}

check_dependencies() {
  if ! command -v curl &>/dev/null; then
    echo -e "${RED}Error: curl not found. Please install curl.${NC}" >&2
    exit 1
  fi

  # Check for JSON formatter (python3 or jq)
  if command -v python3 &>/dev/null; then
    JSON_FORMATTER="python3 -m json.tool"
  elif command -v jq &>/dev/null; then
    JSON_FORMATTER="jq ."
  else
    echo -e "${YELLOW}Warning: Neither python3 nor jq found. JSON output won't be formatted.${NC}" >&2
    JSON_FORMATTER="cat"
  fi
}

read_from_config() {
  local config_file="$PROJECT_ROOT/config/config.js"

  if [[ ! -f "$config_file" ]]; then
    echo -e "${RED}Error: config/config.js not found${NC}" >&2
    exit 1
  fi

  # Extract credentials using node
  local credentials
  credentials=$(node -e "
    try {
      const config = require('$config_file');
      const modConfig = config.modules.find(m => m.module === 'MMM-Webuntis')?.config;
      if (!modConfig) throw new Error('MMM-Webuntis config not found');
      console.log(JSON.stringify({
        school: modConfig.school || '',
        server: modConfig.server || '',
        username: modConfig.username || '',
        password: modConfig.password || ''
      }));
    } catch (e) {
      console.error('Error reading config:', e.message);
      process.exit(1);
    }
  " 2>&1)

  if [[ $? -ne 0 ]]; then
    echo -e "${RED}Error reading config.js:${NC}" >&2
    echo "$credentials" >&2
    exit 1
  fi

  SCHOOL=$(echo "$credentials" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).school)")
  SERVER=$(echo "$credentials" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).server)")
  USER=$(echo "$credentials" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).username)")
  PASS=$(echo "$credentials" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).password)")

  if [[ -z "$SCHOOL" || -z "$SERVER" || -z "$USER" || -z "$PASS" ]]; then
    echo -e "${RED}Error: Missing credentials in config.js${NC}" >&2
    echo -e "${YELLOW}Make sure school, server, username, and password are set in config/config.js${NC}" >&2
    exit 1
  fi
}

###############################################################################
# Main Script
###############################################################################

# Check dependencies
check_dependencies

# Parse arguments
if [[ $# -eq 0 ]] || [[ "$1" == "--help" ]] || [[ "$1" == "-h" ]]; then
  print_usage
  exit 0
fi

if [[ "$1" == "--from-config" ]]; then
  read_from_config
elif [[ $# -eq 4 ]]; then
  SCHOOL="$1"
  SERVER="$2"
  USER="$3"
  PASS="$4"
else
  echo -e "${RED}Error: Invalid number of arguments${NC}" >&2
  print_usage
  exit 1
fi

# Validate parameters
if [[ -z "$SCHOOL" || -z "$SERVER" || -z "$USER" || -z "$PASS" ]]; then
  echo -e "${RED}Error: All parameters must be non-empty${NC}" >&2
  exit 1
fi

# Build URL
URL="https://$SERVER/WebUntis/jsonrpc.do?school=$SCHOOL"

# Build JSON payload
# Note: Using heredoc with -r flag to preserve exact formatting
read -r -d '' JSON_DATA <<EOF || true
{
    "id": "1",
    "jsonrpc": "2.0",
    "method": "authenticate",
    "params": {
        "user": "$USER",
        "password": "$PASS",
        "client": "MMM-Webuntis-Test"
    }
}
EOF

# Print test info
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  WebUntis Authentication Test (curl)${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}Server:${NC}   $SERVER"
echo -e "${YELLOW}School:${NC}   $SCHOOL"
echo -e "${YELLOW}User:${NC}     $USER"
echo -e "${YELLOW}URL:${NC}      $URL"
echo ""
echo -e "${BLUE}Testing authentication...${NC}"
echo ""

# Perform authentication request
# Use --data-binary to preserve exact UTF-8 encoding
# Add -w to capture HTTP status code
HTTP_STATUS=$(curl -s -w "%{http_code}" -o /tmp/webuntis_auth_response.json \
  -X POST "$URL" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary "$JSON_DATA")

# Check HTTP status
if [[ "$HTTP_STATUS" != "200" ]]; then
  echo -e "${RED}✗ Authentication failed (HTTP $HTTP_STATUS)${NC}"
  echo ""
  echo "Response:"
  cat /tmp/webuntis_auth_response.json | $JSON_FORMATTER 2>/dev/null || cat /tmp/webuntis_auth_response.json
  rm -f /tmp/webuntis_auth_response.json
  exit 2
fi

# Parse response
RESPONSE=$(cat /tmp/webuntis_auth_response.json)
rm -f /tmp/webuntis_auth_response.json

# Check for JSON-RPC error
if echo "$RESPONSE" | grep -q '"error"'; then
  echo -e "${RED}✗ Authentication failed (JSON-RPC error)${NC}"
  echo ""
  echo "Response:"
  echo "$RESPONSE" | $JSON_FORMATTER 2>/dev/null || echo "$RESPONSE"
  exit 2
fi

# Check for result field
if ! echo "$RESPONSE" | grep -q '"result"'; then
  echo -e "${RED}✗ Unexpected response format (no result field)${NC}"
  echo ""
  echo "Response:"
  echo "$RESPONSE" | $JSON_FORMATTER 2>/dev/null || echo "$RESPONSE"
  exit 2
fi

# Success - extract key fields
SESSION_ID=$(echo "$RESPONSE" | grep -o '"sessionId"[[:space:]]*:[[:space:]]*"[^"]*"' | cut -d'"' -f4)
PERSON_ID=$(echo "$RESPONSE" | grep -o '"personId"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
PERSON_TYPE=$(echo "$RESPONSE" | grep -o '"personType"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')
KLASS_ID=$(echo "$RESPONSE" | grep -o '"klasseId"[[:space:]]*:[[:space:]]*[0-9]*' | grep -o '[0-9]*$')

echo -e "${GREEN}✓ Authentication successful!${NC}"
echo ""
echo -e "${GREEN}Result:${NC}"
echo -e "  Session ID:  $SESSION_ID"
echo -e "  Person ID:   $PERSON_ID"
echo -e "  Person Type: $PERSON_TYPE"
echo -e "  Class ID:    $KLASS_ID"
echo ""
echo -e "${BLUE}Full response:${NC}"
echo "$RESPONSE" | $JSON_FORMATTER 2>/dev/null || echo "$RESPONSE"
echo ""
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Test completed successfully${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Note about UTF-8 support
if [[ "$USER" =~ [^[:ascii:]] ]] || [[ "$USER" =~ [[:space:]] ]]; then
  echo -e "${GREEN}✓ Username contains special characters (spaces/umlauts) - handled correctly!${NC}"
  echo ""
fi

exit 0
