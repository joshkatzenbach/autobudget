# Testing Production Webhooks

This guide explains how to test your Plaid webhook endpoint in production.

## Webhook Endpoint

Your webhook endpoint is: `POST /api/plaid/webhook`

**Production URL:** `https://your-production-domain.com/api/plaid/webhook`

## Methods to Trigger Webhooks

### Method 1: Plaid API (Sandbox Only) ⚠️

**Only works in Sandbox environment!**

Plaid provides a `sandboxItemFireWebhook` API endpoint that can trigger webhooks, but **this only works in sandbox mode**.

**Using the built-in endpoint:**
```bash
POST /api/plaid/test/fire-webhook
Authorization: Bearer YOUR_AUTH_TOKEN
Content-Type: application/json

{
  "webhook_code": "SYNC_UPDATES_AVAILABLE"
}
```

**Requirements:**
- Must be authenticated
- `PLAID_ENV` must be set to `sandbox`
- User must have a connected Plaid account

**Note:** This endpoint calls Plaid's API, which then sends a webhook to your configured webhook URL. This is the closest you can get to a "real" webhook trigger.

### Method 2: Manual Webhook Testing with cURL (Works Everywhere)

You can manually send test webhooks using cURL. Here are examples for different webhook types:

### 1. SYNC_UPDATES_AVAILABLE Webhook

This is the most common webhook - it notifies you when new transactions are available.

```bash
curl -X POST https://your-production-domain.com/api/plaid/webhook \
  -H "Content-Type: application/json" \
  -H "Plaid-Webhook-Verification-Key: YOUR_WEBHOOK_VERIFICATION_KEY" \
  -d '{
    "webhook_type": "SYNC_UPDATES_AVAILABLE",
    "item_id": "YOUR_ITEM_ID",
    "webhook_code": "SYNC_UPDATES_AVAILABLE",
    "new_transactions": 5,
    "removed_transactions": []
  }'
```

### 2. TRANSACTIONS Webhook (Legacy)

```bash
curl -X POST https://your-production-domain.com/api/plaid/webhook \
  -H "Content-Type: application/json" \
  -H "Plaid-Webhook-Verification-Key: YOUR_WEBHOOK_VERIFICATION_KEY" \
  -d '{
    "webhook_type": "TRANSACTIONS",
    "item_id": "YOUR_ITEM_ID",
    "webhook_code": "INITIAL_UPDATE",
    "new_transactions": 10
  }'
```

### 3. ITEM Webhook (for errors, login issues, etc.)

```bash
curl -X POST https://your-production-domain.com/api/plaid/webhook \
  -H "Content-Type: application/json" \
  -H "Plaid-Webhook-Verification-Key: YOUR_WEBHOOK_VERIFICATION_KEY" \
  -d '{
    "webhook_type": "ITEM",
    "item_id": "YOUR_ITEM_ID",
    "webhook_code": "ERROR",
    "error": {
      "error_type": "ITEM_ERROR",
      "error_code": "ITEM_LOGIN_REQUIRED"
    }
  }'
```

### Method 3: Using the Test Script

Use the provided bash script:

```bash
cd backend
./scripts/test-webhook.sh \
  https://your-production-domain.com/api/plaid/webhook \
  YOUR_WEBHOOK_VERIFICATION_KEY \
  YOUR_ITEM_ID \
  SYNC_UPDATES_AVAILABLE
```

This script:
- Sends a properly formatted webhook payload
- Includes the verification key header
- Shows the response status
- Works in any environment (sandbox, development, production)

### Method 4: Using Postman or Similar Tools

1. Create a new POST request
2. URL: `https://your-production-domain.com/api/plaid/webhook`
3. Headers:
   - `Content-Type: application/json`
   - `Plaid-Webhook-Verification-Key: YOUR_WEBHOOK_VERIFICATION_KEY`
4. Body (raw JSON):
```json
{
  "webhook_type": "SYNC_UPDATES_AVAILABLE",
  "item_id": "YOUR_ITEM_ID",
  "webhook_code": "SYNC_UPDATES_AVAILABLE",
  "new_transactions": 5
}
```

### Method 5: Using Plaid Dashboard

**Note:** Plaid Dashboard does NOT provide a way to manually trigger webhooks in production. The dashboard is for:
- Viewing webhook logs
- Configuring webhook URLs
- Viewing webhook verification keys

