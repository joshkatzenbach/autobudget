-- Migration: Month-End Rework
-- This migration:
-- 1. Renames accumulatedTotal to rolloverBalance in budget_categories
-- 2. Removes autoMoveDeficit and deficitSourceCategoryId columns
-- 3. Renames autoMoveSurplus to autoSurplusDestination with new semantics
-- 4. Enhances fund_movements table with new tracking fields
-- 5. Creates monthly_snapshots table (replaces savings_snapshots)
-- 6. Creates month_end_state table for tracking reconciliation flow

-- Step 1: Rename accumulatedTotal to rolloverBalance in budget_categories
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'budget_categories' AND column_name = 'accumulated_total') THEN
    ALTER TABLE "budget_categories" RENAME COLUMN "accumulated_total" TO "rollover_balance";
  END IF;
END $$;

-- Step 2: Remove old deficit-related columns and rename surplus column
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "auto_move_deficit";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "deficit_source_category_id";
ALTER TABLE "budget_categories" DROP COLUMN IF EXISTS "auto_move_surplus";
ALTER TABLE "budget_categories" ADD COLUMN IF NOT EXISTS "auto_surplus_destination" varchar(20);

-- Step 3: Enhance fund_movements table
-- First, rename movementType to transferType and variableCategoryId to relatedCategoryId
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fund_movements' AND column_name = 'movement_type') THEN
    ALTER TABLE "fund_movements" RENAME COLUMN "movement_type" TO "transfer_type";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fund_movements' AND column_name = 'variable_category_id') THEN
    ALTER TABLE "fund_movements" RENAME COLUMN "variable_category_id" TO "related_category_id";
  END IF;
END $$;

-- Add new columns to fund_movements
ALTER TABLE "fund_movements" ADD COLUMN IF NOT EXISTS "source_type" varchar(20);
ALTER TABLE "fund_movements" ADD COLUMN IF NOT EXISTS "is_automatic" boolean DEFAULT false NOT NULL;
ALTER TABLE "fund_movements" ADD COLUMN IF NOT EXISTS "description" text;

-- Update existing records to have source_type based on transfer_type
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'fund_movements' AND column_name = 'transfer_type') THEN
    UPDATE "fund_movements" SET "source_type" = 'surplus' WHERE "transfer_type" = 'surplus' AND "source_type" IS NULL;
    UPDATE "fund_movements" SET "source_type" = 'savings' WHERE "transfer_type" = 'deficit' AND "source_type" IS NULL;
  END IF;
END $$;

-- Make source_type not null after data migration (safe to re-run)
ALTER TABLE "fund_movements" ALTER COLUMN "source_type" SET NOT NULL;

-- Make related_category_id nullable (safe to re-run)
ALTER TABLE "fund_movements" ALTER COLUMN "related_category_id" DROP NOT NULL;

-- Step 4: Create monthly_snapshots table
CREATE TABLE IF NOT EXISTS "monthly_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "budget_id" integer NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE,
  "category_id" integer NOT NULL REFERENCES "budget_categories"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "allotment" decimal(10, 2) NOT NULL,
  "spent" decimal(10, 2) DEFAULT '0' NOT NULL,
  "surplus_given" decimal(10, 2) DEFAULT '0' NOT NULL,
  "deficit_received" decimal(10, 2) DEFAULT '0' NOT NULL,
  "final_rollover_balance" decimal(10, 2) NOT NULL,
  "is_locked" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "monthly_snapshots_user_budget_category_month_unique" UNIQUE("user_id", "budget_id", "category_id", "year", "month")
);

-- Step 5: Migrate data from savings_snapshots to monthly_snapshots (if table exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'savings_snapshots') THEN
    INSERT INTO "monthly_snapshots" (
      "user_id", "budget_id", "category_id", "year", "month",
      "allotment", "spent", "surplus_given", "deficit_received",
      "final_rollover_balance", "is_locked", "created_at"
    )
    SELECT
      ss."user_id", ss."budget_id", ss."category_id", ss."year", ss."month",
      COALESCE(bc."allocated_amount", '0') as allotment,
      '0' as spent,
      '0' as surplus_given,
      '0' as deficit_received,
      ss."accumulated_total" as final_rollover_balance,
      true as is_locked,
      ss."created_at"
    FROM "savings_snapshots" ss
    JOIN "budget_categories" bc ON ss."category_id" = bc."id"
    ON CONFLICT ("user_id", "budget_id", "category_id", "year", "month") DO NOTHING;
  END IF;
END $$;

-- Step 6: Create month_end_state table
CREATE TABLE IF NOT EXISTS "month_end_state" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "budget_id" integer NOT NULL REFERENCES "budgets"("id") ON DELETE CASCADE,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "status" varchar(20) DEFAULT 'pending' NOT NULL,
  "current_step" varchar(30),
  "pending_category_id" integer REFERENCES "budget_categories"("id") ON DELETE SET NULL,
  "slack_message_ts" varchar(50),
  "slack_channel_id" varchar(50),
  "processed_categories" text,
  "pending_transfers" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "month_end_state_user_month_unique" UNIQUE("user_id", "year", "month")
);

-- Note: We're keeping savings_snapshots and monthly_category_summaries tables for now
-- They can be dropped in a future migration after verifying data integrity

