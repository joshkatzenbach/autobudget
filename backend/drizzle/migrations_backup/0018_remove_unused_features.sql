-- Remove unused features: transaction_category_overrides, subcategories, estimation, buffer categories

-- Drop transaction_category_overrides table
DROP TABLE IF EXISTS "transaction_category_overrides";

-- Remove subcategoryId column from transaction_categories
-- First, drop the foreign key constraint
ALTER TABLE "transaction_categories" DROP CONSTRAINT IF EXISTS "transaction_categories_subcategory_id_budget_category_subcategories_id_fk";

-- Set any existing subcategoryId values to NULL (they'll be invalid after dropping the table anyway)
UPDATE "transaction_categories" SET "subcategory_id" = NULL WHERE "subcategory_id" IS NOT NULL;

-- Now drop the column
ALTER TABLE "transaction_categories" DROP COLUMN IF EXISTS "subcategory_id";

-- Now we can safely drop budget_category_subcategories table (no foreign keys depend on it)
DROP TABLE IF EXISTS "budget_category_subcategories";

-- Remove estimationMonths from budget_categories
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "estimation_months";

-- Remove buffer category fields from budget_categories
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "is_buffer_category";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "buffer_priority";
