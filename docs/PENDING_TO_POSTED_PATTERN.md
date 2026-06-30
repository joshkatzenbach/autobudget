# Posted-Only Transactions (formerly "Pending-to-Posted Pattern")

## Current model: we only handle POSTED transactions

As of the posted-only change, AutoBudget **ignores pending transactions entirely**. Ingestion
stores and notifies only when a transaction has posted. There is no `is_pending` column and no
pending-to-posted reconciliation logic.

### How Plaid transaction sync works (background)

Plaid's `/transactions/sync` returns three lists per batch: `added`, `modified`, and `removed`.
Each transaction has a unique `transaction_id`. A purchase is first detected as a **pending**
transaction; once the merchant settles (usually 1-3 days later), Plaid:

1. Puts the old pending `transaction_id` in the `removed` list
2. Puts a new posted transaction in `added` with a **different `transaction_id`**
3. *Usually* sets `pending_transaction_id` on the posted transaction, linking it to the pending one

So pending and posted are two separate transactions with different IDs.

### What ingestion does now

In `processTransaction()` (both `backend/src/routes/plaid.ts` — the webhook path — and
`backend/src/routes/transactions.ts` — the manual sync path):

- **Guard at the top: `if (tx.pending) return;`** — pending transactions are dropped on the floor.
  Nothing is stored, nothing is notified.
- `added`/`modified` posted transactions are stored and (if not already notified) notified once.
- The `removed` list is still processed: a removal for a pending `transaction_id` we never stored
  is a harmless no-op; a removal of a real posted transaction (a reversal/correction) still deletes
  the row, which is correct.

Net effect: each real purchase produces exactly **one** notification, when it posts.

## Why we abandoned the in-place pending-to-posted approach

The previous design notified on the pending transaction, then updated the row in place when the
posted version arrived **if** Plaid supplied `pending_transaction_id`. The fatal gap: per
[Plaid's own docs](https://plaid.com/docs/transactions/transactions-data/), in some cases the
posted transaction arrives **without** a `pending_transaction_id` (Plaid failed to match it). When
that happened, the posted transaction looked brand-new → it was stored and **notified again**,
then the original pending row was removed via the `removed` list. The result was a duplicate Slack
notification with only **one** surviving DB row — invisible to any "duplicate rows" query, and
observed heavily in production for certain institutions.

Plaid also explicitly warns that the pending and posted versions "may not necessarily share the
same details: their name and amount may change" (e.g. a restaurant tip added at posting), so a
content-based fallback match on amount/date/merchant is unreliable in both directions. Rather than
chase an imperfect heuristic, we chose accuracy over immediacy: **only act on posted transactions.**

### Trade-off accepted

Notifications now arrive 1-5 business days later (when the charge posts) instead of at swipe time.
The upside is correct, duplicate-free data and a much simpler ingestion path.

### Residual risk

Plaid can *rarely* remove and re-add a **posted** transaction with a new `transaction_id` (data
corrections). That could still produce a single stray duplicate notification. It is far rarer than
the pending churn and can be addressed later with a guard if it ever surfaces.

## Related

- Schema: `is_pending` column removed from `plaid_transactions` (migration
  `0008_drop_is_pending_column.sql`, which also deletes any leftover pending rows).
- Dedup of literal re-adds still relies on the `transaction_id` unique constraint in
  `storeTransaction()` (`backend/src/services/transactions.ts`).
