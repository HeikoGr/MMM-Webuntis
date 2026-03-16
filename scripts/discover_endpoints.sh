#!/bin/bash
# WebUntis API Endpoint Discovery Script
# Tests common endpoint patterns to find available APIs

# Note: Do not use 'set -e' here - we want to continue testing even if endpoints fail

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=== WebUntis API Endpoint Discovery ==="
echo ""

# Get student ID from config if available
STUDENT_ID=""
if [ -f "config/config.js" ]; then
  STUDENT_ID=$(grep -oP "studentId:\s*\K\d+" config/config.js 2>/dev/null | head -1 || echo "")
fi

if [ -z "$STUDENT_ID" ]; then
  STUDENT_ID="12345"
  echo -e "${YELLOW}⚠️  No studentId found in config, using placeholder: $STUDENT_ID${NC}"
  echo -e "${YELLOW}   Results may vary - edit this script or config.js with real ID${NC}"
  echo ""
fi

START_DATE="20260317"
END_DATE="20260321"
START_DATETIME="2026-03-17T00:00:00"
END_DATETIME="2026-03-17T23:59:00"

# Counters
FOUND=0
NOT_FOUND=0

# Function to test an endpoint
test_endpoint() {
  local endpoint="$1"
  local description="$2"

  echo -n "Testing: $endpoint"

  # Pad description to align output
  local padding=$((60 - ${#endpoint}))
  if [ $padding -lt 0 ]; then
    padding=0
  fi
  printf "%${padding}s" ""

  # Run test and capture output
  OUTPUT=$(node scripts/test_api_endpoint.js "$endpoint" 2>&1 || true)

  if echo "$OUTPUT" | grep -q "200 OK"; then
    echo -e "${GREEN}✅ FOUND${NC} - $description"
    ((FOUND++))
  elif echo "$OUTPUT" | grep -q "401\|403"; then
    echo -e "${YELLOW}🔒 AUTH REQUIRED${NC} - $description"
    ((NOT_FOUND++))
  elif echo "$OUTPUT" | grep -q "404"; then
    echo -e "${RED}❌ 404${NC}"
    ((NOT_FOUND++))
  else
    echo -e "${RED}❌ ERROR${NC}"
    ((NOT_FOUND++))
  fi
}

echo "Phase 1: Base API Paths"
echo "======================="
test_endpoint "/WebUntis/api" "API root"
test_endpoint "/WebUntis/api/rest" "REST API root"
test_endpoint "/WebUntis/api/rest/view" "View API root"
test_endpoint "/WebUntis/api/rest/view/v1" "Version 1 API root"
test_endpoint "/WebUntis/api/rest/view/v2" "Version 2 API root"
echo ""


echo "Phase 5: Documentation/Schema Endpoints"
echo "========================================"
test_endpoint "/swagger.json" "Swagger at root"
test_endpoint "/api-docs" "API docs at root"
test_endpoint "/openapi.json" "OpenAPI at root"
test_endpoint "/WebUntis/swagger.json" "Swagger in WebUntis"
test_endpoint "/WebUntis/api/swagger.json" "Swagger in API"
test_endpoint "/WebUntis/api/rest/swagger.json" "Swagger in REST"
test_endpoint "/WebUntis/api/docs" "API documentation"
echo ""

echo "Phase 6: V2 API Exploration"
echo "==========================="
test_endpoint "/WebUntis/api/rest/view/v2/calendar" "Calendar overview"
test_endpoint "/WebUntis/api/rest/view/v2/timetable" "Timetable v2"
test_endpoint "/WebUntis/api/rest/view/v2/lessons" "Lessons v2"
test_endpoint "/WebUntis/api/rest/view/v2/events" "Events"
test_endpoint "/WebUntis/api/rest/view/v2/schedule" "Schedule"
echo ""

echo "Phase 7: Messaging/Communication"
echo "================================="
test_endpoint "/WebUntis/api/rest/view/v1/messages" "Messages"
test_endpoint "/WebUntis/api/rest/view/v1/notifications" "Notifications"
test_endpoint "/WebUntis/api/rest/view/v1/announcements" "Announcements"
test_endpoint "/WebUntis/api/rest/view/v1/inbox" "Inbox"
echo ""

echo "========================================"
echo -e "${GREEN}✅ Found: $FOUND${NC}"
echo -e "${RED}❌ Not found: $NOT_FOUND${NC}"
echo ""
echo "💡 Tip: For endpoints marked 🔒 AUTH REQUIRED, authentication is working but you may need specific permissions"
echo "💡 Use browser Developer Tools (F12 → Network) to discover more endpoints used by the official WebUntis interface"
echo ""
echo "📝 Results saved to: debug_dumps/ (check the *_api-test.json files)"
