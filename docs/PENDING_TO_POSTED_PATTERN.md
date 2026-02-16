# Pending-to-Posted Transaction Pattern

## Background: How Plaid Transaction Sync Works

Plaid's Sync API returns three lists per batch: `added`, `modified`, and `removed`. Each transaction has a unique `transaction_id` assigned by Plaid. When a purchase is first detected (e.g., a card swipe), Plaid creates a **pending** transaction. Once the merchant settles the charge (usually 1-3 days later), Plaid:

1. Puts the old pending `transaction_id` in the `removed` list
2. Puts a new posted transaction in the `added` list with a **different `transaction_id`**
3. Sets `pending_transaction_id` on the posted transaction, linking it back to the original

This means from Plaid's perspective, pending and posted are two separate transactions with different IDs.

## Problem

Our webhook sync processes `added` before `removed`. When a pending-to-posted transition occurs:

1. The posted transaction arrives in `added` — we'd create a brand new DB row with `notificationSent = false`
2. The old pending transaction arrives in `removed` — we'd delete the old row (which had `notificationSent = true`)

Result: the user gets a second Slack notification for the same purchase.

## Strategy: In-Place Row Update

Rather than delete-and-recreate, we **update the existing pending row in-place** when we detect a posted transaction that links back to it. This is the core paradigm:

- **Identity is our DB primary key (`id`), not Plaid's `transaction_id`** — the row's `id` stays the same, only the Plaid-facing `transactionId` column is swapped to the new posted ID
- **Preserve user-facing state** — `notificationSent`, `isReviewed`, and any `transactionCategories` rows (which FK to `plaidTransactions.id`) all survive the transition untouched
- **The `removed` processing becomes a no-op** — by the time we process the `removed` list, the old `pending_transaction_id` no longer exists in our DB (it was overwritten), so the `DELETE` affects zero rows harmlessly

## Where This Lives

`backend/src/routes/plaid.ts` → `processTransaction()` function, at the top of the `if (isNew)` block (the `added` transactions path).

The check runs before the normal `storeTransaction` call:

1. If `tx.pending_transaction_id` is set, query for a row where `transactionId = tx.pending_transaction_id`
2. If found → update in-place, return early
3. If not found (or `pending_transaction_id` is null) → fall through to normal new-transaction flow

## What Gets Updated vs. Preserved

| Field | Updated? | Reason |
|---|---|---|
| `transactionId` | Yes | New Plaid ID for the posted transaction |
| `amount` | Yes | May differ slightly between pending and posted |
| `merchantName`, `name` | Yes | May be refined when posted |
| `date` | Yes | Settlement date may differ from authorization date |
| `plaidCategory`, `plaidCategoryId` | Yes | Plaid may recategorize |
| `isPending` | Yes (set to `false`) | Transaction is now posted |
| `updatedAt` | Yes | Timestamp the update |
| `notificationSent` | **No** | Prevents duplicate Slack notification |
| `isReviewed` | **No** | Preserves user's review status |
| `userId`, `itemId`, `accountId` | **No** | These don't change |
| `id` (PK) | **No** | Keeps `transactionCategories` FKs intact |

## Edge Cases

- **Pending row was never notified** (e.g., no active budget at the time): `notificationSent` will be `false` on the existing row, so after the in-place update we call `categorizeAndNotify` to send the first notification.
- **Pending row doesn't exist in our DB** (e.g., initial sync picked up the posted version directly): `pending_transaction_id` lookup returns nothing, normal new-transaction flow runs.
- **Amount changes between pending and posted**: The amount column is updated, but any existing `transactionCategories` rows keep the old amount. This is acceptable because category re-assignment happens during notification, and if notification was already sent, the user can manually adjust via Slack.

## Why Not Other Approaches

- **Checking `notificationSent` on insert**: Doesn't work because the new row is a fresh insert with `notificationSent = false`.
- **Deduplicating by merchant+amount+date**: Fragile — amounts and dates can change between pending and posted, and different transactions could have identical fields.
- **Processing `removed` before `added`**: Would require reordering Plaid's sync results and still wouldn't link the two transactions together without `pending_transaction_id`.
