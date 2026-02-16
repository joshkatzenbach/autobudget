-- Migration: Month-End Rework V2
-- 1. Seed monthly_snapshots from budget_categories.rollover_balance for categories with non-zero rollover
-- 2. Drop savings_snapshots table
-- 3. Drop monthly_category_summaries table
-- 4. Update month_end_state: rename current_step -> phase, drop pending_transfers, add remaining_amount and current_button_set
-- 5. Drop rollover_balance from budget_categories

-- Step 1: Seed monthly_snapshots from existing rollover_balance values
-- Use the previous month as the snapshot month (these represent end-of-last-month balances)
INSERT INTO monthly_snapshots (user_id, budget_id, category_id, year, month, allotment, spent, surplus_given, deficit_received, final_rollover_balance, is_locked, created_at, updated_at)
SELECT
  b.user_id,
  bc.budget_id,
  bc.id,
  EXTRACT(YEAR FROM (CURRENT_DATE - INTERVAL '1 month'))::int,
  EXTRACT(MONTH FROM (CURRENT_DATE - INTERVAL '1 month'))::int,
  bc.allocated_amount,
  '0',
  '0',
  '0',
  bc.rollover_balance,
  true,
  NOW(),
  NOW()
FROM budget_categories bc
JOIN budgets b ON bc.budget_id = b.id
WHERE CAST(bc.rollover_balance AS NUMERIC) != 0
ON CONFLICT (user_id, budget_id, category_id, year, month) DO UPDATE
  SET final_rollover_balance = EXCLUDED.final_rollover_balance,
      updated_at = NOW();

-- Step 2: Drop savings_snapshots table
DROP TABLE IF EXISTS savings_snapshots;

-- Step 3: Drop monthly_category_summaries table
DROP TABLE IF EXISTS monthly_category_summaries;

-- Step 4a: Rename current_step -> phase in month_end_state
ALTER TABLE month_end_state RENAME COLUMN current_step TO phase;

-- Step 4b: Drop pending_transfers column
ALTER TABLE month_end_state DROP COLUMN IF EXISTS pending_transfers;

-- Step 4c: Add remaining_amount column
ALTER TABLE month_end_state ADD COLUMN IF NOT EXISTS remaining_amount DECIMAL(10, 2) DEFAULT '0';

-- Step 4d: Add current_button_set column
ALTER TABLE month_end_state ADD COLUMN IF NOT EXISTS current_button_set INTEGER DEFAULT 1;

-- Step 5: Drop rollover_balance from budget_categories
ALTER TABLE budget_categories DROP COLUMN IF EXISTS rollover_balance;
