# Plaid Transactions API - How It Works

## Overview

The Plaid `/transactions/get` endpoint allows you to retrieve transaction data from connected financial accounts. Here's how it works in our application:

## API Endpoint Details

### Endpoint
- **URL**: `POST https://production.plaid.com/transactions/get` (or sandbox)
- **Method**: POST
- **Authentication**: Requires `access_token` obtained when user connects their account

### Request Parameters

```typescript
{
  access_token: string,      // Required: Token for the connected account
  start_date: string,        // Required: YYYY-MM-DD format (e.g., "2025-12-01")
  end_date: string,          // Required: YYYY-MM-DD format (e.g., "2025-12-31")
  cursor?: string,           // Optional: For pagination (used in subsequent requests)
  account_ids?: string[],    // Optional: Filter to specific accounts
  count?: number,            // Optional: Max transactions per page (default: 500)
  offset?: number            // Optional: Number of transactions to skip
}
```

### Important Constraints

1. **Date Format**: Dates MUST be in `YYYY-MM-DD` format (no time component)
   - ✅ Correct: `"2025-12-01"`
   - ❌ Wrong: `"2025-12-01T00:00:00.000Z"` (ISO string)
   - ❌ Wrong: `Date` object (must convert to string)

2. **Date Range Limits**:
   - **Maximum range**: 730 days (2 years) from `start_date` to `end_date`
   - **Historical data**: Availability depends on the financial institution
   - Most banks provide 1-2 years of transaction history
   - Some institutions may only provide 30-90 days

3. **Pagination**:
   - Plaid returns up to 500 transactions per request
   - If more transactions exist, response includes `next_cursor`
   - You must make additional requests with the `cursor` to get all transactions
   - Continue until `next_cursor` is `null` or undefined

## How We Use It

### 1. Transaction Fetching (`getTransactions`)

Located in: `backend/src/services/plaid.ts`

```typescript
export async function getTransactions(accessToken: string, startDate: string, endDate: string)
```

**Process:**
1. Normalizes dates to `YYYY-MM-DD` format
2. Makes initial request with `start_date` and `end_date`
3. Checks for `next_cursor` in response
4. If cursor exists, makes additional requests until all transactions are fetched
5. Returns combined array of all transactions

**Example Flow:**
```
Request 1: { access_token, start_date: "2025-12-01", end_date: "2025-12-31" }
Response: { transactions: [...500 transactions...], next_cursor: "abc123" }

Request 2: { access_token, start_date: "2025-12-01", end_date: "2025-12-31", cursor: "abc123" }
Response: { transactions: [...300 transactions...], next_cursor: null }

Total: 800 transactions
```

### 2. Transaction Sync (`syncTransactionsForItem`)

Located in: `backend/src/services/plaid.ts`

```typescript
export async function syncTransactionsForItem(
  accessToken: string,
  userId: number,
  itemId: number,
  startDate: string,
  endDate: string
)
```

**Purpose**: Wrapper around `getTransactions` that adds logging and error handling.

### 3. Manual Sync Endpoint

Located in: `backend/src/routes/transactions.ts`

**Endpoint**: `POST /api/transactions/budget/:budgetId/sync`

**Process:**
1. Gets budget's date range (`startDate` to `endDate`)
2. Gets all connected Plaid items for the user
3. For each item:
   - Calls `syncTransactionsForItem` with budget date range
   - Stores each transaction in database
   - Automatically categorizes using LLM
4. Returns summary of fetched and categorized transactions

## Transaction Data Structure

### What Plaid Returns

Each transaction object includes:

