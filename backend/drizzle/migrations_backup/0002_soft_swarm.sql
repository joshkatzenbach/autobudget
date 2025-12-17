ALTER TABLE "budgets" ALTER COLUMN "repeat_pattern" SET DEFAULT 'monthly';--> statement-breakpoint
ALTER TABLE "budgets" ALTER COLUMN "repeat_pattern" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL;