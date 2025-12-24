-- Add transactions_cursor field to plaid_items table for Transactions Sync API

ALTER TABLE "plaid_items" ADD COLUMN "transactions_cursor" text;

