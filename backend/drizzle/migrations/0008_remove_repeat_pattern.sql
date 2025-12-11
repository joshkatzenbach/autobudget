-- Remove repeat_pattern column from budgets table
ALTER TABLE "budgets" DROP COLUMN IF EXISTS "repeat_pattern";

