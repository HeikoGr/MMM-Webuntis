#!/bin/bash

# Diagnose script for WebUntis connection instability
# Tests for sporadically failing server connections
# Usage: node --run debug:diagnose (will be added to package.json)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== WebUntis Connection Stability Test ===${NC}"
echo "Purpose: Identify connection errors and rate limiting issues"
echo "Note: Will make MINIMAL requests to avoid server stress"
echo ""

# Load config to get server
CONFIG_FILE="$PROJECT_DIR/config/config.js"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo -e "${RED}Error: config.js not found. Please configure first.${NC}"
  exit 1
fi

# Extract server from config (basic regex)
SERVER=$(grep -oP "server:\s*['\"]?\K[^'\"]\w+\.webuntis\.com" "$CONFIG_FILE" | head -1)
if [[ -z "$SERVER" ]]; then
  echo -e "${YELLOW}Warning: Could not auto-detect server from config.js${NC}"
  echo "You can manually specify server:"
  echo "  WEBUNTIS_SERVER=example.webuntis.com bash $0"
  SERVER="${WEBUNTIS_SERVER:-}"
fi

if [[ -z "$SERVER" ]]; then
  echo -e "${RED}Error: No server specified${NC}"
  exit 1
fi

echo -e "Testing server: ${BLUE}${SERVER}${NC}"
echo ""

# Test 1: DNS Resolution
echo -e "${YELLOW}[1/5] Testing DNS resolution...${NC}"
if nslookup "$SERVER" &>/dev/null; then
  IP=$(dig +short "$SERVER" | head -1)
  echo -e "${GREEN}✓ DNS resolved to: ${IP}${NC}"
else
  echo -e "${RED}✗ DNS resolution failed${NC}"
fi
echo ""

# Test 2: Basic connectivity (TCP 443)
echo -e "${YELLOW}[2/5] Testing TCP connection (port 443)...${NC}"
if timeout 5 bash -c "cat </dev/null >'/dev/tcp/${SERVER}/443'" 2>/dev/null; then
  echo -e "${GREEN}✓ TCP connection successful${NC}"
else
  echo -e "${RED}✗ TCP connection failed (connection refused or timeout)${NC}"
fi
echo ""

# Test 3: TLS/SSL handshake
echo -e "${YELLOW}[3/5] Testing TLS/SSL handshake...${NC}"
if openssl s_client -connect "${SERVER}:443" -servername "$SERVER" </dev/null 2>&1 | grep -q "Verify return code: 0"; then
  echo -e "${GREEN}✓ TLS handshake successful${NC}"
else
  echo -e "${YELLOW}⚠ TLS check inconclusive (may still work)${NC}"
fi
echo ""

# Test 4: Basic HTTP request to the server (no auth needed)
echo -e "${YELLOW}[4/5] Testing HTTP connectivity (basic request)...${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -m 10 "https://${SERVER}/WebUntis/api/rest/view/v1/timetable/entries" 2>&1 || echo "")
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [[ "$HTTP_CODE" =~ ^[0-9]+$ ]]; then
  case $HTTP_CODE in
    401|403)
      echo -e "${GREEN}✓ Server responds (HTTP ${HTTP_CODE} - auth required, expected)${NC}"
      ;;
    500|502|503)
      echo -e "${RED}✗ Server error (HTTP ${HTTP_CODE})${NC}"
      ;;
    200)
      echo -e "${GREEN}✓ Server responds (HTTP 200 - unexpected but good connectivity)${NC}"
      ;;
    *)
      echo -e "${YELLOW}⚠ Server responds (HTTP ${HTTP_CODE})${NC}"
      ;;
  esac
else
  echo -e "${RED}✗ No valid HTTP response${NC}"
  echo "Error: $BODY" | head -3
fi
echo ""

# Test 5: Repeated requests to detect instability
echo -e "${YELLOW}[5/5] Testing connection stability (5 sequential requests)...${NC}"
echo "    (Low timeout to simulate real connection issues)"
echo ""

SUCCESS_COUNT=0
ERROR_COUNT=0
TIMEOUT_COUNT=0
SERVER_ERROR_COUNT=0

for i in {1..5}; do
  echo -n "    Request $i... "

  RESPONSE=$(curl -s -w "\n%{http_code}" -m 3 "https://${SERVER}/WebUntis/api/rest/view/v1/timetable/entries" 2>&1 || echo "ERROR")
  HTTP_CODE=$(echo "$RESPONSE" | tail -1)

  if [[ "$HTTP_CODE" == "ERROR" ]]; then
    echo -e "${RED}✗ Network error (timeout or connection refused)${NC}"
    ((TIMEOUT_COUNT++))
  elif [[ "$HTTP_CODE" =~ ^5 ]]; then
    echo -e "${RED}✗ HTTP $HTTP_CODE (Server error)${NC}"
    ((SERVER_ERROR_COUNT++))
  elif [[ "$HTTP_CODE" =~ ^(401|403|404)$ ]]; then
    echo -e "${GREEN}✓ HTTP $HTTP_CODE (OK for auth test)${NC}"
    ((SUCCESS_COUNT++))
  elif [[ "$HTTP_CODE" =~ ^2 ]]; then
    echo -e "${GREEN}✓ HTTP $HTTP_CODE${NC}"
    ((SUCCESS_COUNT++))
  else
    echo -e "${YELLOW}? HTTP $HTTP_CODE${NC}"
  fi

  # Stagger requests slightly to avoid hammering
  if [[ $i -lt 5 ]]; then
    sleep 1
  fi
done

echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo "Successful: $SUCCESS_COUNT/5"
echo "Timeouts:   $TIMEOUT_COUNT/5"
echo "Server errors: $SERVER_ERROR_COUNT/5"
echo ""

if [[ $SERVER_ERROR_COUNT -gt 2 ]]; then
  echo -e "${RED}⚠ High rate of 5xx errors detected!${NC}"
  echo "This indicates the server is experiencing issues."
  echo "Recommendations:"
  echo "  1. Enable exponential backoff with jitter in restClient.js"
  echo "  2. Increase API timeout from 15s to 20-25s"
  echo "  3. Reduce parallel fetch concurrency"
  echo ""
elif [[ $TIMEOUT_COUNT -gt 1 ]]; then
  echo -e "${YELLOW}⚠ Connection timeouts detected${NC}"
  echo "Recommendations:"
  echo "  1. Increase timeout values in restClient.js"
  echo "  2. Check local network and firewall"
  echo ""
else
  echo -e "${GREEN}✓ Connection appears stable${NC}"
fi
