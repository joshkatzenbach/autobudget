-- Migration: Drop is_pending column (posted-only transactions model)
--
-- The app no longer stores or notifies on pending transactions; ingestion now
-- skips anything still pending and only acts on posted transactions. This
-- removes any leftover pending rows and then drops the now-unused column.

-- Step 1: Remove existing pending transactions. Their posted versions will be
-- re-added by /transactions/sync if/when they post. transaction_categories rows
-- cascade-delete via their FK. Guarded so re-running the migration is safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'plaid_transactions' AND column_name = 'is_pending'
  ) THEN
    DELETE FROM plaid_transactions WHERE is_pending = true;
  END IF;
END $$;

-- Step 2: Drop the now-unused column.
ALTER TABLE plaid_transactions DROP COLUMN IF EXISTS is_pending;