```typescript
{
  transaction_id: string,              // Unique Plaid transaction ID
  account_id: string,                  // Plaid account ID
  amount: number,                      // Transaction amount (negative for debits)
  date: string,                       // YYYY-MM-DD format
  name: string,                       // Transaction description/merchant name
  merchant_name: string | null,        // Extracted merchant name (if available)
  personal_finance_category: {        // NEW: Replaces old "category" field
    primary: string,                  // e.g., "LOAN_PAYMENTS"
    detailed: string,                 // e.g., "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"
    confidence_level: string          // "HIGH", "MEDIUM", "LOW"
  },
  category: string[] | null,          // DEPRECATED: Old category format
  category_id: string | null,         // DEPRECATED: Old category ID
  pending: boolean,                    // Whether transaction is pending
  authorized_date: string | null,     // Date transaction was authorized
  location: {                          // Transaction location data
    address: string | null,
    city: string | null,
    region: string | null,
    postal_code: string | null,
    country: string | null,
    lat: number | null,
    lon: number | null
  },
  payment_channel: string,             // "online", "in store", "other", etc.
  counterparties: Array<{              // Known counterparties
    name: string,
    type: string,                     // "merchant", "financial_institution", etc.
    logo_url: string | null
  }>
}
```

### Important Notes

1. **Category Field Migration**: 
   - Plaid deprecated the old `category` array field
   - Now uses `personal_finance_category` object
   - We handle both formats for backward compatibility

2. **Amount Sign**:
   - Negative amounts = money going out (debits)
   - Positive amounts = money coming in (credits)
   - Example: `-22.25` = $22.25 spent

3. **Pending Transactions**:
   - `pending: true` = transaction not yet posted
   - May change amount or date when finalized
   - We store both pending and posted transactions

## Date Range Considerations

### Budget Date Range

When syncing transactions for a budget:
- Uses budget's `startDate` and `endDate`
- Only fetches transactions within that range
- Example: Budget for December 2025 (Dec 1-31) only gets December transactions

### Historical Data

When creating a new budget:
- Automatically fetches transactions for current month (start of month to today)
- Uses: `startDate = first day of current month`, `endDate = today`
- This ensures new budgets have current month's transactions

### Limitations

1. **Can't fetch future dates**: `end_date` cannot be in the future
2. **730-day limit**: Maximum range is 2 years
3. **Institution-dependent**: Some banks have shorter history windows
4. **Rate limits**: Plaid may throttle requests if too frequent

## Error Handling

### Common Errors

1. **INVALID_FIELD**: Date format incorrect
   - Error: `"end_date must be a string of the format 'YYYY-MM-DD'"`
   - Fix: Normalize dates to `YYYY-MM-DD` format

2. **INVALID_ACCESS_TOKEN**: Token expired or invalid
   - Error: `"invalid access_token"`
   - Fix: User needs to reconnect account

3. **RATE_LIMIT_EXCEEDED**: Too many requests
   - Error: Rate limit exceeded
   - Fix: Implement exponential backoff

### Our Error Handling

- Logs detailed error information
- Continues processing other items if one fails
- Skips duplicate transactions (unique constraint on `transaction_id`)
- Returns partial results if some transactions fail

## Performance Considerations

1. **Pagination**: Always handle `next_cursor` to get all transactions
2. **Batch Processing**: Process transactions in batches to avoid memory issues
3. **Rate Limiting**: Don't sync too frequently (we sync on-demand, not continuously)
4. **Caching**: We store transactions in database to avoid repeated API calls

## Webhooks (Future Enhancement)

Plaid can send webhooks when new transactions are available:
- `TRANSACTIONS` webhook: New transactions available
- `SYNC_UPDATES_AVAILABLE`: Updates ready to sync

We have webhook handling in `backend/src/routes/plaid.ts` that:
- Receives webhook notifications
- Automatically fetches new transactions
- Stores and categorizes them

## Summary

The Plaid transactions endpoint is straightforward but has important constraints:
- ✅ Always use `YYYY-MM-DD` date format
- ✅ Handle pagination with `cursor`
- ✅ Respect 730-day date range limit
- ✅ Store transactions to avoid repeated API calls
- ✅ Handle both `personal_finance_category` (new) and `category` (deprecated)

Our implementation handles all of these considerations and provides automatic categorization using LLM.

