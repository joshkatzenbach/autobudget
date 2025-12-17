-- Initial consolidated schema migration
-- This migration creates the database in its current state

-- Create drizzle schema for migration tracking
CREATE SCHEMA IF NOT EXISTS "drizzle";

-- Create users table
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"phone_number" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

-- Create sessions table
CREATE TABLE "sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);

-- Create budgets table
CREATE TABLE "budgets" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"income" numeric(10, 2) NOT NULL,
	"tax_rate" numeric(5, 2) DEFAULT '0' NOT NULL,
	"filing_status" varchar(50) DEFAULT 'single' NOT NULL,
	"deductions" numeric(10, 2) DEFAULT '0' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_id_unique" UNIQUE("user_id")
);

-- Create budget_categories table
CREATE TABLE "budget_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"budget_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"allocated_amount" numeric(10, 2) NOT NULL,
	"spent_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"category_type" varchar(50) DEFAULT 'variable' NOT NULL,
	"accumulated_total" numeric(10, 2) DEFAULT '0' NOT NULL,
	"color" varchar(7),
	"auto_move_surplus" boolean DEFAULT false NOT NULL,
	"surplus_target_category_id" integer,
	"auto_move_deficit" boolean DEFAULT false NOT NULL,
	"deficit_source_category_id" integer,
	"expected_merchant_name" varchar(255),
	"hide_from_transaction_lists" boolean DEFAULT false NOT NULL,
	"is_tax_deductible" boolean DEFAULT false NOT NULL,
	"is_subject_to_fica" boolean DEFAULT false NOT NULL,
	"is_unconnected_account" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create plaid_items table
CREATE TABLE "plaid_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"item_id" varchar(255) NOT NULL,
	"access_token" text NOT NULL,
	"institution_id" varchar(255),
	"institution_name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_items_item_id_unique" UNIQUE("item_id")
);

-- Create plaid_accounts table
CREATE TABLE "plaid_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"account_id" varchar(255) NOT NULL,
	"name" varchar(255) NOT NULL,
	"custom_name" varchar(255),
	"official_name" varchar(500),
	"type" varchar(50),
	"subtype" varchar(50),
	"mask" varchar(10),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create plaid_transactions table
CREATE TABLE "plaid_transactions" (
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
	"is_reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plaid_transactions_transaction_id_unique" UNIQUE("transaction_id")
);

-- Create transaction_categories table
CREATE TABLE "transaction_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_id" integer NOT NULL,
	"category_id" integer NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"is_manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

-- Create monthly_category_summaries table
CREATE TABLE "monthly_category_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"budget_id" integer,
	"category_id" integer NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"total_spent" numeric(10, 2) NOT NULL,
	"transaction_count" integer DEFAULT 0 NOT NULL,
	"accumulated_total" numeric(10, 2),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_category_summaries_user_id_budget_id_category_id_year_month_unique" UNIQUE("user_id","budget_id","category_id","year","month")
);

-- Create slack_messages table
CREATE TABLE "slack_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"direction" varchar(10) NOT NULL,
	"from_user_id" varchar(50),
	"to_channel_id" varchar(50),
	"to_user_id" varchar(50),
	"channel_id" varchar(50),
	"message_body" text NOT NULL,
	"message_ts" varchar(50),
	"thread_ts" varchar(50),
	"status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_messages_message_ts_unique" UNIQUE("message_ts")
);

-- Create slack_oauth table
CREATE TABLE "slack_oauth" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"team_id" varchar(50) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"bot_user_id" varchar(50),
	"scope" text,
	"notification_group_dm_channel_id" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_oauth_user_id_unique" UNIQUE("user_id")
);

-- Create fund_movements table
CREATE TABLE "fund_movements" (
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

-- Create savings_snapshots table
CREATE TABLE "savings_snapshots" (
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

-- Add foreign key constraints
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "budget_categories" ADD CONSTRAINT "budget_categories_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

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

DO $$ BEGIN
 ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "plaid_accounts" ADD CONSTRAINT "plaid_accounts_item_id_plaid_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "plaid_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "plaid_transactions" ADD CONSTRAINT "plaid_transactions_item_id_plaid_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "plaid_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_transaction_id_plaid_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "plaid_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "monthly_category_summaries" ADD CONSTRAINT "monthly_category_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "monthly_category_summaries" ADD CONSTRAINT "monthly_category_summaries_budget_id_budgets_id_fk" FOREIGN KEY ("budget_id") REFERENCES "budgets"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "monthly_category_summaries" ADD CONSTRAINT "monthly_category_summaries_category_id_budget_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "budget_categories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "slack_oauth" ADD CONSTRAINT "slack_oauth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

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
