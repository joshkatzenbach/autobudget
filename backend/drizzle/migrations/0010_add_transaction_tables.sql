-- Create plaid_transactions table
CREATE TABLE IF NOT EXISTS "plaid_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"transaction_id" varchar(255) NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"merchant_name" varchar(255),
	"name" varchar(255) NOT NULL,
	"date" date NOT NULL,
	"plaid_category" text,
	"plaid_category_id" varchar(255),
	"is_pending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_transactions_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
-- Create transaction_categories table
CREATE TABLE IF NOT EXISTS "transaction_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Create transaction_category_overrides table
CREATE TABLE IF NOT EXISTS "transaction_category_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"merchant_name" varchar(255),
	"plaid_category_id" varchar(255),
	"category_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Create monthly_category_summaries table
CREATE TABLE IF NOT EXISTS "monthly_category_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"budget_id" integer,
	"category_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"total_spent" numeric(10, 2) NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_category_summaries_user_id_budget_id_category_id_year_month_unique" UNIQUE("user_id", "budget_id", "category_id", "year", "month")
);
--> statement-breakpoint
-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_item_id_plaid_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "plaid_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_transaction_id_plaid_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "plaid_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_category_overrides" ADD CONSTRAINT "transaction_category_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_category_overrides" ADD CONSTRAINT "transaction_category_overrides_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monthly_category_summaries" ADD CONSTRAINT "monthly_category_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monthly_category_summaries" ADD CONSTRAINT "monthly_category_summaries_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "monthly_category_summaries" ADD CONSTRAINT "monthly_category_summaries_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

