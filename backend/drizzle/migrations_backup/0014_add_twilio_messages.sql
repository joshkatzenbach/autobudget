-- Create twilio_messages table
CREATE TABLE IF NOT EXISTS "twilio_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"direction" varchar(10) NOT NULL,
	"from_number" varchar(20) NOT NULL,
	"to_number" varchar(20) NOT NULL,
	"message_body" text NOT NULL,
	"message_sid" varchar(50),
	"status" varchar(20),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "twilio_messages_message_sid_unique" UNIQUE("message_sid")
);
--> statement-breakpoint
-- Add foreign key constraint
DO $$ BEGIN
 ALTER TABLE "twilio_messages" ADD CONSTRAINT "twilio_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

