-- Add custom_name column to plaid_accounts table
ALTER TABLE "plaid_accounts" ADD COLUMN IF NOT EXISTS "custom_name" varchar(255);

