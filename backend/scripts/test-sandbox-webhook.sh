#!/bin/bash

# Test Plaid Webhook in Sandbox Mode
# This script uses the built-in endpoint that calls Plaid's sandboxItemFireWebhook API
#
# IMPORTANT: The webhook URL is configured in Plaid Dashboard, not in code!
# - Go to Plaid Dashboard → Team Settings → Webhooks
# - Set the Sandbox webhook URL to your production server: https://your-production-domain.com/api/plaid/webhook
# - When you fire a webhook via sandbox API, Plaid will send it to the URL configured in the dashboard

set -e

API_URL="${1:-http://localhost:3000}"
EMAIL="${2}"
PASSWORD="${3}"
WEBHOOK_CODE="${4:-SYNC_UPDATES_AVAILABLE}"

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "Usage: $0 [api-url] <email> <password> [webhook-code]"
  echo ""
  echo "Example:"
  echo "  $0 http://localhost:3000 user@example.com password123 SYNC_UPDATES_AVAILABLE"
  echo ""
  echo "Webhook codes:"
  echo "  - SYNC_UPDATES_AVAILABLE (default)"
  echo "  - TRANSACTIONS"
  echo "  - ITEM"
  echo ""
  echo "Note: This only works when PLAID_ENV=sandbox"
  exit 1
fi

echo "Testing Plaid webhook in sandbox mode..."
echo "API URL: $API_URL"
echo "Webhook Code: $WEBHOOK_CODE"
echo ""

# Step 1: Login to get auth token
echo "Step 1: Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$API_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EMAIL\",
    \"password\": \"$PASSWORD\"
  }")

TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed!"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful"
echo ""

# Step 2: Fire webhook
echo "Step 2: Firing webhook via Plaid API..."
FIRE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/plaid/test/fire-webhook" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"webhook_code\": \"$WEBHOOK_CODE\"
  }")

HTTP_CODE=$(echo "$FIRE_RESPONSE" | tail -n1)
BODY=$(echo "$FIRE_RESPONSE" | sed '$d')

echo "Response:"
echo "HTTP Status: $HTTP_CODE"
echo "Body: $BODY"
echo ""

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Webhook fired successfully!"
  echo ""
  echo "Plaid will now send a webhook to the URL configured in your Plaid Dashboard."
  echo ""
  echo "⚠️  IMPORTANT: Make sure your Plaid Dashboard (Sandbox) webhook URL is set to:"
  echo "   https://your-production-domain.com/api/plaid/webhook"
  echo ""
  echo "To check webhook reception on production:"
  echo "  1. Check production server logs for: [WEBHOOK] Stored webhook #X"
  echo "  2. Query production database: SELECT * FROM plaid_webhooks ORDER BY created_at DESC LIMIT 1;"
else
  echo "❌ Failed to fire webhook"
  echo ""
  echo "Common issues:"
  echo "  - Make sure PLAID_ENV=sandbox in your .env file"
  echo "  - Make sure you have a Plaid account connected"
  echo "  - Check that your backend server is running"
  exit 1
fi

