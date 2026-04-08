#!/usr/bin/env bash
# Fetch a stored call log by callSid.
#
# Usage:
#   CALL_SID=CA_TEST_123 ./examples/test-call-log.sh
#
# Environment variables:
#   BASE_URL      — worker URL (default: http://localhost:8787)
#   LOGS_API_KEY  — bearer token matching your .dev.vars
#   CALL_SID      — the call SID to look up (required)

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
LOGS_API_KEY="${LOGS_API_KEY:-dev-log-key}"

if [ -z "${CALL_SID:-}" ]; then
  echo "Error: CALL_SID is required"
  echo "Usage: CALL_SID=CA_TEST_123 ./examples/test-call-log.sh"
  exit 1
fi

echo "→ GET $BASE_URL/call-log/$CALL_SID"
echo ""

curl -s -w "\nHTTP %{http_code}\n" \
  "$BASE_URL/call-log/$CALL_SID" \
  -H "Authorization: Bearer $LOGS_API_KEY"
