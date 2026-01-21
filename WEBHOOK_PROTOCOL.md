# Transaction Webhook Processing Protocol

This document describes the current protocol when a transaction webhook is received from Plaid.

## Overview

When Plaid sends a `SYNC_UPDATES_AVAILABLE` webhook, the system processes it asynchronously to fetch and store new transactions, categorize them using AI, and send Slack notifications.

## Protocol Flow

### 1. Webhook Reception & Verification

**Endpoint:** `POST /api/plaid/webhook`

**Steps:**
1. **Verification**: Webhook is verified using `Plaid-Webhook-Verification-Key` header
   - In production: Verification key is required
   - In development: Missing key is logged but allowed through

2. **Immediate Storage**: Webhook payload is stored in `plaid_webhooks` table
   ```sql
   INSERT INTO plaid_webhooks (
     item_id, webhook_type, webhook_code, payload, processed
   ) VALUES (...)
   ```
   - `processed` is set to `false` initially
   - Full payload is stored as JSON string

3. **Immediate Acknowledgment**: HTTP 200 response sent immediately
   ```json
   { "received": true }
   ```
   - This happens **before** any processing
   - Plaid expects a response within 5 seconds

### 2. Asynchronous Processing

Processing happens **after** the response is sent, so Plaid doesn't wait.

#### 2.1 Webhook Type Check

Only `SYNC_UPDATES_AVAILABLE` webhooks are processed. Other types are:
- Stored in database
- Marked as processed with error message: `"Unhandled webhook type: {type}"`
- Logged but not acted upon

#### 2.2 Item Lookup

1. Find Plaid item in database using `item_id` from webhook
2. If item not found:
   - Error logged
   - Processing stops
   - Webhook marked as unprocessed

3. Decrypt access token from database

#### 2.3 Transaction Sync Loop

Uses Plaid's Transactions Sync API with cursor-based pagination:

```javascript
let currentCursor = plaidItem.transactionsCursor || null; // Start from stored cursor
let hasMore = true;

while (hasMore) {
  // Fetch batch of transactions
  const syncResult = await syncTransactions(accessToken, currentCursor);
  
  // Process transactions...
  
  // Update cursor for next batch
  currentCursor = syncResult.nextCursor;
  hasMore = syncResult.hasMore;
  
  // Save cursor to database after each batch
  await updateCursor(plaidItem.id, currentCursor);
}
```

**Why loop?** Plaid may return transactions in batches. The loop continues until `hasMore` is `false`.

### 3. Transaction Processing

For each transaction returned by the sync API:

#### 3.1 Transaction Types

- **Added** (`syncResult.added`): New transactions
- **Modified** (`syncResult.modified`): Updated transactions (e.g., pending → posted)
- **Removed** (`syncResult.removed`): Deleted transactions

#### 3.2 Processing Added Transactions

1. **Extract Category Info**:
   - Prefer `personal_finance_category` (new format)
   - Fall back to `category` (legacy format)
   - Store as JSON string in database

