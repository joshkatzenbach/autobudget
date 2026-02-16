-- Migration: Remove spent_amount column from budget_categories
-- This column was always initialized to '0' and never meaningfully persisted.
-- Spending is computed at read time via calculateCategorySpending().

ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "spent_amount";
