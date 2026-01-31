-- Migration: Add notification_sent column to plaid_transactions
-- This column tracks whether a Slack notification has been sent for the transaction
-- to prevent duplicate notifications

ALTER TABLE "plaid_transactions" 
ADD COLUMN "notification_sent" boolean DEFAULT false NOT NULL;

