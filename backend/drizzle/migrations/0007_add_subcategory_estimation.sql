-- Add estimation fields to budget_category_subcategories
ALTER TABLE "budget_category_subcategories" ADD COLUMN IF NOT EXISTS "use_estimation" boolean DEFAULT false NOT NULL;
ALTER TABLE "budget_category_subcategories" ADD COLUMN IF NOT EXISTS "estimation_months" integer;
