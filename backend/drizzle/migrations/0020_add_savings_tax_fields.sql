-- Add new fields for Savings categories
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "is_tax_deductible" boolean DEFAULT false NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "is_subject_to_fica" boolean DEFAULT false NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "is_unconnected_account" boolean DEFAULT false NOT NULL;

