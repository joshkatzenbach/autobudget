-- Rename 'expected' to 'fixed' in existing categories
UPDATE "budget_categories" SET "category_type" = 'fixed' WHERE "category_type" = 'expected';

-- Add new fields for Variable categories
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "auto_move_surplus" boolean DEFAULT false NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "surplus_target_category_id" integer;
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "auto_move_deficit" boolean DEFAULT false NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "deficit_source_category_id" integer;

-- Add new fields for Fixed categories
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "expected_merchant_name" varchar(255);
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "hide_from_transaction_lists" boolean DEFAULT false NOT NULL;

-- Add foreign key constraints for Variable category fields
DO $$ BEGIN
 ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_surplus_target_category_id_budget_categories_id_fk" FOREIGN KEY ("surplus_target_category_id") REFERENCES "budget_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_deficit_source_category_id_budget_categories_id_fk" FOREIGN KEY ("deficit_source_category_id") REFERENCES "budget_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Add accumulatedTotal to monthlyCategorySummaries
ALTER TABLE "monthly_category_summaries" ADD COLUMN IF NOT EXISTS "accumulated_total" numeric(10, 2);

-- Create fund_movements table
CREATE TABLE IF NOT EXISTS "fund_movements" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"budget_id" integer NOT NULL,
	"from_category_id" integer,
	"to_category_id" integer,
	"amount" numeric(10, 2) NOT NULL,
	"movement_type" varchar(20) NOT NULL,
	"variable_category_id" integer NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraints for fund_movements
DO $$ BEGIN
 ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_from_category_id_budget_categories_id_fk" FOREIGN KEY ("from_category_id") REFERENCES "budget_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_to_category_id_budget_categories_id_fk" FOREIGN KEY ("to_category_id") REFERENCES "budget_categories"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "fund_movements" ADD CONSTRAINT "fund_movements_variable_category_id_budget_categories_id_fk" FOREIGN KEY ("variable_category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create savings_snapshots table
CREATE TABLE IF NOT EXISTS "savings_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"budget_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"accumulated_total" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "savings_snapshots_user_id_budget_id_category_id_year_month_unique" UNIQUE("user_id","budget_id","category_id","year","month")
);

-- Add foreign key constraints for savings_snapshots
DO $$ BEGIN
 ALTER TABLE "savings_snapshots" ADD CONSTRAINT "savings_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "savings_snapshots" ADD CONSTRAINT "savings_snapshots_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "savings_snapshots" ADD CONSTRAINT "savings_snapshots_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
