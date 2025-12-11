ALTER TABLE "budgets" ADD COLUMN "filing_status" varchar(50) DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "budgets" ADD COLUMN "deductions" numeric(10, 2) DEFAULT '0' NOT NULL;