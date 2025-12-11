-- Migration: Single Budget Per User
-- For users with multiple budgets, keep the most recent one and delete others

-- Step 1: Delete older budgets, keeping only the most recent one per user
DO $$
DECLARE
    user_record RECORD;
    budget_to_keep_id INTEGER;
BEGIN
    -- For each user with multiple budgets
    FOR user_record IN 
        SELECT user_id, COUNT(*) as budget_count
        FROM budgets
        GROUP BY user_id
        HAVING COUNT(*) > 1
    LOOP
        -- Find the most recent budget (by created_at)
        SELECT id INTO budget_to_keep_id
        FROM budgets
        WHERE user_id = user_record.user_id
        ORDER BY created_at DESC
        LIMIT 1;
        
        -- Delete all other budgets for this user
        DELETE FROM budgets
        WHERE user_id = user_record.user_id
        AND id != budget_to_keep_id;
        
        RAISE NOTICE 'Kept budget % for user %, deleted others', budget_to_keep_id, user_record.user_id;
    END LOOP;
END $$;

-- Step 2: Add unique constraint on user_id
-- First, drop the constraint if it exists (in case of re-running migration)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'budgets_user_id_unique'
    ) THEN
        ALTER TABLE budgets DROP CONSTRAINT budgets_user_id_unique;
    END IF;
END $$;

-- Add unique constraint
ALTER TABLE budgets ADD CONSTRAINT budgets_user_id_unique UNIQUE (user_id);

