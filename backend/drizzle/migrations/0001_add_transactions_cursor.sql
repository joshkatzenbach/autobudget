-- Add transactions_cursor field to plaid_items table for Transactions Sync API

ALTER TABLE "plaid_items" ADD COLUMN IF NOT EXISTS "transactions_cursor" text;



