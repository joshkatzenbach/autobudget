-- Rename twilio_messages table to slack_messages and update schema
-- First, drop the old table if it exists (in case of fresh install)
-- For existing data, we'll rename and alter columns

-- Rename table
ALTER TABLE IF EXISTS "twilio_messages" RENAME TO "slack_messages";

-- Drop old columns
ALTER TABLE IF EXISTS "slack_messages" DROP COLUMN IF EXISTS "from_number";
ALTER TABLE IF EXISTS "slack_messages" DROP COLUMN IF EXISTS "to_number";
ALTER TABLE IF EXISTS "slack_messages" DROP COLUMN IF EXISTS "message_sid";

-- Add new columns
ALTER TABLE IF EXISTS "slack_messages" ADD COLUMN IF NOT EXISTS "from_user_id" varchar(50);
ALTER TABLE IF EXISTS "slack_messages" ADD COLUMN IF NOT EXISTS "to_channel_id" varchar(50);
ALTER TABLE IF EXISTS "slack_messages" ADD COLUMN IF NOT EXISTS "to_user_id" varchar(50);
ALTER TABLE IF EXISTS "slack_messages" ADD COLUMN IF NOT EXISTS "channel_id" varchar(50);
ALTER TABLE IF EXISTS "slack_messages" ADD COLUMN IF NOT EXISTS "message_ts" varchar(50);
ALTER TABLE IF EXISTS "slack_messages" ADD COLUMN IF NOT EXISTS "thread_ts" varchar(50);

-- Update unique constraint
ALTER TABLE IF EXISTS "slack_messages" DROP CONSTRAINT IF EXISTS "twilio_messages_message_sid_unique";
ALTER TABLE IF EXISTS "slack_messages" ADD CONSTRAINT "slack_messages_message_ts_unique" UNIQUE("message_ts");

-- Update foreign key constraint name
ALTER TABLE IF EXISTS "slack_messages" DROP CONSTRAINT IF EXISTS "twilio_messages_user_id_users_id_fk";
DO $$ BEGIN
 ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

-- Create slack_oauth table
CREATE TABLE IF NOT EXISTS "slack_oauth" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"team_id" varchar(50) NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"bot_user_id" varchar(50),
	"scope" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "slack_oauth_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
-- Add foreign key constraint for slack_oauth
DO $$ BEGIN
 ALTER TABLE "slack_oauth" ADD CONSTRAINT "slack_oauth_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

