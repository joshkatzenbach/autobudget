#!/bin/bash

# Test Plaid Webhook Script
# Usage: ./test-webhook.sh <webhook-url> <verification-key> <item-id> [webhook-type]

set -e

WEBHOOK_URL="${1:-http://localhost:3000/api/plaid/webhook}"
VERIFICATION_KEY="${2}"
ITEM_ID="${3}"
WEBHOOK_TYPE="${4:-SYNC_UPDATES_AVAILABLE}"

if [ -z "$VERIFICATION_KEY" ] || [ -z "$ITEM_ID" ]; then
  echo "Usage: $0 <webhook-url> <verification-key> <item-id> [webhook-type]"
  echo ""
  echo "Example:"
  echo "  $0 https://api.example.com/api/plaid/webhook abc123 item_123 SYNC_UPDATES_AVAILABLE"
  echo ""
  echo "Webhook types:"
  echo "  - SYNC_UPDATES_AVAILABLE (default)"
  echo "  - TRANSACTIONS"
  echo "  - ITEM"
  exit 1
fi

echo "Testing webhook..."
echo "URL: $WEBHOOK_URL"
echo "Type: $WEBHOOK_TYPE"
echo "Item ID: $ITEM_ID"
echo ""

# Build webhook payload based on type
case "$WEBHOOK_TYPE" in
  SYNC_UPDATES_AVAILABLE)
    PAYLOAD=$(cat <<EOF
{
  "webhook_type": "SYNC_UPDATES_AVAILABLE",
  "item_id": "$ITEM_ID",
  "webhook_code": "SYNC_UPDATES_AVAILABLE",
  "new_transactions": 5,
  "removed_transactions": []
}
EOF
)
    ;;
  TRANSACTIONS)
    PAYLOAD=$(cat <<EOF
{
  "webhook_type": "TRANSACTIONS",
  "item_id": "$ITEM_ID",
  "webhook_code": "INITIAL_UPDATE",
  "new_transactions": 10
}
EOF
)
    ;;
  ITEM)
    PAYLOAD=$(cat <<EOF
{
  "webhook_type": "ITEM",
  "item_id": "$ITEM_ID",
  "webhook_code": "ERROR",
  "error": {
    "error_type": "ITEM_ERROR",
    "error_code": "ITEM_LOGIN_REQUIRED"
  }
}
EOF
)
    ;;
  *)
    echo "Unknown webhook type: $WEBHOOK_TYPE"
    exit 1
    ;;
esac

# Send webhook
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "Plaid-Webhook-Verification-Key: $VERIFICATION_KEY" \
  -d "$PAYLOAD")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "Response:"
echo "HTTP Status: $HTTP_CODE"
echo "Body: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Webhook sent successfully!"
  echo "Check your server logs and database to verify it was processed."
else
  echo "❌ Webhook failed with status $HTTP_CODE"
  exit 1
fi

