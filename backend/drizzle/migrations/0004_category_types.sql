-- Add new category type columns to budget_categories
ALTER TABLE "budget_categories" ADD COLUMN "category_type" varchar(50) DEFAULT 'variable' NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN "accumulated_total" numeric(10, 2) DEFAULT '0' NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN "bill_count" integer;
ALTER TABLE "budget_categories" ADD COLUMN "threshold_amount" numeric(10, 2);
ALTER TABLE "budget_categories" ADD COLUMN "estimation_months" integer DEFAULT 12;
ALTER TABLE "budget_categories" ADD COLUMN "is_buffer_category" boolean DEFAULT false NOT NULL;
ALTER TABLE "budget_categories" ADD COLUMN "buffer_priority" integer DEFAULT 999;
ALTER TABLE "budget_categories" ADD COLUMN "goal_limit" numeric(10, 2);

-- Create budget_category_subcategories table
CREATE TABLE "budget_category_subcategories" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"expected_amount" numeric(10, 2) NOT NULL,
	"actual_amount" numeric(10, 2),
	"bill_date" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Add foreign key constraint
DO $$ BEGIN
 ALTER TABLE "budget_category_subcategories" ADD CONSTRAINT "budget_category_subcategories_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
