-- Remove unused fields from budget_categories
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "description";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "is_automatic";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "bill_count";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "threshold_amount";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "goal_limit";