**For Sandbox:** You can use the `sandboxItemFireWebhook` API (see Method 1 above) or the test endpoint.

## Important Notes

### Sandbox vs Production

- **Sandbox**: Can use Plaid's `sandboxItemFireWebhook` API to trigger real webhooks
- **Production**: No way to have Plaid trigger webhooks manually - you must simulate them yourself

### Simulating vs Real Webhooks

When you manually send a webhook (Methods 2-4), you're **simulating** what Plaid would send. This is useful for:
- Testing your webhook endpoint
- Debugging webhook processing
- Verifying webhook verification works

However, manually sent webhooks won't:
- Actually fetch new transactions from Plaid
- Trigger real transaction syncs

To get real transactions, you need to either:
1. Wait for Plaid to send a real webhook (when transactions actually occur)
2. Manually trigger a transaction sync via `/api/transactions/sync` endpoint
3. Use Plaid's sandbox API to create test transactions (sandbox only)

## Getting Your Values

### Webhook Verification Key
- Found in your Plaid Dashboard under "Team Settings" → "Keys" → "Webhook Verification Key"
- Should match your `PLAID_WEBHOOK_VERIFICATION_KEY` environment variable

### Item ID
- Get from your database:
```sql
SELECT item_id FROM plaid_items WHERE user_id = YOUR_USER_ID;
```
- Or from your application after connecting an account

## Verifying Webhook Reception

### 1. Check Server Logs
Your server should log:
```
[WEBHOOK] Stored webhook #X: SYNC_UPDATES_AVAILABLE for item ITEM_ID
```

### 2. Check Database
Query the `plaid_webhooks` table:
```sql
SELECT 
  id,
  webhook_type,
  webhook_code,
  item_id,
  processed,
  error_message,
  created_at
FROM plaid_webhooks
ORDER BY created_at DESC
LIMIT 10;
```

### 3. Check Response
The webhook endpoint should return:
```json
{
  "received": true
}
```

## Common Webhook Types

| Webhook Type | Webhook Code | Description |
|-------------|--------------|-------------|
| `SYNC_UPDATES_AVAILABLE` | `SYNC_UPDATES_AVAILABLE` | New transactions available (most common) |
| `TRANSACTIONS` | `INITIAL_UPDATE` | Initial transaction sync complete |
| `TRANSACTIONS` | `HISTORICAL_UPDATE` | Historical transactions loaded |
| `TRANSACTIONS` | `DEFAULT_UPDATE` | New transactions available (legacy) |
| `ITEM` | `ERROR` | Item error occurred |
| `ITEM` | `PENDING_EXPIRATION` | Credentials expiring soon |
| `ITEM` | `USER_PERMISSION_REVOKED` | User revoked access |

## Troubleshooting

### Error: "Missing webhook verification key"
- Make sure you're sending the `Plaid-Webhook-Verification-Key` header
- Verify the key matches your `PLAID_WEBHOOK_VERIFICATION_KEY` environment variable

### Error: "Invalid webhook verification key"
- The verification key in the header doesn't match your environment variable
- Double-check both values are identical

### Webhook received but not processed
- Check the `processed` column in `plaid_webhooks` table
- Check `error_message` for processing errors
- Review server logs for detailed error information

### Webhook not received
- Verify your webhook URL is publicly accessible
- Check firewall/security settings
- Ensure HTTPS is properly configured
- Check that your server is running and accessible

## Testing Locally with ngrok

If you want to test webhooks locally before deploying:

1. Install ngrok: `brew install ngrok` (or download from ngrok.com)
2. Start your local server: `npm run dev` (runs on port 3000)
3. Start ngrok: `ngrok http 3000`
4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
5. Update your Plaid webhook URL in Plaid Dashboard to: `https://abc123.ngrok.io/api/plaid/webhook`
6. Test webhooks will now be forwarded to your local server

## Production Checklist

Before going live, ensure:
- [ ] `PLAID_WEBHOOK_VERIFICATION_KEY` is set in production environment
- [ ] Webhook URL is configured in Plaid Dashboard
- [ ] Webhook URL uses HTTPS
- [ ] Server can receive POST requests on the webhook endpoint
- [ ] Database has `plaid_webhooks` table (migration 0002 applied)
- [ ] Monitoring/logging is set up to track webhook reception

