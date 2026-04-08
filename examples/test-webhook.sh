#!/usr/bin/env bash
# Post a sample collect_info payload to the built-in webhook receiver.
#
# Usage:
#   ./examples/test-webhook.sh
#
# Environment variables (set these or edit the defaults below):
#   BASE_URL      — worker URL (default: http://localhost:8787)
#   LOGS_API_KEY  — bearer token matching your .dev.vars

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8787}"
LOGS_API_KEY="${LOGS_API_KEY:-dev-log-key}"
CALL_SID="${CALL_SID:-CA_TEST_$(date +%s)}"

echo "→ POST $BASE_URL/webhook/collect-info"
echo "  callSid: $CALL_SID"
echo ""

curl -s -w "\nHTTP %{http_code}\n" \
  -X POST "$BASE_URL/webhook/collect-info" \
  -H "Authorization: Bearer $LOGS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Jane Doe\",
    \"phone\": \"+15551234567\",
    \"email\": \"jane@example.com\",
    \"reason\": \"Billing question\",
    \"notes\": \"Wants to upgrade plan\",
    \"callSid\": \"$CALL_SID\",
    \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"
  }"

echo ""
echo "✓ Done. Fetch the log with:"
echo "  CALL_SID=$CALL_SID ./examples/test-call-log.sh"