2. **Duplicate Check**:
   - Check if transaction already exists by `transaction_id`
   - If exists: Skip (shouldn't happen with Sync API, but safety check)

3. **Store Transaction**:
   ```javascript
   await storeTransaction(
     userId,
     itemId,
     accountId,
     transactionId,
     amount,        // String format
     merchantName,
     name,
     date,
     plaidCategory, // JSON string
     plaidCategoryId,
     isPending
   )
   ```

4. **Categorize & Notify** (see section 4)

#### 3.3 Processing Modified Transactions

1. **Find Existing Transaction**:
   - Look up by `transaction_id`

2. **If Found**: Update all fields
   ```javascript
   UPDATE plaid_transactions SET
     amount = ...,
     merchant_name = ...,
     name = ...,
     date = ...,
     plaid_category = ...,
     plaid_category_id = ...,
     is_pending = ...,
     updated_at = NOW()
   WHERE transaction_id = ...
   ```

3. **If Not Found**: Treat as new transaction
   - Store as new
   - Categorize & notify

#### 3.4 Processing Removed Transactions

1. **Delete from Database**:
   ```javascript
   DELETE FROM plaid_transactions 
   WHERE transaction_id = ...
   ```

2. **No categorization or notification** (transaction is gone)

### 4. Categorization & Notification

**Only for NEW transactions** (added, not modified)

#### 4.1 Budget Check

1. Check if user has an active budget
2. If no budget: Skip categorization

#### 4.2 AI Categorization

1. **Call OpenAI** with transaction details:
   - Amount
   - Merchant name
   - Plaid category (if available)
   - Transaction name
   - User's budget categories
   - Merchant history (previous transactions from same merchant)

2. **Transfer Detection**:
   - Detects transfers, credit card payments, etc.
   - These are assigned to "Excluded" category automatically

3. **Category Assignment**:
   - If category found: Assign to transaction
   - If not found: Transaction remains uncategorized
   - Stored with `is_manual = false` (LLM-assigned)

#### 4.3 Slack Notification

**Only if**:
- Transaction was successfully categorized
- User has Slack integration configured

1. **Get Slack Access Token**: From `slack_oauth` table
2. **Get Notification Channel**: Group DM or configured channel
3. **Calculate Spending Stats**:
   - Current month spending for category
   - Allotted amount
   - Percentage used
4. **Send Message**:
   - Transaction details
   - Category assignment
   - Spending stats
   - Budget status

### 5. Cursor Management

After each batch of transactions:

1. **Update Cursor** in `plaid_items` table:
   ```javascript
   UPDATE plaid_items 
   SET transactions_cursor = currentCursor,
       updated_at = NOW()
   WHERE id = plaidItem.id
   ```

2. **Why Important**: 
   - Cursor tracks sync position
   - Next webhook will start from this cursor
   - Prevents duplicate processing

### 6. Completion & Error Handling

#### 6.1 Success

1. **Log Summary**:
   ```
   [SYNC] Webhook sync complete: X added, Y modified, Z removed
   ```

2. **Mark Webhook as Processed**:
   ```javascript
   UPDATE plaid_webhooks 
   SET processed = true,
       error_message = NULL
   WHERE id = webhookRecordId
   ```

#### 6.2 Error Handling

1. **Transaction-Level Errors**:
   - Logged but don't stop processing
   - Other transactions continue

2. **Webhook-Level Errors**:
   - Caught in try/catch
   - Webhook marked as unprocessed:
     ```javascript
     UPDATE plaid_webhooks 
     SET processed = false,
         error_message = error.message
     WHERE id = webhookRecordId
     ```

3. **No Error Response to Plaid**:
   - Webhook already acknowledged (HTTP 200 sent)
   - Errors are logged and stored in database

## Database Tables Involved

1. **`plaid_webhooks`**: Webhook storage and tracking
2. **`plaid_items`**: Stores access tokens and sync cursors
3. **`plaid_transactions`**: Transaction storage
4. **`transaction_categories`**: Category assignments
5. **`budget_categories`**: User's budget categories
6. **`slack_oauth`**: Slack integration tokens

## Key Design Decisions

### 1. Asynchronous Processing
- **Why**: Plaid requires response within 5 seconds
- **How**: Acknowledge immediately, process after response
- **Trade-off**: Errors can't be reported to Plaid, but stored in database

### 2. Cursor-Based Sync
- **Why**: Handles large numbers of transactions efficiently
- **How**: Store cursor after each batch, resume from cursor on next webhook
- **Benefit**: No duplicate processing, handles pagination

### 3. Only Categorize New Transactions
- **Why**: Modified transactions already have categories
- **Exception**: If modified transaction doesn't exist, treat as new

### 4. Error Isolation
- **Why**: One bad transaction shouldn't block others
- **How**: Try/catch around individual transaction processing
- **Result**: Partial success is possible

## Monitoring & Debugging

### Check Webhook Status
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

### Check Transaction Processing
```sql
SELECT 
  pt.id,
  pt.transaction_id,
  pt.merchant_name,
  pt.amount,
  pt.date,
  pt.is_reviewed,
  COUNT(tc.id) as category_count
FROM plaid_transactions pt
LEFT JOIN transaction_categories tc ON pt.id = tc.transaction_id
WHERE pt.created_at > NOW() - INTERVAL '1 hour'
GROUP BY pt.id
ORDER BY pt.created_at DESC;
```

### Check Cursor Status
```sql
SELECT 
  item_id,
  institution_name,
  transactions_cursor,
  updated_at
FROM plaid_items
WHERE transactions_cursor IS NOT NULL;
```

## Current Limitations

1. **No Retry Logic**: Failed webhooks are not automatically retried
2. **No Dead Letter Queue**: Failed webhooks are just marked as unprocessed
3. **Synchronous Categorization**: AI categorization happens during webhook processing (could be slow)
4. **No Batch Notifications**: Each transaction sends separate Slack message
5. **No Webhook Replay**: Can't reprocess old webhooks easily

## Future Improvements

- Queue system for async categorization
- Retry mechanism for failed webhooks
- Batch Slack notifications
- Webhook replay functionality
- Better error reporting and alerting

